#!/usr/bin/env bash
# shellcheck shell=bash
#
# The service-token key pairs (docs/auth-users-split.md, 13.2), made outside Terraform so
# no private key is ever in Terraform state or a plan (production-readiness review, SEC-01).
# One Ed25519 pair per service and kid (`<service>-v<N>`, N from
# infra-live-backend/terraform/service-token-versions.json), in the backend region's SSM:
#
#   /<app>/<env>/backend/<region>/<service>/service_token/<kid>/private   SecureString
#   /<app>/<env>/backend/<region>/<service>/service_token/<kid>/public    String
#
# Terraform reads the public keys (INTERNAL_PUBLIC_KEYS) and points each runtime's
# INTERNAL_SIGNING_KEY at its service's private parameter, which only that service's
# execution role may read (service_tokens.tf, iam.tf).
#
# Source it:
#   source scripts/service-token-keys.sh
#   ensure_service_token_keys APP ENV REGION VERSIONS_JSON SERVICE...   # before plan/apply
#   delete_service_token_keys APP ENV REGION                            # after destroy
#
# ensure creates a pair only where the kid's private parameter is missing, so it's safe to
# run on every plan; an existing pair is never changed. A service's other kids (from before
# a rotation) are deleted, as rotation always worked: the old public key isn't kept. A
# private key goes to SSM through a 0600 temp file, never an argument or the log.
#
# Needs: aws (credentials for REGION), jq, OpenSSL 3 (`openssl`, or $OPENSSL).
# Tests: scripts/service-token-keys.test.sh (runs against a fake `aws`).

# service_token_prefix APP ENV REGION SERVICE → the SSM path a service's kids live under.
service_token_prefix() {
  printf '/%s/%s/backend/%s/%s/service_token\n' "$1" "$2" "$3" "$4"
}

# service_token_kid VERSIONS_JSON SERVICE → `<service>-v<N>` (N defaults to 1).
service_token_kid() {
  local version
  version=$(jq -er --arg s "$2" '.[$s] // 1 | select(type == "number" and . >= 1 and . == floor)' "$1") || {
    echo "ERROR: $1: the version for '$2' must be a whole number of 1 or more." >&2
    return 1
  }
  printf '%s-v%s\n' "$2" "$version"
}

# _param_exists REGION NAME → success if the parameter exists. Any error but "not found"
# fails, so a throttle or a missing permission never passes for "create a new key".
_param_exists() {
  local out
  if out=$(aws ssm get-parameter --region "$1" --name "$2" --query Parameter.Name --output text 2>&1); then
    return 0
  fi
  if [[ "$out" == *ParameterNotFound* ]]; then
    return 1
  fi
  echo "ERROR: could not read $2: $out" >&2
  return 2
}

# _kids_under REGION PREFIX → the kids that have parameters under PREFIX, one per line.
_kids_under() {
  aws ssm get-parameters-by-path --region "$1" --path "$2" --recursive \
    --query 'Parameters[].Name' --output json \
    | jq -r --arg p "$2/" '.[] | ltrimstr($p) | split("/")[0]' | sort -u
}

# _put REGION NAME TYPE FILE: writes FILE's content as the parameter's value (replacing a
# half-written pair's leftover).
_put() {
  aws ssm put-parameter --region "$1" --name "$2" --type "$3" --value "file://$4" --overwrite >/dev/null
}

# _new_pair REGION PREFIX KID: generates a pair and writes it; public first, so a private
# key is never stored without the public key the others verify with.
_new_pair() {
  local region="$1" prefix="$2" kid="$3" dir status=0
  dir=$(mktemp -d)
  chmod 700 "$dir"
  (
    umask 077
    "${OPENSSL:-openssl}" genpkey -algorithm ed25519 -out "$dir/private.pem" 2>/dev/null \
      && "${OPENSSL:-openssl}" pkey -in "$dir/private.pem" -pubout -out "$dir/public.pem" 2>/dev/null
  ) || status=1
  if [ "$status" -eq 0 ]; then
    _put "$region" "$prefix/$kid/public" String "$dir/public.pem" \
      && _put "$region" "$prefix/$kid/private" SecureString "$dir/private.pem" || status=1
  fi
  rm -rf "$dir"
  [ "$status" -eq 0 ] || echo "ERROR: could not create the service-token key pair $kid." >&2
  return "$status"
}

# ensure_service_token_keys APP ENV REGION VERSIONS_JSON SERVICE...
ensure_service_token_keys() {
  local app="$1" env="$2" region="$3" versions="$4" service prefix kid old private public
  shift 4
  [ "$#" -gt 0 ] || { echo "ERROR: no services given." >&2; return 1; }
  jq -e 'type == "object"' "$versions" >/dev/null 2>&1 || {
    echo "ERROR: $versions isn't a JSON object of service → key version." >&2
    return 1
  }
  for service in "$@"; do
    prefix=$(service_token_prefix "$app" "$env" "$region" "$service")
    kid=$(service_token_kid "$versions" "$service") || return 1
    _param_exists "$region" "$prefix/$kid/private" && private=0 || private=$?
    _param_exists "$region" "$prefix/$kid/public" && public=0 || public=$?
    if [ "$private" -eq 2 ] || [ "$public" -eq 2 ]; then
      return 1
    elif [ "$private" -eq 0 ] && [ "$public" -eq 0 ]; then
      echo "$service: $kid already exists."
    else
      # A half-written pair (a public key alone, after a failed run) is replaced whole.
      _new_pair "$region" "$prefix" "$kid" || return 1
      echo "$service: created $kid."
    fi
    while IFS= read -r old; do
      [ -n "$old" ] && [ "$old" != "$kid" ] || continue
      aws ssm delete-parameters --region "$region" \
        --names "$prefix/$old/private" "$prefix/$old/public" >/dev/null || return 1
      echo "$service: deleted the rotated-out $old."
    done < <(_kids_under "$region" "$prefix")
  done
}

# delete_service_token_keys APP ENV REGION: every service's pairs, after a destroy.
delete_service_token_keys() {
  local app="$1" env="$2" region="$3" path batch count=0
  local -a names
  path="/$app/$env/backend/$region"
  # Ten names per line: what delete-parameters takes at most. SSM names have no spaces.
  while IFS= read -r batch; do
    [ -n "$batch" ] || continue
    read -ra names <<<"$batch"
    aws ssm delete-parameters --region "$region" --names "${names[@]}" >/dev/null || return 1
    count=$((count + ${#names[@]}))
  done < <(aws ssm get-parameters-by-path --region "$region" --path "$path" --recursive \
    --query 'Parameters[].Name' --output json \
    | jq -r '[.[] | select(test("/service_token/[^/]+/(private|public)$"))] | _nwise(10) | join(" ")')
  echo "Deleted $count service-token key parameter(s) under $path."
}
