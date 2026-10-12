#!/usr/bin/env python3
"""Mutation testing for the code mutmut skips: FastAPI route handlers, main.py's
lifespan/handlers/middleware — anything decorated.

MANUAL ONLY. Long-running (tens of minutes to hours); never run from CI or from
Claude Code — it refuses to start when CLAUDECODE is set. See
docs/mutation-testing.md.

Each mutant is applied to a throwaway copy of backend/ (your files are never
edited, even if a run is interrupted), the module's tests run against it, and
the mutant is KILLED (a test failed), SURVIVED (all passed — a missing
assertion, or an equivalent change), or TIMEOUT (counts as killed: CI would
hang too). The copies never include backend/.env, and runs use a freshly
generated throwaway JWT key with Mongo/Redis integration settings cleared.

Stopping: press Ctrl-C once — queued mutants are cancelled, running tests are
stopped (and not counted), the throwaway copies are deleted, and the results so
far are printed (and written to --report). It takes about a second; further
Ctrl-Cs during that are ignored so the clean-up can't be cut short.

    python tools/mutate_handlers.py --check              # validate lists only (seconds)
    python tools/mutate_handlers.py --list               # modules, mutant counts
    python tools/mutate_handlers.py admin jobs           # run some modules
    python tools/mutate_handlers.py --all --jobs 4       # run everything, 4 in parallel
"""

from __future__ import annotations

import argparse
import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "tools"))

from handler_mutants import MODULES  # noqa: E402

# Never copied into the throwaway trees: secrets, the venv, caches, mutmut's tree.
_COPY_IGNORE = shutil.ignore_patterns(
    ".env", ".env.*", ".venv", "venv", "mutants", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", "htmlcov", ".coverage*", "*.zip",
)  # fmt: skip
# Integration tests must skip, not hit a real server or fail on a skip.
_CLEARED_ENV = ("MONGODB_TEST_URI", "REDIS_URL", "REQUIRE_LIVE_SERVICES", "MONGODB_URI")

# Outcomes. NOT_RUN = cancelled or stopped by Ctrl-C; never counted as killed.
KILLED, SURVIVED, TIMEOUT, NOT_RUN = "KILLED", "SURVIVED", "TIMEOUT", "NOT RUN"

_stop = threading.Event()
_running: set[subprocess.Popen[str]] = set()
_running_lock = threading.Lock()


class Interrupted(Exception):
    """Ctrl-C during a module; carries that module's results so far."""

    def __init__(self, name: str, rows: list[tuple[str, str]]):
        super().__init__(name)
        self.name, self.rows = name, rows


def _throwaway_jwt_key() -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


def _env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in _CLEARED_ENV}
    env["JWT_PRIVATE_KEY"] = _throwaway_jwt_key()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def check(names: list[str]) -> int:
    """Every mutant's source text must occur exactly once, and the result compile."""
    problems = 0
    for name in names:
        mod = MODULES[name]
        source = (BACKEND / mod.TARGET).read_text(encoding="utf-8")
        seen: set[str] = set()
        for label, old, new in mod.MUTANTS:
            count = source.count(old)
            if label in seen:
                print(f"  {name}: duplicate mutant name {label!r}")
                problems += 1
            seen.add(label)
            if count != 1:
                print(f"  {name}: {label!r} — source text found {count} times (needs exactly 1)")
                problems += 1
                continue
            try:
                compile(source.replace(old, new, 1), mod.TARGET, "exec")
            except SyntaxError as exc:
                print(f"  {name}: {label!r} — mutated file doesn't compile: {exc}")
                problems += 1
        status = "ok" if not problems else ""
        print(f"{name:10} {len(mod.MUTANTS):4} mutants  {mod.TARGET}  {status}")
    print(f"\n{'All lists valid.' if not problems else f'{problems} problem(s).'}")
    return 1 if problems else 0


