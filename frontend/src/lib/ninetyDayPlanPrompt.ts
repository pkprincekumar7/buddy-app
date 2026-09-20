/**
 * Prompts + schemas for the generate_ninety_day_plan and generate_event_tracker
 * jobs — the two LLM-generated pieces of the "Start {name}'s 90 days" flow
 * (StartJourneyModal's Dashboard/Tracker steps). Everything else in that flow
 * (subscription UI, the feedback-tag copy, the stats grid) stays static; see
 * `@/lib/startJourneyPlans` for the fallback content and shared shapes
 * (`Plan`, `PlanActivity`, `PlanFieldKind`, `TrackStep`, `TrackFieldType`).
 *
 * Both prompts write literal names/pronouns, matching `buildLifePathwayAreaPrompt`'s
 * convention: `fillTemplate`'s `{he}`/`{his}`/`{name}` tokens are a build-time
 * mechanism for this app's own static copy, never meant for LLM output.
 */

function pronouns(gender: string | null | undefined) {
  const g = gender?.trim().toLowerCase();
  if (g === 'male') return { subj: 'he', poss: 'his', obj: 'him' };
  if (g === 'female') return { subj: 'she', poss: 'her', obj: 'her' };
  return { subj: 'they', poss: 'their', obj: 'them' };
}

// ─── The 3-month/9-activity plan (Dashboard step) ─────────────────────────────

/**
 * Matches the `Plan` interface in `@/lib/startJourneyPlans`. Kept free of
 * per-field `description` strings — relying on the prompt text for guidance
 * instead — to stay well inside the 4000-character cap on response_json_schema
 * (this schema serialises to ~1.2 KB).
 */
export function ninetyDayPlanSchema(): Record<string, unknown> {
  const doField = {
    type: 'object',
    required: ['k', 'kind', 'label'],
    additionalProperties: false,
    properties: {
      k: { type: 'string', maxLength: 20 },
      kind: { type: 'string', enum: ['text', 'area', 'date', 'count', 'num', 'photo'] },
      label: { type: 'string', maxLength: 60 },
      ph: { type: 'string', maxLength: 40 },
      target: { type: 'number' },
      stepBy: { type: 'number' },
    },
  };
  const activity = {
    type: 'object',
    required: ['n', 'time', 'title', 'award', 'objective', 'apply', 'do'],
    additionalProperties: false,
    properties: {
      n: { type: 'string', enum: ['01', '02', '03', '04', '05', '06', '07', '08', '09'] },
      time: { type: 'string', maxLength: 30 },
      title: { type: 'string', maxLength: 60 },
      award: { type: 'string', maxLength: 30 },
      objective: { type: 'string', maxLength: 160 },
      apply: { type: 'string', maxLength: 160 },
      do: { type: 'array', minItems: 1, maxItems: 4, items: doField },
    },
  };
  return {
    type: 'object',
    required: ['metric', 'goals', 'acts'],
    additionalProperties: false,
    properties: {
      metric: { type: 'string', maxLength: 60 },
      goals: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', maxLength: 220 } },
      acts: { type: 'array', minItems: 9, maxItems: 9, items: activity },
    },
  };
}

export function buildNinetyDayPlanPrompt({
  childName,
  age,
  gender,
  ask,
  archetype,
  personalityNarrative,
  strengths,
}: {
  childName: string | null | undefined;
  age: number | string | null | undefined;
  gender: string | null | undefined;
  /** The Ask step's free text — what the parent said the child is into, in their own words. */
  ask: string;
  archetype?: string | null;
  personalityNarrative?: string | null;
  strengths?: string[] | null;
}): string {
  const name = childName?.trim() ? childName.trim() : 'the child';
  const p = pronouns(gender);
  const ageLabel = age != null && age !== '' ? String(age) : 'unknown';

  const lines: string[] = [];
  lines.push(
    `You are designing a 90-day self-directed development plan for ${name}, grounded entirely in one thing the parent just told us:`,
  );
  lines.push('');
  lines.push(`In the parent's own words: "${ask.trim()}"`);
  lines.push('');
  lines.push('Child profile:');
  lines.push(`• Age: ${ageLabel}`);
  lines.push(`• Refer to ${name} as ${p.subj}/${p.poss}/${p.obj}`);
  if (archetype) lines.push(`• Personality archetype: The ${archetype}`);
  if (personalityNarrative) lines.push(`• Personality summary: ${personalityNarrative}`);
  if (strengths?.length) lines.push(`• Strengths: ${strengths.join(', ')}`);
  lines.push('');
  lines.push('--- Task ---');
  lines.push('');
  lines.push(
    `Return a 3-month plan built around what the parent said above, not a generic curriculum. "metric" is the one number that tracks real progress in this specific pursuit (e.g. "Keepy-uppies in a row" for football, "Finished pieces" for a maker) — pick whatever actually measures growth in what the parent described.`,
  );
  lines.push('');
  lines.push(
    '"goals" is exactly 3 strings — one per month, each one sentence stating the concrete, observable bar cleared by day 30 / day 60 / day 90. Escalate: day 30 is a habit taking hold, day 60 is that habit tested in front of someone outside the house, day 90 is a finished, shown, undeniable result.',
  );
  lines.push('');
  lines.push(
    '"acts" is exactly 9 activities, 3 per month in month order (activities 1-3 = month 1, 4-6 = month 2, 7-9 = month 3). Each activity:',
  );
  lines.push(`  • "n": "01" through "09" in order.`);
  lines.push(`  • "time": the cadence, e.g. "15 min daily" or "Once a week".`);
  lines.push(`  • "title": a short, concrete name for the activity. Max 8 words.`);
  lines.push(`  • "award": a 1-3 word badge name for finishing it, e.g. "Streak keeper".`);
  lines.push(
    `  • "objective": one sentence, the specific, checkable outcome that makes this activity done.`,
  );
  lines.push(
    `  • "apply": one sentence on how ${name} actually does this — the real-world action, not an abstraction.`,
  );
  lines.push(
    `  • "do": 1-4 fields the parent/${name} fill in as evidence, each with a "kind": "text" (one line), "area" (a few sentences), "date", "num" (a plain number), "count" (a running tally — set "target" to the number that finishes it, and "stepBy" if it should count up by more than 1 at a time), or "photo" (import a photo as proof). Pick whichever kinds genuinely fit what this activity produces — don't default to the same kind every time.`,
  );
  lines.push('');
  lines.push('Rules:');
  lines.push(
    `  • Every activity must be something a ${ageLabel}-year-old can actually do largely unsupervised — age-appropriate difficulty and independence throughout.`,
  );
  lines.push(
    `  • Ground everything in what the parent actually said. Do not invent facts about ${name} beyond the profile above.`,
  );
  lines.push(
    `  • Write ${name}'s name and ${p.subj}/${p.poss}/${p.obj} literally throughout. Do not output template placeholders such as {he} or {name}.`,
  );
  lines.push(
    `  • Months escalate in difficulty and independence — month 3's activities assume the habits from months 1-2 are already in place.`,
  );

  return lines.join('\n');
}

