#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for the frontend releases in scripts/frontend-publish.sh (save, prune, restore:
# production-readiness review, CI-07) against a small stateful fake of the aws CLI's S3
# commands: a directory per bucket, no AWS access. Needs python3 and jq.
# Run: bash scripts/frontend-release.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE="$WORK/fake"
mkdir -p "$FAKE/bin" "$FAKE/s3"

# -- fake aws: s3 sync / cp, s3api list-objects-v2 / delete-objects ------------------
# Objects are files under $FAKE/s3/<bucket>/<key>; their LastModified is in
# $FAKE/meta.json, from a clock that ticks a second per write (or FAKE_TIME, an ISO date).
cat > "$FAKE/bin/aws" <<'EOF'
#!/usr/bin/env python3
import fnmatch, json, os, shutil, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

root = Path(os.environ["FAKE"]); store = root / "s3"; meta_file = root / "meta.json"
args = sys.argv[1:]
with open(root / "calls", "a") as calls:
    calls.write(" ".join(args) + "\n")
meta = json.loads(meta_file.read_text()) if meta_file.exists() else {"clock": 0, "modified": {}}

def opt(name):
    return args[args.index(name) + 1] if name in args else None

def opts(name):
    return [args[i + 1] for i, a in enumerate(args) if a == name]

def stamp(path):
    if os.environ.get("FAKE_TIME"):
        meta["modified"][path] = os.environ["FAKE_TIME"]
        return
    meta["clock"] += 1
    when = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=meta["clock"])
    meta["modified"][path] = when.strftime("%Y-%m-%dT%H:%M:%S.000Z")

def split(url):
    bucket, _, key = url[len("s3://"):].partition("/")
    return bucket, key

def excluded(rel):
    return any(fnmatch.fnmatch(rel, p) for p in opts("--exclude"))

def objects(bucket, prefix):
    base = store / bucket
    if not base.exists():
        return {}
    found = {}
    for f in base.rglob("*"):
        if f.is_file():
            key = f.relative_to(base).as_posix()
            if key.startswith(prefix):
                found[key] = f
    return found

def done(code=0):
    meta_file.write_text(json.dumps(meta))
    sys.exit(code)

cmd = args[:2]
if cmd == ["s3", "sync"]:
    src, dst = args[2], args[3]
    if src.startswith("s3://"):  # to a local directory
        bucket, prefix = split(src)
        for key, f in objects(bucket, prefix).items():
            rel = key[len(prefix):]
            if not excluded(rel):
                (Path(dst) / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(f, Path(dst) / rel)
    else:  # from a local directory
        bucket, prefix = split(dst)
        sent = set()
        for f in Path(src).rglob("*"):
            rel = f.relative_to(src).as_posix()
            if f.is_file() and not excluded(rel):
                target = store / bucket / (prefix + rel)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(f, target)
                stamp(f"{bucket}/{prefix}{rel}")
                sent.add(rel)
        if "--delete" in args:
            for key, f in objects(bucket, prefix).items():
                rel = key[len(prefix):]
                if rel not in sent and not excluded(rel):
                    f.unlink()
    done()
if cmd == ["s3", "cp"]:
    src, dst = args[2], args[3]
    if src == "-":
        bucket, key = split(dst)
        (store / bucket / key).parent.mkdir(parents=True, exist_ok=True)
        (store / bucket / key).write_bytes(sys.stdin.buffer.read())
        stamp(f"{bucket}/{key}")
        done()
    bucket, key = split(src)
    f = store / bucket / key
    if not f.exists():
        print("fatal error: An error occurred (404) when calling the HeadObject operation", file=sys.stderr)
        done(1)
    sys.stdout.write(f.read_text())
    done()
if cmd == ["s3api", "list-objects-v2"]:
    bucket, prefix = opt("--bucket"), opt("--prefix") or ""
    found = objects(bucket, prefix)
    contents = [{"Key": k, "LastModified": meta["modified"].get(f"{bucket}/{k}")} for k in sorted(found)]
    print(json.dumps({"Contents": contents} if contents else {}))
    done()
if cmd == ["s3api", "delete-objects"]:
    bucket = opt("--bucket")
    for obj in json.loads(opt("--delete"))["Objects"]:
        (store / bucket / obj["Key"]).unlink(missing_ok=True)
    done()
if cmd == ["cloudfront", "create-invalidation"]:
    print("I1")
    done()
print(f"fake aws: unexpected call: {' '.join(args)}", file=sys.stderr)
done(1)
EOF
chmod +x "$FAKE/bin/aws"
export PATH="$FAKE/bin:$PATH"

# shellcheck source=scripts/frontend-publish.sh
source "$HERE/frontend-publish.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL - $1${2:+: $2}"; }
check() { local name="$1" got="$2" want="$3"; [ "$got" = "$want" ] && ok "$name" || fail "$name" "got '$got', want '$want'"; }
bucket_keys() { (cd "$FAKE/s3/b" && find . -type f | sed 's#^\./##' | sort | paste -sd, -); }

