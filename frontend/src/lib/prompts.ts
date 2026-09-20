/**
 * LLM prompt builder functions.
 * Centralised here so component files stay readable and prompts can be versioned independently.
 */

import { slimChildConversationForStorage } from '@/lib/onboardingChildData';
import { normalizeAge } from '@/lib/insightsUtils';

/**
 * Placeholder returned by questionnaireMarkdown when nothing is stored. Exported
 * because callers need to distinguish "no evidence" from a real block, and
 * sniffing the literal text would silently start treating this sentinel as
 * evidence the moment someone reworded it.
 */
export const NO_QUESTIONNAIRE = '(no questionnaire stored yet)';

// Formats stored questionnaire fields into a readable markdown block for LLM prompts.
export function questionnaireMarkdown(mergedDraft: Record<string, unknown>): string {
  const slim = slimChildConversationForStorage(mergedDraft);
  const labelFor: Record<string, string> = {
    name: 'Name',
    age: 'Age',
    gender: 'Gender',
    school: 'School',
    strengths: 'Top strengths',
    hobbies: 'Hobbies',
    thinking_pattern: 'Thinking pattern',
    communication_style: 'Communication style',
    energy_level: 'Energy level',
    social_behaviour: 'Social behaviour',
    emotional_behaviour: 'Emotional behaviour',
  };
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(slim)) {
    const lbl = labelFor[k] ?? k;
    pairs.push(Array.isArray(v) ? `${lbl}: ${v.join(', ')}` : `${lbl}: ${String(v)}`);
  }
  return pairs.length ? pairs.join('\n') : NO_QUESTIONNAIRE;
}

// Brief archetype descriptors injected into the personality prompt so the LLM can
// match accurately without needing to guess what each key means.
const ARCHETYPE_DESCRIPTORS: Record<string, string> = {
  Ambitious: 'goal-driven, competitive, motivated by achievement and future success',
  Determined: 'focused, hardworking, resilient, finishes what they start',
  Outgoing: 'friendly, sociable, confident, energised by people and social settings',
  Creative: 'imaginative, inventive, expressive, drawn to ideas and self-expression',
  Enthusiastic: 'excitable, optimistic, passionate, brings positive energy to everything',
  Restless: 'curious, variety-seeking, quick-moving, gets bored with repetition',
  'Highly Energetic':
    'active, vibrant, high-stamina, thrives in physical and multi-tasking contexts',
  Thinker: 'analytical, observant, deep-thinking, loves questions and problem-solving',
  Playful: 'joyful, spontaneous, light-hearted, approaches life with humour and fun',
};

