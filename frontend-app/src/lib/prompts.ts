/**
 * LLM prompt builder functions.
 * Centralised here so component files stay readable and prompts can be versioned independently.
 */

import { slimChildConversationForStorage } from '@/lib/onboardingChildData';
import { normalizeAge } from '@/lib/insightsUtils';

// Formats stored questionnaire fields into a readable markdown block for LLM prompts.
export function questionnaireMarkdown(
  mergedDraft: Record<string, unknown>,
): string {
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
    pairs.push(
      Array.isArray(v) ? `${lbl}: ${v.join(', ')}` : `${lbl}: ${String(v)}`,
    );
  }
  return pairs.length ? pairs.join('\n') : '(no questionnaire stored yet)';
}

// Brief archetype descriptors injected into the personality prompt so the LLM can
// match accurately without needing to guess what each key means.
const ARCHETYPE_DESCRIPTORS: Record<string, string> = {
  Ambitious:
    'goal-driven, competitive, motivated by achievement and future success',
  Determined: 'focused, hardworking, resilient, finishes what they start',
  Outgoing:
    'friendly, sociable, confident, energised by people and social settings',
  Creative:
    'imaginative, inventive, expressive, drawn to ideas and self-expression',
  Enthusiastic:
    'excitable, optimistic, passionate, brings positive energy to everything',
  Restless:
    'curious, variety-seeking, quick-moving, gets bored with repetition',
  'Highly Energetic':
    'active, vibrant, high-stamina, thrives in physical and multi-tasking contexts',
  Thinker:
    'analytical, observant, deep-thinking, loves questions and problem-solving',
  Playful:
    'joyful, spontaneous, light-hearted, approaches life with humour and fun',
};

// Maps the three life-phase bucket strings to human-readable labels.
const LIFE_PHASE_LABELS: Record<string, string> = {
  foundation:
    'Foundation (age 8–11) — building core habits, identity, and learning skills',
  exploration:
    'Exploration (age 12–14) — early adolescence, self-discovery, peer influence',
  direction:
    'Direction (age 15+) — mid-to-late adolescence, goal setting, future orientation',
};

