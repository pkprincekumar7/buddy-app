#!/usr/bin/env bash
# Regenerates normalised.json: what the web app's lib/observationsData.ts returns for
# llm_answers.json (normalizeObservations with each case's allowed child-choice lines, then
# selectObservations with its sources), plus the icon keys, by running that code with Node
# (types stripped; Node 22.18+). release's port must give the same output (test_observations.py).
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
import { readFileSync } from 'node:fs';
type Case = { answer: unknown; allowed: string[] | null; sources: ObservationSourceKey[] };
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case[];
const out = cases.map((c) => {
  const items = normalizeObservations(c.answer, c.allowed ? { allowedChoiceNotes: c.allowed } : undefined);
  return { items, selection: selectObservations(items, c.sources) };
});
process.stdout.write(JSON.stringify({ icon_keys: Object.keys(OBSERVATION_ICONS), selectable: SELECTABLE_ICON_KEYS, cases: out }, null, 2) + '\n');
JS
} > "$work/observations.ts"
node --no-warnings "$work/observations.ts" "$here/llm_answers.json" > "$here/normalised.json"
echo "wrote release/tests/fixtures/normalised.json"
