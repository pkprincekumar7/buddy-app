#!/usr/bin/env bash
# shellcheck shell=bash
#
# Fills each backend service's Secrets Manager secret on its first apply
# (terraform-live-backend.yml). Terraform creates every
# <app>/<env>/<service>-secrets with REPLACE_ME for each of its keys
# (infra-live-backend/terraform/secrets.tf); this writes the real values from the
# GitHub environment. Only keys still REPLACE_ME are filled, one by one; a key with
# any other value is kept as it is, so values rotated by hand are never overwritten
# (production-readiness review, SEC-05). A secret with nothing to fill isn't written.
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
#                      generating services and shared; an unset one stays REPLACE_ME
# The keys come from the secret itself, so a key added in secrets.tf needs a case
# in value_for and nothing else. Values are never printed.
#
# Needs: aws (credentials for the secrets' region), jq.
# Tests: scripts/fill-service-secrets.test.sh (runs against a fake `aws`).

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
    # May stay REPLACE_ME: each service needs at least one LLM key, which the
    # workflow checks before apply, not every one.
    OPENAI_API_KEY | ANTHROPIC_API_KEY | GEMINI_API_KEY)
      printf '%s' "${!key:-REPLACE_ME}" ;;
    *)
      echo "ERROR: $service's secret has a key this script doesn't know: $key. Add it to value_for in scripts/fill-service-secrets.sh." >&2
      return 1 ;;
  esac
}

# secret_json SERVICE CURRENT_JSON → CURRENT_JSON with each REPLACE_ME key filled;
# every other key, and the key order, as they were. Only the keys being filled need
# a value, so a GitHub secret removed after the first apply doesn't block later ones.
secret_json() {
  local service="$1" out="$2" key value
  while IFS= read -r key; do
    value=$(value_for "$service" "$key") || return 1
    out=$(jq -c --arg k "$key" --arg v "$value" '.[$k] = $v' <<<"$out")
  done < <(jq -r 'to_entries[] | select(.value == "REPLACE_ME") | .key' <<<"$out")
  printf '%s\n' "$out"
}

# fill_service_secrets ARNS_JSON — ARNS_JSON is service → secret ARN (Terraform's
# service_secret_arns output). Every secret with a key to fill is built first;
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
    body=$(secret_json "$service" "$current") || return 1
    if jq -e --argjson new "$body" '. == $new' <<<"$current" >/dev/null; then
      echo "$service: already set — left alone (rotate with put-secret-value, docs/infra-operations.md)."
      continue
    fi
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
