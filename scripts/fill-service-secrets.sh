#!/usr/bin/env bash
# shellcheck shell=bash
#
# Fills each backend service's Secrets Manager secret on its first apply
# (terraform-live-backend.yml). Terraform creates every
# <app>/<env>/<service>-secrets with REPLACE_ME for each of its keys
# (infra-live-backend/terraform/secrets.tf); this writes the real values from the
# GitHub environment, once. A secret with its required keys already set is left
# alone, so values rotated by hand are never overwritten.
#
# Source it:  source scripts/fill-service-secrets.sh
#             fill_service_secrets "$(terraform output -json service_secret_arns)"
#
# Values come from the environment, never from arguments:
#   MONGODB_URIS       JSON object, service → its own MONGODB_URI (one Atlas user each)
#   JWT_PRIVATE_KEY    auth
#   EMAIL_HMAC_PEPPER  auth
#   GOOGLE_CLIENT_ID   auth (may be empty: Google Sign-In off)
#   OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
#                      generating services and platform; an unset one stays REPLACE_ME
# The keys come from the secret itself, so a key added in secrets.tf needs a case
# in value_for and nothing else. Values are never printed.
#
# Needs: aws (credentials for the secrets' region), jq.
# Tests: scripts/fill-service-secrets.test.sh (runs against a fake `aws`).

# Keys that may stay REPLACE_ME: each service needs at least one LLM key, which
# the workflow checks before apply, not every one.
OPTIONAL_SECRET_KEYS='["OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY"]'

# value_for SERVICE KEY → the value to write for KEY in SERVICE's secret, or an
# error naming what's missing.
value_for() {
  local service="$1" key="$2"
  case "$key" in
    MONGODB_URI)
      jq -er --arg s "$service" '.[$s] | select(type == "string" and length > 0)' <<<"${MONGODB_URIS:-}" 2>/dev/null \
        || { echo "ERROR: MONGODB_URIS has no entry for '$service' (a JSON object, service → its MONGODB_URI)." >&2; return 1; } ;;
    JWT_PRIVATE_KEY | EMAIL_HMAC_PEPPER)
      [ -n "${!key:-}" ] || { echo "ERROR: $key is not set (needed by $service)." >&2; return 1; }
      printf '%s' "${!key}" ;;
    GOOGLE_CLIENT_ID)
      printf '%s' "${GOOGLE_CLIENT_ID:-}" ;;
    OPENAI_API_KEY | ANTHROPIC_API_KEY | GEMINI_API_KEY)
      printf '%s' "${!key:-REPLACE_ME}" ;;
    *)
      echo "ERROR: $service's secret has a key this script doesn't know: $key. Add it to value_for in scripts/fill-service-secrets.sh." >&2
      return 1 ;;
  esac
}

# needs_init SECRET_JSON → success if a required key is still REPLACE_ME, or if
# every key is (an untouched secret, such as platform's, whose only key is optional).
needs_init() {
  jq -e --argjson opt "$OPTIONAL_SECRET_KEYS" '
    to_entries
    | any(.value == "REPLACE_ME" and (.key as $k | $opt | index($k) | not))
      or all(.value == "REPLACE_ME")' <<<"$1" >/dev/null
}

# secret_json SERVICE KEYS_JSON → the full secret JSON for SERVICE, every key filled.
secret_json() {
  local service="$1" keys="$2" key value out='{}'
  while IFS= read -r key; do
    value=$(value_for "$service" "$key") || return 1
    out=$(jq -c --arg k "$key" --arg v "$value" '. + {($k): $v}' <<<"$out")
  done < <(jq -r '.[]' <<<"$keys")
  printf '%s\n' "$out"
}

# fill_service_secrets ARNS_JSON — ARNS_JSON is service → secret ARN (Terraform's
# service_secret_arns output). Every secret that needs filling is built first;
# nothing is written unless all of them can be, so a missing value leaves no
# secret half-done.
fill_service_secrets() {
  local arns="$1" service arn current body
  local -a to_fill=() bodies=() arns_to_fill=()
  while IFS=$'\t' read -r service arn; do
    current=$(aws secretsmanager get-secret-value --secret-id "$arn" --query SecretString --output text) || {
      echo "ERROR: could not read $service's secret ($arn)." >&2
      return 1
    }
    if ! needs_init "$current"; then
      echo "$service: already set — left alone (rotate with put-secret-value, docs/infra-operations.md)."
      continue
    fi
    body=$(secret_json "$service" "$(jq -c 'keys_unsorted' <<<"$current")") || return 1
    bodies+=("$body")
    to_fill+=("$service")
    arns_to_fill+=("$arn")
  done < <(jq -r 'to_entries[] | [.key, .value] | @tsv' <<<"$arns")

  local i
  for i in "${!to_fill[@]}"; do
    aws secretsmanager put-secret-value --secret-id "${arns_to_fill[$i]}" --secret-string "${bodies[$i]}" >/dev/null || {
      echo "ERROR: could not write ${to_fill[$i]}'s secret." >&2
      return 1
    }
    echo "${to_fill[$i]}: initialised."
  done
}