// ─── The 9-step event tracker (Tracker step) ──────────────────────────────────

/**
 * Text-only: `title`/`short`/`when`/`body`/`fields`. Deliberately excludes the
 * icon SVG (`paths`), the photo-import flag (`up`) and which step gets the
 * 4-week sittings grid (`sittings`) — those are structural/design decisions
 * merged in locally by step index from the static `TRACK` template (see
 * `mergeTrackSteps` in `@/lib/startJourneyPlans`), never left to the model.
 */
export function ninetyDayTrackerSchema(): Record<string, unknown> {
  const field = {
    type: 'object',
    required: ['k', 'label', 'type'],
    additionalProperties: false,
    properties: {
      k: { type: 'string', maxLength: 20 },
      label: { type: 'string', maxLength: 60 },
      ph: { type: 'string', maxLength: 40 },
      type: { type: 'string', enum: ['text', 'date', 'note'] },
    },
  };
  const step = {
    type: 'object',
    required: ['title', 'short', 'when', 'body', 'fields'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', maxLength: 40 },
      short: { type: 'string', maxLength: 20 },
      when: { type: 'string', maxLength: 40 },
      body: { type: 'string', maxLength: 160 },
      fields: { type: 'array', minItems: 1, maxItems: 4, items: field },
    },
  };
  return {
    type: 'object',
    required: ['steps'],
    additionalProperties: false,
    properties: {
      steps: { type: 'array', minItems: 9, maxItems: 9, items: step },
    },
  };
}

export function buildNinetyDayTrackerPrompt({
  childName,
  age,
  gender,
  interestLabel,
  eventName,
  eventDate,
}: {
  childName: string | null | undefined;
  age: number | string | null | undefined;
  gender: string | null | undefined;
  /** e.g. "football" — the matched/typed interest label, for flavour only. */
  interestLabel: string;
  /** The specific Day-90 target event the parent named inside the Dashboard. */
  eventName: string;
  eventDate: string;
}): string {
  const name = childName?.trim() ? childName.trim() : 'the child';
  const p = pronouns(gender);
  const ageLabel = age != null && age !== '' ? String(age) : 'unknown';

  const lines: string[] = [];
  lines.push(
    `You are writing the 9 steps of a countdown tracker that walks ${name} to a single named event — not a generic milestone list, a plan for THIS event:`,
  );
  lines.push('');
  lines.push(`Event: "${eventName.trim()}", on ${eventDate}.`);
  lines.push(`Built around: ${interestLabel}.`);
  lines.push(`Child: ${name}, age ${ageLabel}. Refer to ${name} as ${p.subj}/${p.poss}/${p.obj}.`);
  lines.push('');
  lines.push('--- Task ---');
  lines.push('');
  lines.push(
    `Return exactly 9 steps, in the order ${name} works through them counting down to the event above. Each step:`,
  );
  lines.push(`  • "title": short, concrete. Max 6 words.`);
  lines.push(`  • "short": an even shorter label for a step-rail chip. Max 3 words.`);
  lines.push(
    `  • "when": roughly when this step happens relative to the event, e.g. "6 weeks out".`,
  );
  lines.push(`  • "body": one or two sentences on what actually happens in this step.`);
  lines.push(
    `  • "fields": 1-4 fields ${name}/the parent fill in as evidence, each "type": "text" (one line), "date", or "note" (a few sentences).`,
  );
  lines.push('');
  lines.push('Rules:');
  lines.push(
    `  • Escalate toward the named event: early steps are preparation, the final 1-2 steps are the event itself and confirming it happened.`,
  );
  lines.push(`  • Age-appropriate for a ${ageLabel}-year-old throughout.`);
  lines.push(
    `  • Write ${name}'s name and ${p.subj}/${p.poss}/${p.obj} literally. Do not output template placeholders such as {he} or {name}.`,
  );
  lines.push(`  • Stay specific to "${eventName.trim()}" — do not drift into a generic checklist.`);

  return lines.join('\n');
}