export function buildPersonalityAnalysisPrompt({
  childData,
  personalityTypeKeys,
}: {
  childData: Record<string, unknown>;
  personalityTypeKeys: string[];
}): string {
  const questionnaireMd = questionnaireMarkdown(childData);
  const childName = (
    typeof childData.name === 'string' ? childData.name : ''
  ).replace(/"/g, '');
  const age = normalizeAge(childData.age) ?? 'unknown';
  const gender =
    typeof childData.gender === 'string' ? childData.gender : 'unknown';

  const archetypeList = personalityTypeKeys
    .map(k => `  • ${k} — ${ARCHETYPE_DESCRIPTORS[k] ?? 'see context'}`)
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

Pronoun guidance: use ${
    gender.toLowerCase() === 'female'
      ? 'she/her'
      : gender.toLowerCase() === 'male'
      ? 'he/his'
      : 'they/their'
  } pronouns for ${childName} in all human-facing text fields.

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
• role_models: EXACTLY two well-known, admirable public figures whose temperament and life story genuinely match the dominant archetype, and who are relatable and inspiring for a ${age}-year-old ${gender} child. Provide full names only.
• strength_summary_bullets: exactly 6 strength-focused bullets. Draw solely from what the parent's answers directly support — do not infer beyond the evidence. If extrapolating, frame it as a possibility, not a fact.`;
}

export function buildJourneyRecommendationsPrompt({
  childData,
  age,
  lifePhase,
  personalityType,
  personalityNarrative,
  growthAreas,
}: {
  childData: Record<string, unknown>;
  age: number | string | null | undefined;
  lifePhase: string | null | undefined;
  personalityType: string | null | undefined;
  personalityNarrative: string | null | undefined;
  growthAreas: string[] | null | undefined;
}): string {
  const questionnaireMd = questionnaireMarkdown(childData);
  const growthAreasBullets =
    Array.isArray(growthAreas) && growthAreas.length
      ? growthAreas.map(x => `• ${x}`).join('\n')
      : '(not captured)';
  const strengths = Array.isArray(childData.strengths)
    ? (childData.strengths as unknown[]).join(', ')
    : 'unknown';
  const hobbies = Array.isArray(childData.hobbies)
    ? (childData.hobbies as unknown[]).join(', ')
    : 'unknown';
  const childName =
    typeof childData.name === 'string' ? childData.name : 'the child';
  const gender =
    typeof childData.gender === 'string' ? childData.gender : 'unknown';
  const lifePhaseLabel =
    (lifePhase && LIFE_PHASE_LABELS[lifePhase]) ?? lifePhase ?? 'unknown';

  return `You are a child development specialist. Based on the questionnaire responses and personality analysis below, generate a personalised Buddy360 journey plan for ${childName}. Write all content in warm, encouraging, parent-facing language.

Child profile:
• Name: ${childName}
• Age: ${String(age ?? 'unknown')}
• Gender: ${gender}
• Life phase: ${lifePhaseLabel}
• School: ${
    typeof childData.school === 'string' ? childData.school : 'not captured'
  }

Questionnaire responses:
"""
${questionnaireMd}
"""

Personality analysis:
• Archetype: ${personalityType ?? 'Unknown'}
• Summary: ${personalityNarrative ?? '(unavailable)'}
• Identified growth areas from personality analysis:
${growthAreasBullets}

Parent-reported profile:
• Strengths: ${strengths}
• Hobbies & interests: ${hobbies}

Instructions — Generate all three of the following, ensuring each is grounded in BOTH the questionnaire answers AND the personality analysis. Do not invent facts not supported by the data above.

1. pathway_overview — A 2–3 sentence personalised overview of ${childName}'s 9-year development journey. It should:
   - Open from ${childName}'s current life phase (${lifePhaseLabel}) with a warm, specific observation about who they are today — grounded in their personality archetype and parent-reported strengths.
   - Describe how their current traits and interests can evolve as they move through the remaining life phases toward long-term potential.
   - Close with an inspiring but realistic statement tied directly to their named hobbies (${hobbies}) and strengths (${strengths}).

2. focus_areas — Exactly four immediate growth focus areas, one per pillar: Mind, Heart, Body, Talent (use these exact pillar labels, no repeats). For each area:
   - Name the pillar and a specific focus topic relevant to ${childName}'s age (${String(
    age ?? 'unknown',
  )}), gender (${gender}), and personality.
   - Be direct and honest: if the questionnaire shows a genuine gap or weakness in this pillar, name it clearly for the parent. Do not reframe every gap as a neutral "opportunity" — the parent needs to know whether this is a strength to build on or a real area that needs attention.
   - Suggest one specific, actionable direction the parent can act on this week — not a vague direction.

3. initial_missions — Exactly three starter weekly missions for ${childName} to begin this week. Each mission must:
   - Be concrete and completable within one week by a ${String(
     age ?? 'unknown',
   )}-year-old.
   - Reference at least one of their named strengths (${strengths}) or hobbies (${hobbies}) where possible.
   - Have a clear, observable outcome so the parent can tell if it was completed.
   - Match the child's energy level and communication style from the questionnaire.`;
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
  parentFeedback,
}: {
  childName: string;
  childAge?: number | string | null;
  childGender?: string | null;
  areaName: string;
  qaContext: string;
  childGameSummary?: string | null;
  childGameStrengths?: string[] | null;
  childGameSuggestedActivities?: string[] | null;
  parentFeedback?: string | null;
}): string {
  const childGameSection =
    childGameSummary ||
    childGameStrengths?.length ||
    childGameSuggestedActivities?.length
      ? `\n\nChild's own game responses for this area:
- Summary: ${childGameSummary ?? '(not available)'}
- Strengths observed: ${
          childGameStrengths?.length
            ? childGameStrengths.join(', ')
            : '(none recorded)'
        }
- Activities the child showed interest in: ${
          childGameSuggestedActivities?.length
            ? childGameSuggestedActivities.join(', ')
            : '(none recorded)'
        }`
      : '';

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

Instructions:
- Before generating recommendations, identify the most significant gap or challenge the child has in the "${areaName}" area based on the data above. Name this gap explicitly in the first recommendation so the parent understands what they are working on and why it matters — do not bury it in positive framing.
- Synthesise both the parent's perspective and the child's own responses to produce well-rounded recommendations.
- Each recommendation must be specific to the child's age (${
    childAge ?? 'unknown'
  }), gender (${
    childGender ?? 'unknown'
  }), and the "${areaName}" growth area — do not produce generic advice.