# build N: a build whose index.html names its own chunk, assets/app-N.js.
build() {
  local dir="$WORK/build-$1"
  mkdir -p "$dir/assets"
  echo "<script src=/assets/app-$1.js>" > "$dir/index.html"
  echo "chunk $1" > "$dir/assets/app-$1.js"
  echo '{"name": "app"}' > "$dir/manifest.json"
  printf '%s\n' "$dir"
}
sha() { printf '%040d' "$1"; }  # a fake 40-character commit SHA

# -- deploying keeps a release per build ---------------------------------------------
B1=$(build 1)
publish_files "$B1" b
save_release "$B1" b "$(sha 1)"
B2=$(build 2)
publish_files "$B2" b
save_release "$B2" b "$(sha 2)"
check "the root serves the newest build" "$(cat "$FAKE/s3/b/index.html")" "<script src=/assets/app-2.js>"
check "a release per build, newest first" "$(saved_releases b | paste -sd, -)" "$(sha 2),$(sha 1)"
check "a release holds the unhashed files and its chunk list" \
  "$(cd "$FAKE/s3/b/releases/$(sha 1)" && find . -type f | sed 's#^\./##' | sort | paste -sd, -)" \
  "index.html,manifest.json,release-assets.json"
check "its chunk list" "$(cat "$FAKE/s3/b/releases/$(sha 1)/release-assets.json")" '["assets/app-1.js"]'
publish_files "$B2" b
[ -f "$FAKE/s3/b/releases/$(sha 1)/index.html" ] && ok "publishing again doesn't delete the releases (root --delete)" \
  || fail "releases survive a publish"
if save_release "$B2" b "not-a-sha" 2>/dev/null; then fail "a bad SHA is refused"; else ok "a bad SHA is refused"; fi

# -- pruning keeps what a kept release needs -----------------------------------------
FAKE_TIME="2020-01-01T00:00:00.000Z" aws s3 cp - s3://b/assets/orphan.js <<<"x"
check "an old chunk no release uses is pruned; app-1 (release 1) is kept" "$(prune_assets "$B2" b 30)" "1"
[ -f "$FAKE/s3/b/assets/app-1.js" ] && [ ! -f "$FAKE/s3/b/assets/orphan.js" ] \
  && ok "app-1.js kept, orphan.js gone" || fail "what pruning kept" "$(bucket_keys)"

# -- rolling back --------------------------------------------------------------------
reset_dir() { rm -rf "$WORK/restored"; }
reset_dir
restore_release b "$(sha 1)" "$WORK/restored"
publish_unhashed "$WORK/restored" b
check "the root serves the release again, with no rebuild" "$(cat "$FAKE/s3/b/index.html")" "<script src=/assets/app-1.js>"
[ ! -f "$FAKE/s3/b/release-assets.json" ] && ok "its chunk list isn't published at the root" || fail "release-assets.json at the root"
check "invalidated: its unhashed files" "$(invalidation_paths "$WORK/restored" | paste -sd, -)" "/,/index.html,/manifest.json"
reset_dir
if out=$(restore_release b "$(sha 9)" "$WORK/restored" 2>&1); then fail "an unknown release is refused"; else
  [[ "$out" == *"no saved release for $(sha 9)"* ]] && ok "an unknown release is refused" || fail "unknown release message" "$out"; fi
rm "$FAKE/s3/b/assets/app-1.js"
reset_dir
if out=$(restore_release b "$(sha 1)" "$WORK/restored" 2>&1); then fail "a release whose chunks are gone is refused"; else
  [[ "$out" == *"needs chunks that are gone: assets/app-1.js"* ]] && ok "a release whose chunks are gone is refused" \
    || fail "missing chunk message" "$out"; fi

# -- the default target: the newest release that isn't the deployed one --------------
check "the release before the deployed one" "$(previous_release b "$(sha 2)")" "$(sha 1)"
check "the newest, if the deployed one isn't saved" "$(previous_release b "$(sha 9)")" "$(sha 2)"
if out=$(previous_release empty-bucket "$(sha 1)" 2>&1); then fail "no earlier release is an error"; else
  [[ "$out" == *"no earlier saved release"* ]] && ok "no earlier release is an error" || fail "no earlier release message" "$out"; fi

# -- only the newest RELEASES_KEPT stay ------------------------------------------------
for n in 3 4 5; do save_release "$(build "$n")" b "$(sha "$n")"; done
check "prune_releases deletes all but the newest KEEP" "$(prune_releases b 2)" "3"
check "the two newest are left" "$(saved_releases b | paste -sd, -)" "$(sha 5),$(sha 4)"
[ ! -d "$FAKE/s3/b/releases/$(sha 1)" ] || [ -z "$(ls -A "$FAKE/s3/b/releases/$(sha 1)")" ] \
  && ok "and the old releases' files are gone" || fail "old release files" "$(bucket_keys)"
check "nothing more to prune" "$(prune_releases b 2)" "0"
if prune_releases b 0 2>/dev/null; then fail "KEEP 0 is refused"; else ok "KEEP 0 is refused"; fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
