#!/usr/bin/env bash
# Regenerates normalised.json from llm_answers.json.
#
# The web-derived part: what the web app's lib/observationsData.ts returns, run with Node
# (types stripped; Node 22.18+): the icon keys, and each case's items from
# normalizeObservations with its allowed child game-result lines. release's port must give
# the same output (test_observations.py).
#
# The release-only part: choosing which items to keep (release.app.observations.select) and
# the icons the model may pick (SELECTABLE_ICON_KEYS) have no web counterpart any more, so
# each case's "selection" and the "selectable" list are kept as they are in normalised.json.
# A new case starts without a selection; write it by hand from what select should return.
#
#   backend/release/tests/fixtures/regenerate.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source="$here/../../../../frontend/src/lib/observationsData.ts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
{
  cat "$source"
  cat <<'JS'
import { existsSync, readFileSync } from 'node:fs';
type Case = { answer: unknown; allowed: string[] | null; sources: string[] };
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case[];
const previous = existsSync(process.argv[3])
  ? (JSON.parse(readFileSync(process.argv[3], 'utf8')) as {
      selectable?: unknown;
      cases?: { selection?: unknown }[];
    })
  : {};
const out = cases.map((c, i) => {
  const items = normalizeObservations(c.answer, c.allowed ? { allowedChildLines: c.allowed } : undefined);
  const selection = previous.cases?.[i]?.selection;
  return selection === undefined ? { items } : { items, selection };
});
process.stdout.write(
  JSON.stringify(
    { icon_keys: Object.keys(OBSERVATION_ICONS), selectable: previous.selectable ?? [], cases: out },
    null,
    2,
  ) + '\n',
);
JS
} > "$work/observations.ts"
node --no-warnings "$work/observations.ts" "$here/llm_answers.json" "$here/normalised.json" > "$work/normalised.json"
mv "$work/normalised.json" "$here/normalised.json"
echo "wrote release/tests/fixtures/normalised.json"
