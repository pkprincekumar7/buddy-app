#!/usr/bin/env bash
# SC2015: `cond && ok || fail` is intended — ok/fail only echo and count.
# shellcheck disable=SC2015
# Tests for scripts/service-token-keys.sh (SEC-01) against a small stateful fake of the aws
# CLI's SSM commands: no AWS access. Needs python3, jq and OpenSSL 3 (found on PATH or at
# Homebrew's path; LibreSSL can't make Ed25519 keys).
# Run: bash scripts/service-token-keys.test.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export FAKE="$WORK/fake"
mkdir -p "$FAKE/bin" "$WORK/tmp"
export TMPDIR="$WORK/tmp"  # where the script's key files go, to check they're removed

for candidate in openssl /opt/homebrew/opt/openssl@3/bin/openssl /opt/homebrew/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
  if "$candidate" genpkey -algorithm ed25519 >/dev/null 2>&1; then
    export OPENSSL="$candidate"
    break
  fi
done
[ -n "${OPENSSL:-}" ] || { echo "SKIP: no OpenSSL with Ed25519 found"; exit 0; }

# -- fake aws: ssm get-parameter / get-parameters-by-path / put-parameter / delete-parameters
# Parameters live in $FAKE/ssm.json ({name: {type, value}}); every call is logged, with
# values replaced by their length, to $FAKE/calls. FAKE_FAIL=<command> makes it fail.
cat > "$FAKE/bin/aws" <<'EOF'
#!/usr/bin/env python3
import json, os, sys
from pathlib import Path

root = Path(os.environ["FAKE"]); store_file = root / "ssm.json"
args = sys.argv[1:]
store = json.loads(store_file.read_text()) if store_file.exists() else {}

def opt(name):
    return args[args.index(name) + 1] if name in args else None

def opts(name):
    i = args.index(name) + 1
    out = []
    while i < len(args) and not args[i].startswith("--"):
        out.append(args[i]); i += 1
    return out

logged = [("<value>" if i > 0 and args[i - 1] == "--value" else a) for i, a in enumerate(args)]
with open(root / "calls", "a") as calls:
    calls.write(" ".join(logged) + "\n")
cmd = args[1] if len(args) > 1 else ""
if os.environ.get("FAKE_FAIL") == cmd:
    print("An error occurred (ThrottlingException): Rate exceeded", file=sys.stderr); sys.exit(254)

if cmd == "get-parameter":
    name = opt("--name")
    if name not in store:
        print(f"An error occurred (ParameterNotFound) when calling the GetParameter operation: {name}", file=sys.stderr)
        sys.exit(254)
    print(name)
elif cmd == "get-parameters-by-path":
    path = opt("--path").rstrip("/") + "/"
    print(json.dumps(sorted(n for n in store if n.startswith(path))))
elif cmd == "put-parameter":
    name, value = opt("--name"), opt("--value")
    if name in store and "--overwrite" not in args:
        print("ParameterAlreadyExists", file=sys.stderr); sys.exit(254)
    if value.startswith("file://"):
        path = value[len("file://"):]
        mode = os.stat(path).st_mode & 0o777
        value = Path(path).read_text()
        store[name + "#mode"] = oct(mode)
    store[name] = {"type": opt("--type"), "value": value}
elif cmd == "delete-parameters":
    names = opts("--names")
    if len(names) > 10:
        print("too many names", file=sys.stderr); sys.exit(254)
    for n in names:
        store.pop(n, None); store.pop(n + "#mode", None)
else:
    print(f"fake aws: unexpected call: {' '.join(args)}", file=sys.stderr); sys.exit(1)
store_file.write_text(json.dumps(store))
EOF
chmod +x "$FAKE/bin/aws"
export PATH="$FAKE/bin:$PATH"

# shellcheck source=scripts/service-token-keys.sh
source "$HERE/service-token-keys.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL - $1${2:+: $2}"; }
check() { local name="$1" got="$2" want="$3"; [ "$got" = "$want" ] && ok "$name" || fail "$name" "got '$got', want '$want'"; }
value() { jq -r --arg n "$1" '.[$n].value' "$FAKE/ssm.json"; }
field() { jq -r --arg n "$1" --arg f "$2" '.[$n][$f]' "$FAKE/ssm.json"; }
names() { jq -r 'keys[] | select(contains("#") | not)' "$FAKE/ssm.json" | paste -sd, -; }

P=/sp/prod/backend/ap-south-1
VERSIONS="$WORK/versions.json"
echo '{"users": 2}' > "$VERSIONS"

# -- a fresh environment -------------------------------------------------------------
out=$(ensure_service_token_keys sp prod ap-south-1 "$VERSIONS" auth users 2>&1)
check "a pair per service and kid (version 1 by default)" "$(names)" \
  "$P/auth/service_token/auth-v1/private,$P/auth/service_token/auth-v1/public,$P/users/service_token/users-v2/private,$P/users/service_token/users-v2/public"
check "the private key is a SecureString, the public one a String" \
  "$(field "$P/auth/service_token/auth-v1/private" type),$(field "$P/auth/service_token/auth-v1/public" type)" "SecureString,String"
[[ "$(value "$P/auth/service_token/auth-v1/private")" == "-----BEGIN PRIVATE KEY-----"* ]] \
  && [[ "$(value "$P/auth/service_token/auth-v1/public")" == "-----BEGIN PUBLIC KEY-----"* ]] \
  && ok "PKCS#8 private and SPKI public PEMs, as tls_private_key wrote" || fail "PEM formats"
