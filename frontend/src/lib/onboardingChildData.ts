/** Fields persisted from the chatbot; avoid defaults like pillar_scores at this stage. */
export const CHATBOT_CAPTURED_FIELDS = [
  'name',
  'age',
  'gender',
  'school',
  'strengths',
  'hobbies',
  'thinking_pattern',
  'communication_style',
  'energy_level',
  'social_behaviour',
  'emotional_behaviour',
];

export function questionnaireFieldHasValue(
  field: string,
  data: Record<string, unknown> | null | undefined,
): boolean {
  const v = data?.[field];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && !String(v).trim()) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

/** Questionnaire slice suitable for loading back into the chatbot (non-empty fields only). */
export function pickSavedQuestionnaireForChatbot(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CHATBOT_CAPTURED_FIELDS) {
    if (questionnaireFieldHasValue(k, raw)) out[k] = raw[k];
  }
  return out;
}
