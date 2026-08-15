/**
 * Prompt + schema for the generate_life_pathway job.
 *
 * One call covers one growth area: the six age milestones shown on the Life
 * Pathway chart. Scoped this narrowly so the page can generate lazily as the
 * parent moves through the dropdown, rather than blocking on all six areas.
 */

import { normalizeRecommendations } from '@/lib/growthAreaData';
import type { GrowthArea } from '@/lib/growthAreaData';
import { AGE_OFFSETS, MILESTONE_SLOTS } from '@/lib/lifePathwayData';

/**
 * One required object per milestone slot, rather than an array of six.
 *
 * An array with minItems/maxItems is only advisory here — the call runs in plain
 * JSON mode, and providers were observed returning five entries for six
 * requested ages, silently dropping one from the middle. Six named, individually
 * required keys make the same omission a schema violation instead.
 *
 * The keys are offsets (y1…y10), never absolute ages: the app accepts ages 8–30,
 * so age-based keys would mean a different schema for every child. Offsets come
 * from AGE_OFFSETS, so this schema is identical for a 9-year-old and a 29-year-old
 * — only the prompt's slot→age mapping below changes. Serialises to ~1.2 KB,
 * well inside the 4000-char cap on response_json_schema.
 *
 * No `age` field: the page always labels each slot from the child's real age, so
 * a model-supplied age could only ever contradict it.
 */
export function lifePathwayAreaSchema(): Record<string, unknown> {
  const milestone = {
    type: 'object',
    required: ['title', 'guided', 'power', 'drift'],
    // Closed: a provider was observed nesting each slot inside the previous one
    // (y2 inside y1, six deep) rather than emitting siblings. Stating that a
    // milestone holds nothing but its four strings makes that shape invalid
    // rather than merely unexpected.
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      guided: { type: 'string' },
      power: { type: 'string' },
      drift: { type: 'string' },
    },
  };
  return {
    type: 'object',
    required: [...MILESTONE_SLOTS],
    additionalProperties: false,
    properties: Object.fromEntries(MILESTONE_SLOTS.map((slot) => [slot, milestone])),
  };
}

function pronouns(gender: string | null | undefined) {
  const g = gender?.trim().toLowerCase();
  if (g === 'male') return { subj: 'he', poss: 'his', obj: 'him' };
  if (g === 'female') return { subj: 'she', poss: 'her', obj: 'her' };
  return { subj: 'they', poss: 'their', obj: 'them' };
}

