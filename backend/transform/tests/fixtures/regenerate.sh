#!/usr/bin/env bash
# Regenerates normalised.json: what the web app's normalizeLifePathwayArea (lib/lifePathwayData.ts)
# returns for llm_answers.json, by running that code with Node (types stripped; Node 22.18+).
# transform's port must give the same output (test_pathway.py).
#
#   backend/transform/tests/fixtures/regenerate.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source="$here/../../../../frontend/src/lib/lifePathwayData.ts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
{
  sed -n '/^export const AGE_OFFSETS/p; /^export const MILESTONE_SLOTS/p' "$source"
  sed -n '/^export interface MilestoneCopy/,/^}/p' "$source"
  sed -n '/^function str(/,/^}/p; /^function readMilestone(/,/^}/p' "$source"
  sed -n '/^export function normalizeLifePathwayArea(/,/^}/p' "$source"
  sed -n '/^const MAX_SLOT_DEPTH/p; /^function collectSlots(/,/^}/p' "$source"
  cat <<'JS'
import { readFileSync } from 'node:fs';
type Case = { age: number; answer: unknown };
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case[];
const out = cases.map((c) => normalizeLifePathwayArea(c.answer, AGE_OFFSETS.map((o) => c.age + o)));
process.stdout.write(JSON.stringify({ age_offsets: AGE_OFFSETS, slots: MILESTONE_SLOTS, normalised: out }, null, 2) + '\n');
JS
} > "$work/pathway.ts"
node --no-warnings "$work/pathway.ts" "$here/llm_answers.json" > "$here/normalised.json"
echo "wrote transform/tests/fixtures/normalised.json"