- Make each recommendation a specific, actionable step the parent can implement at home — describe what to do, how often, and what success looks like.
- Order the 5 recommendations progressively: recommendation 1 should address the core gap directly and be something the parent can start in week 1; recommendations 2–3 should build on that foundation; recommendations 4–5 should represent more advanced or consolidated practice by month 3.
- These 5 recommendations will feed directly into a personalised 3-month goal plan, so the progression must be realistic and achievable.
- Be honest: if the data shows the child genuinely struggles in this area, reflect that in the tone and urgency of early recommendations. Warm language is welcome but must not override clarity about what needs to change.

Return ONLY a JSON object with a "recommendations" array of exactly 5 strings, each 1–2 sentences, specific to the "${areaName}" growth area.`;
}

export function buildGoalsMonthlyPlanPrompt({
  childName,
  childAge,
  childGender,
  parentConcern,
  personalityType,
  areasContext,
}: {
  childName: string | null | undefined;
  childAge: number | string | null | undefined;
  childGender: string | null | undefined;
  parentConcern: string | null | undefined;
  personalityType: string | null | undefined;
  areasContext: string | null | undefined;
}): string {
  const concernContext = parentConcern
    ? `Parent's primary concern: "${parentConcern}"`
    : '';
  return `Create a focused 3-month goal plan for ${
    childName ?? 'the child'
  }, age ${childAge ?? 'unknown'}, gender ${childGender ?? 'unknown'}.

Important: All activity titles, objectives, and language must be calibrated to be age-appropriate for a ${
    childAge ?? 'unknown'
  }-year-old ${
    childGender ?? ''
  } child. Younger children (8–10) need simpler, play-based, concrete tasks. Older children (13+) can handle more abstract, self-reflective, and goal-oriented activities. Do not use generic titles — make every activity feel relevant to this specific child's age and interests.

${concernContext}
Personality: ${personalityType ?? 'Unknown'}
Growth areas explored: ${areasContext ?? 'General holistic development'}

Generate a structured 3-month plan. Each month has a theme/goal and is split into 2 bi-weekly periods (Week 1&2 and Week 3&4). Each period has exactly 2 activities with clear objectives.

STRICT follow-up rule — you MUST follow this for every month without exception:
- Period 1 (Week 1 & 2): introduce Activity A and Activity B.
- Period 2 (Week 3 & 4): Activity 1 MUST be a direct progression of Activity A (same skill, one level deeper). Activity 2 MUST be a direct progression of Activity B (same skill, one level deeper).
- NEVER place a new unrelated activity in Week 3 & 4. Both slots must follow up on Week 1 & 2.

SCORABLE vs NON-SCORABLE activities:
- Each activity MUST include a "scorable" field (true or false).
- Across the full 3-month plan, include a MIX — some activities scorable: true, some scorable: false. Do not make all activities the same type.
- The "scorable" value of a follow-up (Week 3&4) MUST exactly match its Week 1&2 counterpart:
  - If Week 1&2 Activity A is scorable: true → Week 3&4 Activity 1 must be scorable: true.
  - If Week 1&2 Activity B is scorable: false → Week 3&4 Activity 2 must be scorable: false.
- Use scorable: true for structured skill-building activities where measurable progress is clear (e.g. speaking, reading, problem-solving).
- Use scorable: false for open-ended, creative, emotional, or reflective activities where a numeric score is not meaningful (e.g. journaling feelings, imaginative play, self-expression).

Example of correct follow-up pairing (with scorable):
  Week 1&2 Activity 1: { "title": "Picture Description Warm-Up", "objective": "child describes a single image using 1–2 sentences", "scorable": true }
  Week 3&4 Activity 1: { "title": "Picture Story Extension", "objective": "child describes the same image using 3–4 sentences and answers follow-up questions", "scorable": true }

  Week 1&2 Activity 2: { "title": "Feelings Journaling", "objective": "child identifies and names 2 emotions they felt this week", "scorable": false }
  Week 3&4 Activity 2: { "title": "Feelings Discussion", "objective": "child describes their emotions and shares why they felt that way", "scorable": false }

${
  parentConcern
    ? `Make sure the concern "${parentConcern}" is prominently addressed throughout.`
    : ''
}

Return JSON with this exact structure:
{
  "months": [
    {
      "month": 1,
      "goal": "Monthly goal title",
      "objective": "One sentence objective",
      "periods": [
        {
          "label": "Week 1 & 2",
          "activities": [
            { "title": "Activity title", "objective": "What child will achieve", "scorable": true },
            { "title": "Activity title", "objective": "What child will achieve", "scorable": false }
          ]
        },
        {
          "label": "Week 3 & 4",
          "activities": [
            { "title": "Activity title", "objective": "What child will achieve", "scorable": true },
            { "title": "Activity title", "objective": "What child will achieve", "scorable": false }
          ]
        }
      ]
    }
  ]
}`;
}