export function buildLifePathwayAreaPrompt({
  childName,
  age,
  gender,
  archetype,
  personalityNarrative,
  strengths,
  area,
  answers,
  recommendations,
}: {
  childName: string | null | undefined;
  age: number;
  gender: string | null | undefined;
  archetype: string | null | undefined;
  personalityNarrative: string | null | undefined;
  strengths: string[] | null | undefined;
  area: GrowthArea;
  /** Raw stored answers — values are filtered to non-empty strings below. */
  answers: Record<string, unknown> | null | undefined;
  recommendations: unknown;
}): string {
  const name = childName?.trim() ? childName.trim() : 'the child';
  const p = pronouns(gender);
  const ages = AGE_OFFSETS.map((o) => age + o);

  const answerLines = Object.entries(answers ?? {}).flatMap(([q, v]) =>
    typeof v === 'string' && v.trim() ? [`• ${q}: ${v.trim()}`] : [],
  );

  const recLines = normalizeRecommendations(recommendations)
    .map((r) => `• ${r.title}${r.detail ? ` — ${r.detail}` : ''}`)
    .join('\n');

  const lines: string[] = [];

  lines.push(
    `You are writing the "${area.name}" section of a long-term development pathway that a parent is reading about their own child. It projects what changes each year if ${name} is actively developed, versus what happens by default.`,
  );
  lines.push('');
  lines.push('Child profile:');
  lines.push(`• Name: ${name}`);
  lines.push(`• Current age: ${String(age)}`);
  lines.push(`• Refer to ${name} as ${p.subj}/${p.poss}/${p.obj}`);
  if (archetype) lines.push(`• Personality archetype: The ${archetype}`);
  if (personalityNarrative) lines.push(`• Personality summary: ${personalityNarrative}`);
  if (strengths?.length) lines.push(`• Strengths: ${strengths.join(', ')}`);
  lines.push('');
  lines.push(`Growth area: ${area.name} — ${area.description}`);

  if (answerLines.length) {
    lines.push('');
    lines.push(`What the parent told us about ${name} in this area:`);
    lines.push(...answerLines);
  }
  if (recLines) {
    lines.push('');
    lines.push('Recommendations already given to this parent for this area:');
    lines.push(recLines);
    lines.push(
      `Stay consistent with these — the milestones should read like where those recommendations lead over ten years.`,
    );
  }

  lines.push('');
  lines.push('--- Task ---');
  lines.push('');
  // The slot→age mapping is the only age-dependent part of the contract; the
  // schema's keys are fixed. Restating each key next to the age it covers keeps
  // the model from having to infer the correspondence.
  lines.push(
    `Return one object under each of these ${String(MILESTONE_SLOTS.length)} keys. Every key is required — do not omit, rename, merge or add keys:`,
  );
  MILESTONE_SLOTS.forEach((slot, i) => {
    lines.push(`  "${slot}" — ${name} at age ${String(ages[i])}`);
  });
  lines.push('');
  lines.push(
    `All ${String(MILESTONE_SLOTS.length)} keys sit side by side at the top level of the JSON object. Do not nest one inside another — "${MILESTONE_SLOTS[1]}" is a sibling of "${MILESTONE_SLOTS[0]}", not a field within it. Each key's value contains only the four fields below and no further keys.`,
  );
  lines.push('');
  lines.push('Each of those objects has exactly these four fields:');
  lines.push(
    `• "title" — what ${name} achieves that year in this area. Under 9 words, present tense, starting with "${p.subj.charAt(0).toUpperCase() + p.subj.slice(1)}" where it reads naturally (e.g. "${p.subj.charAt(0).toUpperCase() + p.subj.slice(1)} finishes something for the first time"). It must be a concrete, observable change — not a feeling or a label.`,
  );
  lines.push(
    `• "guided" — 1–2 sentences describing what that year actually looks like on the supported path. Name a specific, real activity a ${String(ages[0])}-to-${String(ages[ages.length - 1])}-year-old could plausibly do. Max 32 words.`,
  );
  lines.push(
    `• "power" — one sentence on what the programme specifically does that year to make it happen (a weekly prompt, a tracked habit, a logged project, a profile insight). Concrete mechanism, not a promise. Max 24 words.`,
  );
  lines.push(
    `• "drift" — one or two short sentences on what happens instead if nothing changes: the ordinary, unremarkable default. Honest and specific, never cruel and never about ${name} being deficient. Max 22 words.`,
  );
  lines.push('');
  lines.push('Rules:');
  lines.push(
    `• The ${String(MILESTONE_SLOTS.length)} milestones must escalate in key order. "${MILESTONE_SLOTS[0]}" (age ${String(ages[0])}) is a first small win; "${MILESTONE_SLOTS[MILESTONE_SLOTS.length - 1]}" (age ${String(ages[ages.length - 1])}) is ${name} choosing ${p.poss} own direction with evidence behind ${p.obj}.`,
  );
  lines.push(
    `• Ground every milestone in the profile and parent answers above. Do not invent facts about ${name} — no named friends, schools, teachers, hobbies or events that were not given to you.`,
  );
  lines.push(
    `• Age-appropriate throughout: what fits at ${String(ages[0])} must not be what fits at ${String(ages[ages.length - 1])}.`,
  );
  lines.push(
    '• Plain, warm, parent-facing language. No clinical or coaching jargon, no exclamation marks, no emoji, no markdown.',
  );
  lines.push(
    `• Write ${p.subj}/${p.poss}/${p.obj} literally. Do not output template placeholders such as {he} or {name}.`,
  );
  if (p.subj === 'they') {
    // The app's own copy solves this with a verb-ending token ({s}/{es}/{ies} in
    // growthAreaData); generated prose has no such mechanism and defaults to the
    // singular, producing "They names one goal". Worth spelling out.
    lines.push(
      `• "${p.subj}" here is singular but takes plural verb forms: "${p.subj} write", "${p.subj} keep", "${p.subj} are" — never "${p.subj} writes" or "${p.subj} is". Where the subject is ${name} rather than the pronoun, keep the singular: "${name} writes".`,
    );
  }

  return lines.join('\n');
}