derived=$(value "$P/auth/service_token/auth-v1/private" | "$OPENSSL" pkey -pubout 2>/dev/null)
check "the public key is the private key's" "$derived" "$(value "$P/auth/service_token/auth-v1/public")"
check "the private key went through a 0600 file" "$(jq -r --arg n "$P/auth/service_token/auth-v1/private#mode" '.[$n]' "$FAKE/ssm.json")" "0o600"
grep -q 'BEGIN' "$FAKE/calls" && fail "no key in a command line" || ok "no key in a command line (passed as file://)"
[[ "$out" != *BEGIN* ]] && ok "no key in the output" || fail "no key in the output" "$out"
[[ "$out" == *"auth: created auth-v1."* ]] && ok "says what it created" || fail "created message" "$out"
check "the temp files are gone" "$(find "$TMPDIR" -mindepth 1 | wc -l | tr -d ' ')" "0"

# -- re-running changes nothing ----------------------------------------------------------
before=$(value "$P/auth/service_token/auth-v1/private")
out=$(ensure_service_token_keys sp prod ap-south-1 "$VERSIONS" auth users 2>&1)
check "an existing pair is kept" "$(value "$P/auth/service_token/auth-v1/private")" "$before"
[[ "$out" == *"auth: auth-v1 already exists."* ]] && ok "says it's there" || fail "exists message" "$out"

# -- a half-written pair is replaced whole ---------------------------------------------
python3 - "$FAKE/ssm.json" "$P/users/service_token/users-v2/public" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s.pop(sys.argv[2]); json.dump(s, open(sys.argv[1], "w"))
PY
old_private=$(value "$P/users/service_token/users-v2/private")
ensure_service_token_keys sp prod ap-south-1 "$VERSIONS" users >/dev/null
[ "$(value "$P/users/service_token/users-v2/private")" != "$old_private" ] \
  && check "a private key without its public one gets a new pair" \
       "$(value "$P/users/service_token/users-v2/private" | "$OPENSSL" pkey -pubout 2>/dev/null)" "$(value "$P/users/service_token/users-v2/public")" \
  || fail "a half-written pair is replaced"

# -- rotation -----------------------------------------------------------------------------
echo '{"users": 2, "auth": 2}' > "$VERSIONS"
out=$(ensure_service_token_keys sp prod ap-south-1 "$VERSIONS" auth users 2>&1)
check "bumping a version makes a new kid and deletes the old one" "$(names | tr ',' '\n' | grep '/auth/' | paste -sd, -)" \
  "$P/auth/service_token/auth-v2/private,$P/auth/service_token/auth-v2/public"
[[ "$out" == *"auth: deleted the rotated-out auth-v1."* ]] && ok "says what it deleted" || fail "deleted message" "$out"

# -- errors ----------------------------------------------------------------------------------
if out=$(FAKE_FAIL=get-parameter ensure_service_token_keys sp prod ap-south-1 "$VERSIONS" auth 2>&1); then fail "a read error fails"; else
  [[ "$out" == *"could not read"* ]] && ! grep -q 'put-parameter.*auth-v2' <(tail -2 "$FAKE/calls") \
    && ok "a read error fails, and isn't taken for a missing key" || fail "read error" "$out"; fi
echo '{"auth": "two"}' > "$WORK/bad.json"
if out=$(ensure_service_token_keys sp prod ap-south-1 "$WORK/bad.json" auth 2>&1); then fail "a bad version fails"; else
  [[ "$out" == *"must be a whole number"* ]] && ok "a bad version fails" || fail "bad version message" "$out"; fi
echo '[]' > "$WORK/bad.json"
if ensure_service_token_keys sp prod ap-south-1 "$WORK/bad.json" auth >/dev/null 2>&1; then fail "a non-object file fails"; else ok "a non-object file fails"; fi
if ensure_service_token_keys sp prod ap-south-1 "$VERSIONS" >/dev/null 2>&1; then fail "no services fails"; else ok "no services fails"; fi
if out=$(OPENSSL=false ensure_service_token_keys sp prod ap-south-1 "$VERSIONS" children 2>&1); then fail "a failed key generation fails"; else
  [[ "$out" == *"could not create the service-token key pair children-v1"* ]] && [ -z "$(names | tr ',' '\n' | grep '/children/' || true)" ] \
    && ok "a failed key generation fails and writes nothing" || fail "keygen failure" "$out"; fi

# -- destroy ------------------------------------------------------------------------------
python3 - "$FAKE/ssm.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
for i in range(12):  # more than one delete-parameters batch
    s[f"/sp/prod/backend/ap-south-1/s{i}/service_token/s{i}-v1/public"] = {"type": "String", "value": "x"}
s["/sp/prod/backend/ap-south-1/ecs_services"] = {"type": "String", "value": "[]"}
json.dump(s, open(sys.argv[1], "w"))
PY
out=$(delete_service_token_keys sp prod ap-south-1)
check "destroy deletes every key parameter, in batches of 10, and nothing else" "$(names)" "$P/ecs_services"
check "says how many" "$out" "Deleted 16 service-token key parameter(s) under $P."
check "nothing to delete is fine" "$(delete_service_token_keys sp prod ap-south-1)" "Deleted 0 service-token key parameter(s) under $P."

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
