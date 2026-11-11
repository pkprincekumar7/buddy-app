#!/usr/bin/env bash
# Regenerates view_models.json: today's adaptAiPersonalityToViewModel (the web app's
# PersonalityAnalysis.tsx, with personalizedDescriptionOneLiner), copied verbatim and run
# by Node on llm_answers.json. discover's port must give the same output (test_personality.py).
#
#   backend/discover/tests/fixtures/regenerate.sh
#
# Needs Node 22.18+ (it runs TypeScript with the types stripped).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
web="$here/../../../../frontend/src"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
{
  sed -n '/^interface PersonalityTypeEntry/,/^}/p; /^export const personalityTypes/,/^};/p' \
    "$web/components/shared/PersonalityAnalysis.tsx" | grep -v eslint-disable
  sed -n '/^interface FamousPerson/,/^}/p' "$web/components/shared/PersonalityAnalysis.tsx"
  sed -n '/^export function personalizedDescriptionOneLiner/,/^}/p' \
    "$web/lib/personalizedDescriptionOneLiner.ts"
  sed -n '/^export const PERSONALITY_TYPE_KEYS/,/^const PERSONALITY_CATEGORY_KEYS/p; /^interface AiPersonalityInput/,/^}/p; /^export function adaptAiPersonalityToViewModel/,/^}/p' \
    "$web/components/shared/PersonalityAnalysis.tsx" | grep -v eslint-disable
  cat <<'JS'
import { readFileSync } from 'node:fs';
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = cases.map((c: { answer: object; name: string | undefined }) =>
  adaptAiPersonalityToViewModel(c.answer as AiPersonalityInput, c.name ?? undefined));
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
JS
} > "$work/adapter.ts"
node --no-warnings "$work/adapter.ts" "$here/llm_answers.json" > "$here/view_models.json"
echo "wrote $here/view_models.json"
