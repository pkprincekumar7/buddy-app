/**
 * Prompts + schemas for the generate_growth_parent_questions and
 * generate_growth_child_rounds jobs.
 *
 * One call covers one growth area, one stage. The two stages are deliberately
 * separate jobs run in sequence rather than one call returning both: the child's
 * either/or rounds are generated *after* the parent submits their reflections,
 * so they can be grounded in what the parent actually wrote. Their latency then
 * hides behind the handoff beat while the parent reads "hand the screen over".
 */

import {
  GAME_ROUNDS_PER_AREA,
  ICON_KEYS,
  PARENT_QUESTIONS_PER_AREA,
  AREA_ARCHETYPES,
  copyTokensFor,
  tagsForArea,
} from '@/lib/growthAreaData';
import type { GrowthArea } from '@/lib/growthAreaData';
import { questionnaireMarkdown } from '@/lib/prompts';
import { normalizeAge } from '@/lib/insightsUtils';

/** One reflection the parent was asked, with what they answered. */
export interface QAPair {
  question: string;
  answer: string;
}

/** Context both stages share — the child, their profile, and the area in play. */
export interface GrowthQuestionsContext {
  area: GrowthArea;
  childName: string | null | undefined;
  childGender: string | null | undefined;
  /** Raw child record; the questionnaire block is derived from it. */
  childData: Record<string, unknown> | null | undefined;
  archetype: string | null | undefined;
  personalityNarrative: string | null | undefined;
  traits: string[] | null | undefined;
  /** goals.parent_concern — what the parent said they are actually worried about. */
  parentConcern?: string | null;
}

function sharedContextLines(ctx: GrowthQuestionsContext): string[] {
  const { area, childData } = ctx;
  const name = ctx.childName?.trim() ? ctx.childName.trim() : 'the child';
  const t = copyTokensFor(ctx.childGender);
  const age = normalizeAge(childData?.age) ?? 'unknown';

  const lines: string[] = [];
  lines.push('Child profile:');
  lines.push(`• Name: ${name}`);
  lines.push(`• Age: ${age}`);
  lines.push(`• Refer to ${name} as ${t.he}/${t.his}/${t.him}`);
  if (ctx.archetype?.trim()) lines.push(`• Personality archetype: The ${ctx.archetype.trim()}`);
  if (ctx.personalityNarrative?.trim())
    lines.push(`• Personality summary: ${ctx.personalityNarrative.trim()}`);
  if (ctx.traits?.length) lines.push(`• Traits: ${ctx.traits.join(', ')}`);
  lines.push('');
  lines.push('Questionnaire the parent completed at onboarding:');
  lines.push('"""');
  lines.push(questionnaireMarkdown(childData ?? {}));
  lines.push('"""');
  lines.push('');
  lines.push(`Growth area: ${area.name} — ${area.description}`);
  if (ctx.parentConcern?.trim()) {
    lines.push('');
    lines.push(`What the parent said they are most concerned about: "${ctx.parentConcern.trim()}"`);
  }
  return lines;
}

// ─── Stage 1: the parent's five reflections ───────────────────────────────────

export function buildGrowthParentQuestionsPrompt(ctx: GrowthQuestionsContext): string {
  const name = ctx.childName?.trim() ? ctx.childName.trim() : 'the child';
  const t = copyTokensFor(ctx.childGender);

  const lines: string[] = [];
  lines.push(
    `You are a child development specialist. Write the ${String(PARENT_QUESTIONS_PER_AREA)} reflection questions a parent will answer about their own child for the growth area "${ctx.area.name}". Their answers are the raw material for a personalised development plan, so each question has to pull out something a generic questionnaire would miss.`,
  );
  lines.push('');
  lines.push(...sharedContextLines(ctx));
  lines.push('');
  lines.push(
    'Each question has two fields, both strict word limits — go over and the response is rejected:',
  );
  lines.push(
    `- "question": what you are asking the parent. Maximum 22 words. Address the parent directly about ${name}, ending in a question mark.`,
  );
  lines.push(
    '- "hint": a short nudge under the question pointing at a concrete moment to recall. Maximum 14 words. Not a rephrasing of the question.',
  );
  lines.push('');
  lines.push('Instructions:');
  lines.push(
    `- Ask only about things the parent has actually witnessed ${name} do or say. A parent can describe a specific afternoon; they cannot reliably rate ${t.his} "resilience". Never ask them to score, rank or diagnose.`,
  );
  lines.push(
    `- Ground every question in this specific child. Use the questionnaire, the archetype and the concern above so the questions could not have been written for a different ${String(normalizeAge(ctx.childData?.age) ?? 'child')}-year-old.`,
  );
  lines.push(
    '- Order them so they get progressively harder to answer: question 1 recalls something easy and concrete, question 5 asks the parent to notice a pattern they may not have named before.',
  );
  lines.push(
    `- Every question must be specific to "${ctx.area.name}". Do not drift into the other growth areas.`,
  );
  lines.push(
    '- Ask about observed behaviour, not the parent\'s hopes. "What does he do when…" beats "How would you like him to…".',
  );
  lines.push(
    '- One question per question. No compound questions joined by "and" that leave the parent answering only half.',
  );
  lines.push(
    `- Write ${name}'s name and pronouns literally. Do not output template placeholders like {name} or {he}.`,
  );
  lines.push(
    '- Warm, plain, parent-facing language. No clinical or developmental-psychology jargon.',
  );
  lines.push('');
  lines.push(
    `Return ONLY a JSON object with a "questions" array of exactly ${String(PARENT_QUESTIONS_PER_AREA)} objects, each with "question" (≤22 words) and "hint" (≤14 words), in the order the parent will answer them.`,
  );

  return lines.join('\n');
}

