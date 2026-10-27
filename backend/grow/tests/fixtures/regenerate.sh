#!/usr/bin/env bash
# Regenerates grow's data and its parity fixtures from the web app's lib/growthAreaData.ts,
# run by Node with the types stripped (Node 22.18+):
#   - grow/app/area_data.json: the six areas (id, name, description), each area's archetypes
#     (the child rounds' tags), the icon keys and the per-area counts;
#   - tests/fixtures/normalised.json: what normalizeGeneratedQuestions, normalizeGeneratedRounds
#     and normalizeRecommendations return for tests/fixtures/llm_answers.json (icons as keys).
# grow's port must give the same output (test_areas.py).
#
#   backend/grow/tests/fixtures/regenerate.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source="$here/../../../../frontend/src/lib/growthAreaData.ts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
{
  # The module after its icon import, minus the React icon components and the dev warning.
  sed -n '/^\/\/ ─── Name, pronoun/,$p' "$source" \
    | grep -v 'icon: typeof Rocket' \
    | sed -E '/^    icon: [A-Z][A-Za-z]*,$/d; s/import\.meta\.env\.DEV/false/'
  cat <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const [, , answersPath, dataPath, outPath] = process.argv;
const keyFor = new Map(Object.entries(ICON_PATHS).map(([k, v]) => [v, k]));
if (keyFor.size !== Object.keys(ICON_PATHS).length) throw new Error('icon paths are not unique');
const data = {
  areas: GROWTH_AREAS.map((a) => ({ id: a.id, name: a.name, description: a.description })),
  archetypes: AREA_ARCHETYPES,
  icon_keys: ICON_KEYS,
  parent_questions_per_area: PARENT_QUESTIONS_PER_AREA,
  game_rounds_per_area: GAME_ROUNDS_PER_AREA,
  copy_tokens: { male: copyTokensFor('male'), female: copyTokensFor('female'), other: copyTokensFor('') },
};
writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
type Case = { kind: string; area_id: string; answer: unknown };
const cases = JSON.parse(readFileSync(answersPath, 'utf8')) as Case[];
const out = cases.map((c) => {
  if (c.kind === 'parent_questions') return normalizeGeneratedQuestions(c.answer, c.area_id);
  if (c.kind === 'recommendations') return normalizeRecommendations(c.answer);
  const rounds = normalizeGeneratedRounds(c.answer, c.area_id);
  return rounds && rounds.map((r) => ({
    a: { ...r.a, icon: keyFor.get(r.a.icon) },
    b: { ...r.b, icon: keyFor.get(r.b.icon) },
  }));
});
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
JS
} > "$work/areas.ts"
node --no-warnings "$work/areas.ts" "$here/llm_answers.json" "$here/../../app/area_data.json" \
  "$here/normalised.json"
echo "wrote grow/app/area_data.json and tests/fixtures/normalised.json"