export function buildActivityQuestionsPrompt({
  title,
  objective,
  childName,
  childAge,
  childGender,
  goal,
  impact,
}: {
  title: string;
  objective: string;
  childName: string | null | undefined;
  childAge?: number | string | null;
  childGender?: string | null;
  goal?: string | null;
  impact?: string | null;
}): string {
  const personaLine = [
    childAge ? `Age: ${String(childAge)}` : null,
    childGender ? `Gender: ${childGender}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const goalLine = goal ? `Overall goal: "${goal}"` : '';
  const impactLine = impact ? `Expected impact: "${impact}"` : '';

  return `Generate 4 engaging assessment questions for a child activity called "${title}".
Activity objective: "${objective}"
Child name: ${childName ?? 'the child'}${
    personaLine ? `\nChild profile: ${personaLine}` : ''
  }${goalLine ? `\n${goalLine}` : ''}${impactLine ? `\n${impactLine}` : ''}

The questions will be answered by the child (typically with a parent present, verbally or in writing). They must be realistic, age-appropriate, and directly aligned with the activity objective and overall goal. A parent reading these questions should feel confident that the assessment is meaningful and genuinely tests the child's understanding and progress.

Generate exactly 4 questions in this order:
1. type "choice" — a meaningful multiple-choice question with exactly 4 options that tests the child's understanding of the activity topic. Set "options" to the 4 choices. Set "labels" to [].
2. type "text" — an open-ended question that asks the child to explain or demonstrate their understanding related to the activity objective. Set "options" to []. Set "labels" to [].
3. type "scale" — a 1-to-5 self-assessment question about how well the child felt they performed or understood the activity. Set "options" to []. Set "labels" to a 2-item array [minLabel, maxLabel] (e.g. ["Very difficult", "Very easy"]).
4. type "text" — a reflective question asking what the child learnt or what they would do differently. Set "options" to []. Set "labels" to [].

Rules:
- Each question object MUST include an "id" field numbered 1, 2, 3, 4 in order.
- Tailor language complexity to the child's age (${
    childAge ? String(childAge) : 'unknown age'
  }) — simpler for younger children, more nuanced for older ones.
- Questions must directly relate to the activity content and objective, not be generic.
- Only populate "options" for type "choice". Only populate "labels" for type "scale". Leave both as [] otherwise.
- Do not repeat the child's name in every question — use it at most once.`;
}