export function growthParentQuestionsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['questions'],
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        minItems: PARENT_QUESTIONS_PER_AREA,
        maxItems: PARENT_QUESTIONS_PER_AREA,
        items: {
          type: 'object',
          required: ['question', 'hint'],
          additionalProperties: false,
          properties: {
            question: {
              type: 'string',
              maxLength: 160,
              description: 'At most 22 words. Addressed to the parent, ending in a question mark.',
            },
            hint: {
              type: 'string',
              maxLength: 110,
              description: 'At most 14 words. A nudge towards a concrete moment, not a rephrasing.',
            },
          },
        },
      },
    },
  };
}

// ─── Stage 2: the child's six either/or rounds ────────────────────────────────

export function buildGrowthChildRoundsPrompt({
  qa,
  ...ctx
}: GrowthQuestionsContext & {
  /**
   * The questions the parent was actually asked, paired with what they answered.
   * Passed in rather than looked up because for an area answered before questions
   * were generated, the accurate record of what was asked is the hardcoded set.
   */
  qa: QAPair[];
}): string {
  const name = ctx.childName?.trim() ? ctx.childName.trim() : 'the child';
  const areaId = ctx.area.id;
  const tags = tagsForArea(areaId);
  const archetypes = AREA_ARCHETYPES[areaId] ?? {};

  const qaContext = qa.map(({ question, answer }) => `Q: ${question}\nA: ${answer}`).join('\n\n');

  const tagList = tags
    .map((tag) => `- "${tag}" — points towards ${archetypes[tag]?.title ?? tag}`)
    .join('\n');

  const lines: string[] = [];
  lines.push(
    `You are a child development specialist designing a short either/or game a child plays on a screen. ${String(GAME_ROUNDS_PER_AREA)} rounds, two options per round, and the child taps the one they would rather have. Their pattern of choices reveals where they lean within the growth area "${ctx.area.name}".`,
  );
  lines.push('');
  lines.push(...sharedContextLines(ctx));
  lines.push('');
  lines.push(`What ${name}'s parent just told us about this area:`);
  lines.push('"""');
  lines.push(qaContext || '(the parent left their reflections blank)');
  lines.push('"""');
  lines.push('');
  lines.push('Every option must carry one of these tags, and no others:');
  lines.push(tagList);
  lines.push('');
  lines.push(`Every option must carry one of these icon keys, and no others:`);
  lines.push(ICON_KEYS.join(', '));
  lines.push('');
  lines.push(
    'Each option has four fields — the word limits are strict, go over and the response is rejected:',
  );
  lines.push(
    '- "text": the choice as the child reads it. Maximum 12 words. Second person, starting with a verb.',
  );
  lines.push('- "star": a 1–2 word label for this choice on a constellation. Title case.');
  lines.push('- "tag": exactly one tag from the list above.');
  lines.push('- "icon": exactly one icon key from the list above, matching the option\'s content.');
  lines.push('');
  lines.push('Instructions:');
  lines.push(
    `- Write to the child, not the parent. No name, no pronouns, no "your child" — ${name} is reading this directly. "Build a robot that does your chores", not "He builds a robot".`,
  );
  lines.push(
    '- Both options in a round must be genuinely exciting. If one is obviously the better answer the round measures nothing — the child must actually have to choose.',
  );
  lines.push(
    '- The two options in a round MUST carry different tags. A round with the same tag on both sides cannot discriminate and is wasted.',
  );
  lines.push(
    `- Spread the tags across the ${String(GAME_ROUNDS_PER_AREA)} rounds so the winning tag is earned. Use at least four distinct tags overall, and do not let one tag appear in more than three rounds.`,
  );
  lines.push(
    `- Use the parent's answers to make the options concrete to ${name}'s real world — their actual interests, activities and friendships — without ever quoting the parent back or revealing that a parent was asked.`,
  );
  lines.push(
    `- Age-appropriate throughout: these must be things a ${String(normalizeAge(ctx.childData?.age) ?? 'young')}-year-old would find genuinely thrilling.`,
  );
  lines.push(
    `- Every option must belong to "${ctx.area.name}". Do not drift into the other growth areas.`,
  );
  lines.push('- Concrete and vivid, never abstract. Name a thing that happens, not a quality.');
  lines.push('');
  lines.push(
    `Return ONLY a JSON object with a "rounds" array of exactly ${String(GAME_ROUNDS_PER_AREA)} objects, each with an "a" and a "b" option object holding "text", "star", "tag" and "icon".`,
  );

  return lines.join('\n');
}

/**
 * Takes areaId because the tag vocabulary is per-area — the enum is what keeps a
 * generated tag resolvable by topArchetype. Serialises well inside the 4000-char
 * cap on response_json_schema.
 */
export function growthChildRoundsSchema(areaId: string): Record<string, unknown> {
  const option = {
    type: 'object',
    required: ['text', 'star', 'tag', 'icon'],
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        maxLength: 90,
        description: 'At most 12 words. Addressed to the child in second person.',
      },
      star: { type: 'string', maxLength: 14, description: 'A 1–2 word constellation label.' },
      tag: { type: 'string', enum: tagsForArea(areaId) },
      icon: { type: 'string', enum: [...ICON_KEYS] },
    },
  };
  return {
    type: 'object',
    required: ['rounds'],
    additionalProperties: false,
    properties: {
      rounds: {
        type: 'array',
        minItems: GAME_ROUNDS_PER_AREA,
        maxItems: GAME_ROUNDS_PER_AREA,
        items: {
          type: 'object',
          required: ['a', 'b'],
          additionalProperties: false,
          properties: { a: option, b: option },
        },
      },
    },
  };
}
