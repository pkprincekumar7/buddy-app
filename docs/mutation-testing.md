# Mutation testing (backend) — manual runs

Coverage says which lines the tests **execute**; mutation testing says whether the tests
would **notice** if those lines were wrong. It makes one small deliberate bug at a time
(a *mutant* — `<=` → `<`, `"60/minute"` → `"600/minute"`, a filter key dropped), runs the
tests, and records whether a test failed:

| Outcome | Meaning |
|---|---|
| **killed** | a test failed — that behaviour is guarded |
| **survived** | every test still passed — a missing assertion, *or* an equivalent change (see below) |
| **timeout** | the tests hung — counts as killed (CI would hang too) |

> **Manual only.** A full run takes hours. It is not part of CI, and both tools refuse to
> start inside Claude Code (they check the `CLAUDECODE` environment variable) so an agent
> can't launch one and sit on it. Run it yourself, in your own terminal.

## Two parts, because one tool can't do it all

| Part | Tool | Covers | Mutants | Expected time |
|---|---|---|---|---|
| 1 | [mutmut](https://github.com/boxed/mutmut) (`[tool.mutmut]` in `backend/pyproject.toml`) | every module under `backend/app/` except the generated `routing_data.py` | ~3,500, generated automatically | ~25–40 min (parallel) |
| 2 | `backend/tools/mutate_handlers.py` | the code mutmut **skips**: decorated functions — every route handler, plus `main.py`'s lifespan, exception handlers and middleware | 400, hand-written in `backend/tools/handler_mutants/` | ~1½–3 h with `--jobs 1`; ~30–60 min with `--jobs 4` |

Run both for full coverage of `app/`. Either can be run on its own.

## One-time setup

From the repo root:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt -r requirements-test.txt -r requirements-mutation.txt
```

Use a terminal where these are **not** set, so the Mongo/Redis integration tests skip
instead of hitting a server (or failing on a skip):
`MONGODB_TEST_URI`, `REDIS_URL`, `REQUIRE_LIVE_SERVICES`. Check with:

```bash
env | grep -E 'MONGODB_TEST_URI|REDIS_URL|REQUIRE_LIVE_SERVICES'
```

(`unset` any that print.)

## Part 1 — mutmut

mutmut needs a JWT key to import the app. **Don't use your real one** — generate a
throwaway key for this shell only:

```bash
export JWT_PRIVATE_KEY="$(openssl genrsa 2048 2>/dev/null)"
```

Run it (`--max-children` = parallel workers; use your number of performance cores):

```bash
mutmut run --max-children 8
```

It first runs the suite once normally, then once to record which tests cover which
functions, then each mutant against only the tests that cover it. Progress shows live;
you can stop it with Ctrl-C and re-run later — finished mutants are cached in
`backend/mutants/` (gitignored), so it resumes.

Read the results:

```bash
mutmut results                 # survivors (and timeouts)
mutmut show <mutant-name>      # the exact change one mutant made, as a diff
mutmut browse                  # interactive browser over all results
```

Start completely fresh (e.g. after large code changes): delete `backend/mutants/`.

## Part 2 — hand-built mutants for decorated code

Validate the lists first (seconds; also safe to run anywhere, including CI or Claude Code):

```bash
python tools/mutate_handlers.py --check
```

Each mutant names an exact piece of source text; if that text changed since the list was
written, `--check` says which mutant to update.

See what's there, then run:

```bash
python tools/mutate_handlers.py --list
python tools/mutate_handlers.py --all --jobs 4 --report mutation-report.md
```

or just some modules (`admin`, `audio`, `auth`, `children`, `downloads`, `jobs`, `llm`,
`main`, `users`):

```bash
python tools/mutate_handlers.py admin jobs --jobs 4
```

What it does, so you can trust it with your working tree:

- Every mutant runs in a **throwaway copy** of `backend/` under your temp directory —
  your files are never edited, even if you Ctrl-C mid-run. The copies are deleted at the
  end.
- The copies **never include `backend/.env`**, and each run uses a freshly generated
  throwaway `JWT_PRIVATE_KEY` with `MONGODB_TEST_URI` / `REDIS_URL` /
  `REQUIRE_LIVE_SERVICES` / `MONGODB_URI` cleared — no real secret or database is touched.
- The unmutated tests run first (baseline); if they fail, that module stops — fix the
  tests first.
- Each mutant gets a timeout of 3× the baseline time + 30 s (override with `--timeout`), so
  one that makes a test hang can't stall the run.
- `main` runs the **whole** suite per mutant (a change there can break any route), so it
  is the slowest module (~85 s per mutant). `users` (~28 s) and `children` (~17 s) are
  next — their rate-limit tests send dozens of requests each.

## Stopping a run that's taking too long

Neither tool edits your files in `backend/app/` — mutmut works in its own `backend/mutants/`
copy, the handler runner in throwaway copies under your temp directory — so stopping
part-way never leaves your code mutated, and there is nothing to restore.

### Handler runner (`tools/mutate_handlers.py`)

**Press Ctrl-C once**, in the terminal it's running in. Within about a second it:

1. cancels every mutant still queued,
2. stops the tests that are running — those mutants are recorded as **NOT RUN**, never
   as killed, so the partial results stay honest,
3. deletes its throwaway copies,
4. prints the results so far (and writes `--report` if you passed it), and exits with
   code 130.

Pressing Ctrl-C again while it does this just prints "still stopping" — the clean-up
can't be cut short, so it never leaves processes or copies behind.

There's no resume cache: the summary shows which modules finished, so re-run only the
rest, e.g.

```bash
python tools/mutate_handlers.py users main --jobs 4
```

### mutmut

**Press Ctrl-C once.** mutmut prints `Stopping...`, stops its workers and prints the
stats so far. Every finished mutant is already saved in `backend/mutants/`, so running

```bash
mutmut run --max-children 8
```

again **resumes** — mutants whose code hasn't changed keep their results; only the rest
run. Delete `backend/mutants/` only if you want to start over from nothing.

### If a run is frozen, or its terminal is gone

From another terminal, send the same signal Ctrl-C would (graceful, as above):

```bash
pkill -INT -f mutate_handlers.py
```

```bash
pkill -INT -f "mutmut run"
```

Only if it still hasn't exited after a minute, force it (`pkill -f mutate_handlers.py` /
`pkill -f "mutmut run"`), then clean up anything a forced stop left behind:

```bash
pkill -f "pytest -x -q -p no:warnings -p no:cacheprovider"
```

```bash
rm -rf "${TMPDIR:-/tmp}"/mutate-*
```

(The first stops handler-runner test runs orphaned by a forced stop — that exact flag
combination is only used by the runner; the second removes its throwaway copies.)

## Reading survivors

A survivor is one of:

1. **A missing assertion** — the code changed behaviour and no test noticed. Add a test
   that fails against the mutant (re-run just that module to confirm it's killed).
2. **An equivalent mutant** — the change makes no observable difference, so no test
   *can* kill it. Leave it, ideally with a comment. Known ones:
   - `downloads`: *apk: blocking S3 calls on the event loop* — whether boto3 runs on a
     worker thread isn't observable from a test.
   - `audio`: *all-control filename not defaulted* — the `or "recording.webm"` it removes
     is redundant with the extension default.
   - mutmut will report others of this kind (e.g. a changed log message nothing asserts
     on, or a string that's only ever compared to itself) — judge each by asking "could
     any caller tell the difference?"

## Keeping the hand-built lists current

`tools/handler_mutants/<module>.py` holds `TARGET` (the file), `TESTS` (what to run) and
`MUTANTS` — `(name, exact source text, replacement)` tuples. After changing a route
handler:

1. Run `python tools/mutate_handlers.py --check`.
2. Fix any mutant it reports (its source text moved or changed), and add mutants for new
   decisions, filters or limits you introduced.
3. A new decorated module needs a new list file and an entry in
   `tools/handler_mutants/__init__.py`.

mutmut needs no maintenance — it generates its mutants from the current code each run.
