/**
 * LLM prompt builder functions.
 * Centralised here so component files stay readable and prompts can be versioned independently.
 */

import { slimChildConversationForStorage } from '@/lib/onboardingChildData';

// Formats stored questionnaire fields into a readable markdown block for LLM prompts.
export function questionnaireMarkdown(mergedDraft) {
  const slim = slimChildConversationForStorage(mergedDraft);
  const labelFor = {
    name: 'Name', age: 'Age', school: 'School', strengths: 'Top strengths',
    hobbies: 'Hobbies', thinking_pattern: 'Thinking pattern',
    communication_style: 'Communication style', energy_level: 'Energy level',
    social_behaviour: 'Social behaviour', emotional_behaviour: 'Emotional behaviour',
  };
  const pairs = [];
  for (const [k, v] of Object.entries(slim)) {
    const lbl = labelFor[k] || k;
    pairs.push(Array.isArray(v) ? `${lbl}: ${v.join(', ')}` : `${lbl}: ${String(v)}`);
  }
  return pairs.length ? pairs.join('\n') : '(no questionnaire stored yet)';
}

export function buildPersonalityAnalysisPrompt({ childData, personalityTypeKeys }) {
  const questionnaireMd = questionnaireMarkdown(childData);
  const childName = String(childData.name || '').replace(/"/g, '');
  return `You analyze a single child using a Buddy360 onboarding questionnaire answered by their parent/caregiver.

Return JSON ONLY that conforms to the response schema.

Collected questionnaire responses:
"""
${questionnaireMd}
"""

Requirements:
• dominant_style must be EXACTLY one of: ${personalityTypeKeys.join(', ')}.
• personality_category must be one of: motivators, socializers, creatives, adventurers.
• secondary_styles: up to TWO additional entries from dominant_style enum (different archetypes each with prominence 40–92).
• personalized_traits: 4–6 succinct trait chips anchored in BOTH the questionnaire wording and calibrated interpretation.
• personalized_description: EXACTLY ONE short sentence (max ~160 characters), caregiver-facing; name "${childName}" naturally once; tie survey cues to temperament without invented facts; no second sentence, bullets, or line breaks.
• personalized_growth_areas: 4–7 crisp growth bullets aligned with the dominant temperament and parent's observations.
• role_models: EXACTLY two admirable real public figures relevant to temperament (full names).
• strength_summary_bullets: exactly 6 strength-focused bullets synthesized from parent's answers plus measured inference.
Stay evidence-led; acknowledge uncertainty subtly when extrapolating.`;
}

export function buildJourneyRecommendationsPrompt({ childData, age, lifePhase, personalityType, personalityNarrative, growthAreas }) {
  const questionnaireMd = questionnaireMarkdown(childData);
  const growthAreasBullets = Array.isArray(growthAreas) && growthAreas.length
    ? growthAreas.map((x) => `• ${x}`).join('\n')
    : '(not captured)';
  return `Based on this child's onboarding questionnaire responses and synthesized personality briefing, propose personalized Buddy360 journey scaffolding.

Structured answers we already persisted:
"""
${questionnaireMd}
"""

AI personality synopsis:
• Archetype: ${personalityType || 'Unknown'}
• Narrative: ${personalityNarrative || '(unavailable)'}

Growth areas already highlighted for downstream experiences:
${growthAreasBullets}

Logistics recap:
• Name / Age / Phase: ${childData.name || 'unknown'}, Age ${age}, life-phase bucket ${lifePhase}
• School context: ${childData.school || 'not captured'}
• Reported strengths parent listed: ${childData.strengths?.join(', ') || 'unknown'}
• Interests referenced: ${childData.hobbies?.join(', ') || 'unknown'}

Generate:
1. A personalized 9-year pathway overview (2–3 vivid sentences grounding in BOTH answers AND personality synopsis)
2. Four immediate growth focus areas spanning Mind, Heart, Body, Talent (explicit pillar labels — no repeats)
3. Three attainable starter weekly missions referencing strengths or hobbies cues when plausible`;
}

export function buildGoalsMonthlyPlanPrompt({ childName, childAge, parentConcern, personalityType, areasContext }) {
  const concernContext = parentConcern ? `Parent's primary concern: "${parentConcern}"` : '';
  return `Create a focused 3-month goal plan for ${childName || 'the child'}, age ${childAge || 'unknown'}.

${concernContext}
Personality: ${personalityType || 'Unknown'}
Growth areas explored: ${areasContext || 'General holistic development'}

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

${parentConcern ? `Make sure the concern "${parentConcern}" is prominently addressed throughout.` : ''}

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

export function buildActivityQuestionsPrompt({ title, objective, childName }) {
  return `Generate 4 engaging questions for a child activity called "${title}".
Activity objective: "${objective}"
Child name: ${childName || 'the child'}

Generate exactly 4 questions in this order:
1. type "choice" — a fun multiple-choice question with exactly 4 text options. Set "options" to the 4 choices. Set "labels" to [].
2. type "text" — an open-ended question about what excites them about this activity. Set "options" to []. Set "labels" to [].
3. type "scale" — a 1-to-5 rating question. Set "options" to []. Set "labels" to a 2-item array [minLabel, maxLabel] (e.g. ["Hard", "Easy"]).
4. type "text" — a short reflection question after completing the activity. Set "options" to []. Set "labels" to [].

Rules:
- Keep questions simple and child-friendly.
- Only populate "options" for type "choice". Only populate "labels" for type "scale". Leave both as [] otherwise.
- Do not repeat the child's name in every question — use it at most once.`;
}

export function buildActivityScorePrompt({ title, objective, answersText }) {
  return `You are evaluating a young child's responses for the activity "${title}".
Activity objective: "${objective}"

Child's answers:
${answersText}

Scoring guidelines:
- This is a young child. Short but relevant answers (even 1–2 words) are perfectly valid — do not penalise brevity.
- For scale questions, treat the numeric rating at face value (e.g. "4" out of 5 is a strong response).
- For choice questions, any selection shows engagement.
- For text questions, assess both relevance/effort AND the quality and correctness of what the child said — reward answers that demonstrate genuine understanding of the activity objective over vague or off-topic ones.
- Overall score should reflect: (a) engagement and effort, (b) quality of understanding shown, and (c) correctness and relevance of answers to the activity objective.
- Give a score from 6–10 (never below 6 for a child who attempted all questions). Reserve 9–10 for exceptionally detailed, correct, and thoughtful answers; give 6–7 for minimal or off-topic responses.
- Write 1–2 sentences of child-friendly encouraging feedback that references what they actually said. Start with "Great job".`;
}

export function buildActivityNotePrompt({ title, objective, answersText }) {
  return `You are reviewing a young child's responses for the activity "${title}".
Activity objective: "${objective}"

Child's answers:
${answersText}

Evaluate the child's responses on:
- Relevance: are the answers related to the activity objective?
- Engagement: did the child put in genuine effort or give minimal/off-topic answers?
- Quality of expression: did the child communicate their thoughts clearly, even briefly?

Based on this evaluation, write two things:
1. "note" — a short appreciation message of MAXIMUM 5 WORDS that reflects how well the child engaged. Use a stronger phrase (e.g. "Outstanding work!", "Brilliant effort today!") for high-quality, relevant responses and a gentler encouraging phrase (e.g. "Keep exploring!", "You're doing great!") for minimal or off-topic ones.
2. "feedback" — 1–2 sentences of child-friendly encouraging feedback that references what they actually said and gently nudges improvement if needed. Start with "Great job".`;
}

export function buildProgressComparisonPrompt({
  originalTitle, originalNote, originalAiFeedback, originalParentFeedback,
  followupTitle, followupNote, followupAiFeedback, followupParentFeedback,
}) {
  return `Compare two assessments for the same child activity objective and determine if the child improved.

Original assessment (Week 1&2):
- Activity: "${originalTitle}"
- Note: "${originalNote || 'none'}"
- AI Feedback: "${originalAiFeedback || 'none'}"
- Parent Feedback: "${originalParentFeedback || 'none'}"

Follow-up assessment (Week 3&4):
- Activity: "${followupTitle}"
- Note: "${followupNote || 'none'}"
- AI Feedback: "${followupAiFeedback || 'none'}"
- Parent Feedback: "${followupParentFeedback || 'none'}"

Based on the quality of engagement, effort, and expression shown across both assessments, return exactly one of:
- "Improved" — the follow-up shows clearly better engagement, effort, or expression than the original
- "Needs More Attention" — the follow-up shows weaker engagement or effort compared to the original
- "No Improvement" — both assessments show similar levels of engagement and effort`;
}