export function buildPersonalityAnalysisPrompt({
  childData,
  personalityTypeKeys,
}: {
  childData: Record<string, unknown>;
  personalityTypeKeys: string[];
}): string {
  const questionnaireMd = questionnaireMarkdown(childData);
  const childName = (typeof childData.name === 'string' ? childData.name : '').replace(/"/g, '');
  const age = normalizeAge(childData.age) ?? 'unknown';
  const gender = typeof childData.gender === 'string' ? childData.gender : 'unknown';

  const archetypeList = personalityTypeKeys
    .map((k) => `  • ${k} — ${ARCHETYPE_DESCRIPTORS[k] ?? 'see context'}`)
    .join('\n');

  return `You are a child development specialist analysing a single child using a Buddy360 onboarding questionnaire completed by their parent/caregiver.

Return JSON ONLY that conforms to the response schema. Use warm, parent-friendly language throughout all human-facing fields.

Child profile:
• Age: ${age}
• Gender: ${gender}

Collected questionnaire responses:
"""
${questionnaireMd}
"""

Available personality archetypes (dominant_style must be EXACTLY one of these keys):
${archetypeList}

Pronoun guidance: use ${gender.toLowerCase() === 'female' ? 'she/her' : gender.toLowerCase() === 'male' ? 'he/his' : 'they/their'} pronouns for ${childName} in all human-facing text fields.

Requirements:
• dominant_style: Select the single archetype that best fits the child's questionnaire answers, taking their age and gender into account. A 10-year-old and a 15-year-old showing similar answers may map to different archetypes due to developmental stage differences.
• personality_category: must be one of: motivators, socializers, creatives, adventurers. Use this exact mapping — do not deviate:
  - Ambitious, Determined → motivators
  - Outgoing, Playful → socializers
  - Creative, Enthusiastic → creatives
  - Restless, Highly Energetic, Thinker → adventurers
• secondary_styles: up to TWO additional archetypes (different from dominant_style) that partially describe the child, each with a prominence score of 40–92. Base these strictly on questionnaire evidence.
• personalized_traits: 4–6 concise trait chips that are directly anchored in the parent's actual answers and the dominant archetype. Do not invent traits — only include what the questionnaire supports.
• personalized_description: EXACTLY ONE sentence (max 160 characters), written warmly for the parent/caregiver. Mention "${childName}" naturally once. Connect specific questionnaire cues to temperament. Use the correct pronoun. No invented facts, no second sentence, no bullets, no line breaks.
• personalized_growth_areas: 4–7 specific, actionable growth opportunities. Each bullet must: (a) name a concrete skill or behaviour gap visible in the questionnaire answers, (b) be appropriate for the child's age (${age}) and gender (${gender}), and (c) be something a parent can meaningfully work on with the child. Write each bullet using the correct pronoun.
• role_models: EXACTLY two well-known, admirable public figures whose temperament and life story genuinely match the dominant archetype, and who are relatable and inspiring for a ${age}-year-old ${gender} child. For each provide: name (full name) and caption (a 4–6 word lowercase phrase describing what made them notable, e.g. "wondered about everything", "never stopped asking why").
• strength_summary_bullets: exactly 6 strength-focused bullets. Draw solely from what the parent's answers directly support — do not infer beyond the evidence. If extrapolating, frame it as a possibility, not a fact.
• trait_scores: 4–5 named mind-dimension scores (0–100 integers) that are directly grounded in the questionnaire evidence. Label each dimension concisely (e.g. "Curiosity", "Focus Power", "Creativity", "Social Energy"). Scores must reflect the actual questionnaire answers — do not invent.
• child_quote: A short, vivid first-person phrase (max 110 characters) that sounds like it could genuinely come from this child based on the questionnaire cues. Use the correct pronoun. No invented facts.
• parent_note: One or two warm, actionable sentences of parenting advice specific to this personality type and the questionnaire evidence. Address the parent directly ("Your child…"). Max 200 characters.`;
}

export function buildGrowthAreaRecommendationsPrompt({
  childName,
  childAge,
  childGender,
  areaName,
  qaContext,
  childGameSummary,
  childGameStrengths,
  childGameSuggestedActivities,
  childChoices,
  childArchetype,
  parentFeedback,
}: {
  childName: string;
  childAge?: number | string | null;
  childGender?: string | null;
  areaName: string;
  qaContext: string;
  /** Legacy image-pick fields — still supplied by the onboarding flow. */
  childGameSummary?: string | null;
  childGameStrengths?: string[] | null;
  childGameSuggestedActivities?: string[] | null;
  /** The six either/or options the child actually chose, in round order. */
  childChoices?: string[] | null;
  /** Archetype derived from those choices, e.g. "The Builder — …". */
  childArchetype?: { title: string; line: string } | null;
  parentFeedback?: string | null;
}): string {
  const legacyGameSection =
    childGameSummary || childGameStrengths?.length || childGameSuggestedActivities?.length
      ? `\n\nChild's own game responses for this area:
- Summary: ${childGameSummary ?? '(not available)'}
- Strengths observed: ${childGameStrengths?.length ? childGameStrengths.join(', ') : '(none recorded)'}
- Activities the child showed interest in: ${childGameSuggestedActivities?.length ? childGameSuggestedActivities.join(', ') : '(none recorded)'}`
      : '';

  // The redesigned flow has the child pick one of two options per round. The
  // picks are the child's own voice, so they matter as much as the parent's
  // answers — state them verbatim rather than only the derived archetype.
  const choicesSection = childChoices?.length
    ? `\n\n${childName}'s own choices for this area (one per round, ${childChoices.length} rounds):
${childChoices.map((c, i) => `${i + 1}. ${c}`).join('\n')}${
        childArchetype
          ? `\n\nPattern those choices form: "${childArchetype.title}" — ${childArchetype.line}`
          : ''
      }`
    : '';

  const childGameSection = choicesSection || legacyGameSection;

  const feedbackSection = parentFeedback?.trim()
    ? `\n\nParent's feedback on suggested activities: "${parentFeedback}"`
    : '';

  return `You are a child development specialist. Based on the parent's responses and the child's own game activity responses, generate 5 personalised 3-month recommendations for the growth area "${areaName}".

Child profile:
- Name: ${childName}
- Age: ${childAge ?? 'unknown'}
- Gender: ${childGender ?? 'unknown'}

Parent's responses:
${qaContext}${childGameSection}${feedbackSection}

Each recommendation has two fields, both strict word limits — go over and the response is rejected:
- "title": a short, concrete label for the action. Maximum 10 words. No trailing period. Must stand alone without the detail.
- "detail": one instruction covering what to do and how often. Maximum 25 words. Do not restate the title, and do not restate the age/gender/area — every word must be new information.

Instructions:
- Before generating recommendations, identify the single most significant gap or challenge the child has in the "${areaName}" area based on the data above. Recommendation 1's title must name that gap directly — do not bury it in positive framing.
- Synthesise both the parent's perspective and the child's own responses; do not produce generic advice that could apply to any child.
- Order the 5 recommendations progressively: recommendation 1 addresses the core gap and is something the parent can start in week 1; recommendations 2–3 build on that foundation; recommendations 4–5 represent more advanced or consolidated practice by month 3.
- These 5 recommendations feed directly into a personalised 3-month goal plan, so the progression must be realistic and achievable.
- Given the word limits, each detail should carry exactly one instruction — the action and its frequency. Drop success criteria, caveats, and explanations; say the single most important thing and stop.
- Be honest: if the data shows the child genuinely struggles in this area, reflect that in the tone and urgency of early recommendations, within the same word limits.

Return ONLY a JSON object with a "recommendations" array of exactly 5 objects, each with "title" (≤10 words) and "detail" (≤25 words), specific to the "${areaName}" growth area.`;
}

/**
 * Release-page observations. This prompt is unusually restrictive on purpose: the
 * page it feeds tells the parent "Superpower records what you notice. It draws no
 * conclusions and labels nothing." Every constraint below traces back to keeping
 * that sentence true.
 *
 * The hard one is the ban list. Read the six patterns a screening instrument
 * would look for in this age band — inattention, decoding difficulty, sensory
 * sensitivity, motor restlessness, expressive sequencing, social reciprocity —
 * and a model clustering parent-reported behaviour will land on them unprompted,
 * because that is genuinely what the evidence looks like. Producing that set
 * under warm phrasing is de-facto screening output, which this product is not and
 * must not read as. So the ban is on the vocabulary AND on the move: describe the
 * behaviour the parent described, in their words, and stop there.
 */
export function buildObservationsPrompt({
  childName,
  childAge,
  childGender,
  questionnaireMd,
  growthAreaContext,
  childActivityContext,
  iconKeys,
}: {
  childName: string;
  childAge?: number | string | null;
  childGender?: string | null;
  /** Onboarding questionnaire block, or '' when nothing is stored. */
  questionnaireMd: string;
  /** Per-area Q&A the parent has answered in Grow, or '' when none. */
  growthAreaContext: string;
  /** The child's own forced-choice picks from the Grow rounds, or '' when none. */
  childActivityContext: string;
  iconKeys: readonly string[];
}): string {
  const age = normalizeAge(childAge) ?? 'unknown';
  const gender = typeof childGender === 'string' && childGender ? childGender : 'unknown';
  const pronouns =
    gender.toLowerCase() === 'female'
      ? 'she/her'
      : gender.toLowerCase() === 'male'
        ? 'he/his'
        : 'they/their';

  const blocks: string[] = [];
  const presentKeys: string[] = [];
  if (questionnaireMd) {
    presentKeys.push('onboarding');
    blocks.push(
      `[SOURCE: onboarding] Onboarding questionnaire, answered by the parent:\n"""\n${questionnaireMd}\n"""`,
    );
  }
  if (growthAreaContext) {
    presentKeys.push('grow');
    blocks.push(
      `[SOURCE: grow] Growth-area reflections, answered by the parent:\n"""\n${growthAreaContext}\n"""`,
    );
  }
  if (childActivityContext) {
    presentKeys.push('child');
    blocks.push(
      `[SOURCE: child] ${childName}'s own picks in the Grow rounds. Each line is a forced choice between two options WE offered — ${childName} tapped one, so these are choices, not quotations:\n"""\n${childActivityContext}\n"""`,
    );
  }
  // Rule 5 is the per-source guarantee that selectObservations enforces. It must
  // only ever name blocks that are actually present above — an earlier version
  // interpolated the count but kept prose referring to the grow block
  // unconditionally, which told a questionnaire-only child's prompt about a
  // source it had never been given.
  const rule5 =
    presentKeys.length === 1
      ? `5. There is one source block above (${presentKeys[0]}). Everything you return must be grounded in it.`
      : `5. There are ${presentKeys.length} source blocks above (${presentKeys.join(', ')}), so AT LEAST ${presentKeys.length} of your observations must each cite a different one. Count them before you answer. A longer block is not a more important one: one block may hold a handful of fields while another holds thirty answers, and both still get represented.`;

  return `You are helping a parent see the patterns in what THEY have already told us about their child. You are a careful listener writing back what you heard. You are not an assessor.

Child: ${childName}, age ${age}, gender ${gender}. Use ${pronouns} pronouns.

Every evidence block below is tagged with the source key you must cite for anything you draw from it.

${blocks.join('\n\n')}

Return JSON ONLY conforming to the response schema.

HOW TO BUILD THE SET
1. Return EXACTLY six observations. Not five, not seven.
2. Read across EVERY block before deciding what the six are. You are describing six different facets of one child — how attention works, how ${childName} communicates, what settles ${childName}, what ${childName} chooses, what ${childName} avoids, what ${childName} is drawn to. Two observations a parent would read as the same point waste a slot.
3. Prefer merging two halves of one answer into a single richer observation. If merging everything mergeable leaves you short of six, do NOT split a pattern back apart to pad the count — return to the blocks and find a facet you have not used.
4. Every observation must rest on something in the blocks above. If you cannot trace it, drop it and find another.
${rule5}
6. A pattern that shows up in MORE THAN ONE block is the strongest thing this page can offer, because it has turned up more than once. Group it into ONE observation citing every block it appears in, and put those observations FIRST in your list. Something the parent described that ${childName}'s own choices also point to is worth more than either on its own — do not split it into two cards and lose that.

FIELD RULES
• title — at most 8 words, and it must READ AS A PATTERN, containing a verb. Not a noun fragment lifted out of the answer.
  Good: "Attention runs long on chosen projects" · "Settles better outdoors than indoors" · "Reading aloud runs slower than talking"
  Bad, because it is a category: "Sensory sensitivity" · "Executive function"
  Bad, because it is a fragment that tells the parent nothing: "Three things to do" · "Sit with a Lego build" · "Lego and focus"
• summary — ONE sentence, max 28 words, addressed to the parent, using ${pronouns}. It states the pattern the notes are facets of. It must NOT restate any single note, and must not simply string the notes together: if the parent could delete this sentence and lose nothing, rewrite it.
• notes — EXACTLY 2 or 3 points. These carry the value of the card. They are NOT a transcript, and a parent who has just written those answers gains nothing from being read them back.
  – From the onboarding or grow blocks: NEVER copy a sentence out of the block. Turn what it tells you into a specific observation. "I have to call him twice for dinner" is input; "Needs a second call before dinner lands once absorbed" is a note.
  – Each note must add something the summary does NOT say, and something no other note on this card says. If two notes could merge without losing information, you have written one note twice — replace it.
  – Reword and sharpen only. Do NOT add a fact, cause, motive or consequence the evidence does not contain. Every note must stay traceable to the block it came from.
  – From the child block, the ONE exception to rewording: copy the line EXACTLY as written, whole, in its Chose “X” over “Y” form. Do not reword it, summarise it, or re-pair halves of two different lines. This is not stylistic — the two options in a round are the one thing you cannot paraphrase without risking claiming ${childName} chose something ${childName} actually rejected, and the rejected side is half the meaning. Reproduce a line verbatim or leave it out.
  – ${childName} tapped one of two options WE wrote and said nothing, so never present a choice as ${childName}'s words or as speech.
  Do NOT wrap a note in quotation marks — the page frames them itself. Quote marks belong only inside a child-block line, around each of the two options.
• sources — every source key whose block you actually drew on for this pattern. Cite honestly; do not add a key for a block you did not use.
• icon — closest match from: ${iconKeys.join(', ')}.

WHAT THE BAN BELOW IS AND IS NOT
Describing a behaviour the parent described, in the parent's own words, is always allowed — including behaviour around reading, attention, noise or social situations. That is the whole product. What is banned is NAMING it as a category, or implying it should be looked into. "Reading aloud runs slower than talking" is required of you if the parent said it. "Possible reading difficulty" is forbidden. Do not resolve this tension by dropping the observation: silently omitting what the parent raised is the worst available outcome, worse than either extreme.

FORBIDDEN — these break the product's core promise to the parent
• No diagnostic or screening vocabulary, in any field, including as a hedge. Never use: disorder, syndrome, condition, deficit, ADHD, ADD, autism, autistic, ASD, spectrum, neurodivergent, dyslexia, dyslexic, dyspraxia, sensory processing disorder, SPD, ODD, anxiety, depression, impairment, disability, delay, symptom, trait marker, clinical, diagnosis, assessment, screening.
• Do not suggest the child be assessed, screened, evaluated, or seen by a professional. That is not this page's job. Note the parent may themselves be wondering whether to raise something with a teacher — reflect that they said it, but do not answer the question for them.
• No frequency or repetition claims. You have single-sitting answers, not a log, so you cannot know how often anything happens. Never write "often", "always", "usually", "frequently", "repeatedly", "tends to", "every time", or any count. Write what was reported, not how often it occurs.
• No comparison to other children or to developmental norms. Never "for ${String(age)}-year-olds", "behind", "ahead", "below average", "typical", "advanced", "struggles with".
• No cause-and-effect explanation of why the child is like this. Report the pattern; do not theorise the mechanism.
• Do not rank the patterns by concern, and do not flag any of them as the important one.`;
}