def _kill(proc: subprocess.Popen[str]) -> None:
    """Stop a pytest run and everything it started (it has its own process group)."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            continue


def _stop_everything() -> None:
    _stop.set()
    with _running_lock:
        procs = list(_running)
    for proc in procs:
        _kill(proc)


def _pytest(
    tree: Path, tests: list[str], env: dict[str, str], timeout: float
) -> tuple[int | None, str]:
    """(exit code, output); exit code None if stopped by Ctrl-C. Raises TimeoutExpired.

    Each run gets its own process group (start_new_session), so a terminal Ctrl-C
    reaches only this script — not pytest, whose interrupted exit code would
    otherwise be mistaken for a killed mutant. This script then stops it itself."""
    if _stop.is_set():
        return None, ""
    cmd = [sys.executable, "-m", "pytest", "-x", "-q", "-p", "no:warnings", "-p",
           "no:cacheprovider", *tests]  # fmt: skip
    proc = subprocess.Popen(
        cmd, cwd=tree, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, start_new_session=True,
    )  # fmt: skip
    with _running_lock:
        _running.add(proc)
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        _kill(proc)
        raise
    finally:
        with _running_lock:
            _running.discard(proc)
    return (None if _stop.is_set() else proc.returncode), out


def run_module(
    name: str, jobs: int, env: dict[str, str], timeout_override: float | None
) -> list[tuple[str, str]] | None:
    mod = MODULES[name]
    work = Path(tempfile.mkdtemp(prefix=f"mutate-{name}-"))
    outcomes: dict[str, str] = {}

    def rows() -> list[tuple[str, str]]:
        return [(label, outcomes.get(label, NOT_RUN)) for label, _, _ in mod.MUTANTS]

    pool: ThreadPoolExecutor | None = None
    try:
        trees: queue.Queue[Path] = queue.Queue()
        for i in range(jobs):
            tree = work / f"w{i}"
            shutil.copytree(BACKEND, tree, ignore=_COPY_IGNORE)
            trees.put(tree)
        original = (BACKEND / mod.TARGET).read_text(encoding="utf-8")

        # Baseline: the unmutated code must pass, and sets the per-mutant timeout.
        tree = trees.get()
        started = time.monotonic()
        code, out = _pytest(tree, mod.TESTS, env, timeout=1800)
        took = time.monotonic() - started
        trees.put(tree)
        if code is None:
            raise KeyboardInterrupt
        if code != 0:
            print(f"\n[{name}] baseline FAILED — fix the tests first:\n{out[-2000:]}")
            return None
        timeout = timeout_override or max(60.0, took * 3 + 30)
        print(f"\n[{name}] {len(mod.MUTANTS)} mutants, {mod.TARGET}; baseline {took:.0f}s, "
              f"timeout {timeout:.0f}s per mutant, {jobs} in parallel")  # fmt: skip

        def one(mutant: tuple[str, str, str]) -> tuple[str, str]:
            label, old, new = mutant
            if _stop.is_set():
                return label, NOT_RUN
            tree = trees.get()
            target = tree / mod.TARGET
            try:
                target.write_text(original.replace(old, new, 1), encoding="utf-8")
                try:
                    code, _ = _pytest(tree, mod.TESTS, env, timeout)
                except subprocess.TimeoutExpired:
                    return label, TIMEOUT
                if code is None:
                    return label, NOT_RUN
                return label, KILLED if code else SURVIVED
            finally:
                target.write_text(original, encoding="utf-8")
                trees.put(tree)

        pool = ThreadPoolExecutor(max_workers=jobs)
        futures = [pool.submit(one, m) for m in mod.MUTANTS]
        done = 0
        for future in as_completed(futures):
            label, outcome = future.result()
            if outcome == NOT_RUN:
                continue
            outcomes[label] = outcome
            done += 1
            print(f"  [{done:3}/{len(futures)}] {outcome:8} {label}", flush=True)
        pool.shutdown(wait=True)
        return rows()
    except KeyboardInterrupt:
        # Finish stopping before anything else: a second Ctrl-C here would abandon
        # running pytest processes and half-deleted copies.
        signal.signal(
            signal.SIGINT, lambda *_: print("  ... still stopping, one moment", flush=True)
        )
        print("\nCtrl-C — stopping: cancelling queued mutants and stopping running tests ...",
              flush=True)  # fmt: skip
        _stop_everything()
        if pool is not None:
            pool.shutdown(wait=True, cancel_futures=True)
        raise Interrupted(name, rows()) from None
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _summarise(
    results: dict[str, list[tuple[str, str]]], report: Path | None, partial: bool
) -> None:
    title = "Handler mutation results" + (" (INTERRUPTED — partial)" if partial else "")
    print(f"\n=== {title} ===")
    lines = [f"# {title}", ""]
    for name, rows in results.items():
        ran = [(label, o) for label, o in rows if o != NOT_RUN]
        killed = sum(o in (KILLED, TIMEOUT) for _, o in ran)
        survived = [label for label, o in ran if o == SURVIVED]
        not_run = len(rows) - len(ran)
        extra = f", {not_run} not run" if not_run else ""
        print(f"{name:10} {killed}/{len(ran)} killed{extra}"
              + (f" — survivors: {survived}" if survived else ""))  # fmt: skip
        lines += [f"## {name} — {killed}/{len(ran)} killed{extra}", ""]
        lines += [f"- {o}: {label}" for label, o in rows] + [""]
    if report:
        report.write_text("\n".join(lines), encoding="utf-8")
        print(f"\nReport written to {report}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    parser.add_argument("modules", nargs="*", metavar="MODULE",
                        help=f"one or more of: {', '.join(MODULES)}")  # fmt: skip
    parser.add_argument("--all", action="store_true", help="run every module")
    parser.add_argument("--check", action="store_true", help="only validate the lists (no tests)")
    parser.add_argument("--list", action="store_true", help="list modules and mutant counts")
    parser.add_argument("--jobs", type=int, default=1, help="mutants run in parallel (default 1)")
    parser.add_argument(
        "--timeout", type=float, help="seconds per mutant (default: 3x baseline + 30)"
    )
    parser.add_argument("--report", type=Path, help="also write a Markdown report here")
    args = parser.parse_args()

    unknown = [m for m in args.modules if m not in MODULES]
    if unknown:
        parser.error(f"unknown module(s) {unknown}; choose from: {', '.join(MODULES)}")
    names = list(MODULES) if (args.all or not args.modules) else args.modules
    if args.list:
        for name in MODULES:
            print(f"{name:10} {len(MODULES[name].MUTANTS):4}  {MODULES[name].TARGET}  tests: {' '.join(MODULES[name].TESTS)}")  # fmt: skip
        return 0
    if args.check:
        return check(names)
    if not (args.all or args.modules):
        parser.error("name module(s) to run, or pass --all (or --check / --list)")
    if os.environ.get("CLAUDECODE"):
        print("Refusing to run inside Claude Code: mutation runs are manual-only and take "
              "a long time. Run it yourself in a terminal (see docs/mutation-testing.md). "
              "`--check` and `--list` are fine here.")  # fmt: skip
        return 2
    if check(names):
        return 1

    env = _env()
    results: dict[str, list[tuple[str, str]]] = {}
    try:
        for name in names:
            outcome = run_module(name, max(1, args.jobs), env, args.timeout)
            if outcome is None:
                return 1
            results[name] = outcome
    except Interrupted as stopped:
        results[stopped.name] = stopped.rows
        _summarise(results, args.report, partial=True)
        return 130  # the conventional exit code for "stopped by Ctrl-C"
    _summarise(results, args.report, partial=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