export function buildActivityScorePrompt({
  title,
  objective,
  answersText,
  childName,
  childAge,
  childGender,
  isFollowUp = false,
  originalScore,
  originalWhatChanged,
}: {
  title: string;
  objective: string;
  answersText: string;
  childName?: string | null;
  childAge?: number | string | null;
  childGender?: string | null;
  isFollowUp?: boolean;
  originalScore?: number | null;
  originalWhatChanged?: string | null;
}): string {
  const profileLine = [
    childName ? `Name: ${childName}` : null,
    childAge ? `Age: ${String(childAge)}` : null,
    childGender ? `Gender: ${childGender}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const originalContext =
    isFollowUp && (originalScore != null || originalWhatChanged)
      ? `\n\nOriginal attempt (Week 1 & 2) for comparison:
- Score: ${originalScore != null ? `${originalScore}/10` : '(not available)'}
- What was observed then: ${originalWhatChanged ?? '(not available)'}
Use this as your baseline when determining whether the child has improved, stayed the same, or declined.`
      : '';

  const whatChangedDesc = isFollowUp
    ? "1–2 sentences describing honestly how the child's performance has changed since their first attempt — whether they showed clear improvement, similar effort, or less engagement. Reference their actual answers and the baseline above."
    : '1–2 sentences describing honestly what the child demonstrated in this session — their level of understanding, engagement, and quality of responses. Reference their actual answers.';

  return `You are evaluating a child's responses for the activity "${title}".
Activity objective: "${objective}"${
    profileLine ? `\nChild profile: ${profileLine}` : ''
  }${
    isFollowUp
      ? '\nContext: This is a follow-up (Week 3 & 4) activity — a direct progression of a previous attempt.'
      : ''
  }${originalContext}

Your evaluation will be shown directly to the parent to help them decide how to support their child's development. Honesty is more important than encouragement — a parent who receives only positive language cannot take informed action. Be truthful first, constructive second.

Child's answers:
${answersText}

Evaluation guidelines:
- Evaluate honestly and accurately. If the child's answers are weak, off-topic, or show poor understanding, reflect that truthfully — do not inflate the assessment.
- For scale questions, treat the numeric rating at face value.
- For choice questions, assess whether the selected option shows genuine understanding or was likely guessed.
- For text questions, assess both the relevance and quality of understanding shown — reward genuine insight, penalise vague or off-topic answers.
- Score from 1–10 based on: (a) quality of understanding, (b) relevance and accuracy of answers to the objective, (c) effort and engagement.
  - 9–10: Exceptional — detailed, accurate, thoughtful answers that clearly demonstrate mastery.
  - 7–8: Good — mostly relevant answers with reasonable understanding shown.
  - 5–6: Moderate — partial understanding, some relevant answers mixed with vague ones.
  - 3–4: Weak — mostly off-topic, minimal effort, or significant misunderstanding shown.
  - 1–2: Very poor — answers are entirely irrelevant or show no engagement with the objective.

Return a JSON object with exactly these four fields:
- "score": integer from 1–10 (honest assessment — do not default to a safe middle value).
- "what_changed": ${whatChangedDesc}
- "what_learned": 1 sentence that names BOTH (a) the specific skill or concept the child demonstrated they understand AND (b) the specific gap or misconception that still needs work — based on what the answers actually showed. Do not pick only the positive side; always name the gap explicitly if one exists.
- "recommendation": 1 sentence of a specific, actionable step the PARENT should take to support the child's development — e.g. practise a specific skill together, try a different approach, celebrate mastery and move on, or seek additional support. Address the parent directly ("You can help by…" or "Encourage [name] to…").`;
}

export function buildActivityNotePrompt({
  title,
  objective,
  answersText,
  childName,
  childAge,
  childGender,
  isFollowUp = false,
  originalNote,
  originalWhatChanged,
}: {
  title: string;
  objective: string;
  answersText: string;
  childName?: string | null;
  childAge?: number | string | null;
  childGender?: string | null;
  isFollowUp?: boolean;
  originalNote?: string | null;
  originalWhatChanged?: string | null;
}): string {
  const profileLine = [
    childName ? `Name: ${childName}` : null,
    childAge ? `Age: ${String(childAge)}` : null,
    childGender ? `Gender: ${childGender}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const originalContext =
    isFollowUp && (originalNote || originalWhatChanged)
      ? `\n\nOriginal attempt (Week 1 & 2) for comparison:
- Note then: ${originalNote ?? '(not available)'}
- What was observed then: ${originalWhatChanged ?? '(not available)'}
Use this as your baseline when assessing whether the child has improved, stayed the same, or declined.`
      : '';

  const whatChangedDesc = isFollowUp
    ? "1–2 sentences describing honestly how the child's engagement and expression have changed since their first attempt — whether they showed clearer effort, similar quality, or less focus. Reference their actual answers and the baseline above."
    : '1–2 sentences describing honestly what the child demonstrated in this session — their engagement, effort, and quality of expression. Reference their actual answers.';

  return `You are reviewing a child's responses for the activity "${title}".
Activity objective: "${objective}"${
    profileLine ? `\nChild profile: ${profileLine}` : ''
  }${
    isFollowUp
      ? '\nContext: This is a follow-up (Week 3 & 4) activity — a direct progression of a previous attempt.'
      : ''
  }${originalContext}

Your evaluation will be shown directly to the parent to help them decide how to support their child's development. Honesty is more important than encouragement — a parent who receives only positive language cannot take informed action. Be truthful first, constructive second.

Child's answers:
${answersText}

Evaluate the child's responses honestly on:
- Relevance: are the answers related to the activity objective?
- Engagement: did the child put in genuine effort or give minimal/off-topic answers?
- Quality of expression: did the child communicate their thoughts clearly and meaningfully?

If the responses are weak, off-topic, or show little engagement, name that directly. Do not default to generic praise when it is not warranted.

Return a JSON object with exactly these four fields:
- "note": a short phrase of MAXIMUM 5 WORDS that honestly reflects the quality of engagement. Use strong praise (e.g. "Outstanding effort today!") only for genuinely high-quality responses. Use honest phrases (e.g. "More focus needed here.", "Needs more practice.") for weak or off-topic responses. Never write a generic positive phrase for poor work.
- "what_changed": ${whatChangedDesc}
- "what_learned": 1 sentence that names BOTH (a) what the child demonstrated they can do or understand, AND (b) the specific skill or concept that still needs more practice — based on what the answers actually showed. Always name the gap explicitly if one exists, even if there are also positives.
- "recommendation": 1 sentence of a specific, actionable step the PARENT should take to support the child's development — e.g. practise a specific skill together, try a different approach, celebrate mastery and move on, or seek additional support. Address the parent directly ("You can help by…" or "Encourage [name] to…").`;
}

export function buildProgressComparisonPrompt({
  originalTitle,
  originalNote,
  originalAiFeedback,
  originalParentFeedback,
  originalAnswersText,
  followupTitle,
  followupNote,
  followupAiFeedback,
  followupParentFeedback,
  followupAnswersText,
  childName,
  childAge,
  childGender,
}: {
  originalTitle: string;
  originalNote: string | null | undefined;
  originalAiFeedback: string | null | undefined;
  originalParentFeedback: string | null | undefined;
  originalAnswersText: string | null | undefined;
  followupTitle: string;
  followupNote: string | null | undefined;
  followupAiFeedback: string | null | undefined;
  followupParentFeedback: string | null | undefined;
  followupAnswersText: string | null | undefined;
  childName?: string | null;
  childAge?: number | string | null;
  childGender?: string | null;
}): string {
  const profileLine = [
    childName ? `Name: ${childName}` : null,
    childAge ? `Age: ${String(childAge)}` : null,
    childGender ? `Gender: ${childGender}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return `Compare two assessments for the same child activity objective and determine honestly whether the child improved, declined, or stayed the same.${
    profileLine ? `\nChild profile: ${profileLine}` : ''
  }
Calibrate your expectation of "improvement" to the child's developmental stage — what counts as meaningful progress for an 8-year-old differs from a 14-year-old.

The follow-up activity (Week 3&4) is a direct progression of the original (Week 1&2). Evaluate carefully — do not default to "Improved" unless the evidence clearly supports it.

Original assessment (Week 1&2):
- Activity: "${originalTitle}"
- Child's answers: ${
    originalAnswersText ? `\n${originalAnswersText}` : '(not available)'
  }
- AI Feedback: "${originalAiFeedback ?? 'none'}"
- Note: "${originalNote ?? 'none'}"
- Parent Feedback: "${originalParentFeedback ?? 'none'}"

Follow-up assessment (Week 3&4):
- Activity: "${followupTitle}"
- Child's answers: ${
    followupAnswersText ? `\n${followupAnswersText}` : '(not available)'
  }
- AI Feedback: "${followupAiFeedback ?? 'none'}"
- Note: "${followupNote ?? 'none'}"
- Parent Feedback: "${followupParentFeedback ?? 'none'}"

Based on the actual answers, quality of understanding, engagement, and expression shown across both assessments, return a JSON object with a single field "progress_observation" set to exactly one of:
- "Improved" — the follow-up shows clearly better understanding, effort, or quality of expression than the original
- "Needs More Attention" — the follow-up shows weaker understanding or effort compared to the original, indicating decline
- "No Improvement" — both assessments show similar levels of understanding and effort with no meaningful change

Example: { "progress_observation": "Improved" }`;
}
