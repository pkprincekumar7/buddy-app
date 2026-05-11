/** Fields persisted from the chatbot; avoid defaults like pillar_scores at this stage. */
export const CHATBOT_CAPTURED_FIELDS = [
	'name',
	'age',
	'school',
	'strengths',
	'hobbies',
	'thinking_pattern',
	'communication_style',
	'energy_level',
	'social_behaviour',
	'emotional_behaviour',
];

/** @param {string} field
 *  @param {Record<string, unknown>} data */
export function questionnaireFieldHasValue(field, data) {
	const v = data?.[field];
	if (v === undefined || v === null) return false;
	if (typeof v === 'string' && !String(v).trim()) return false;
	if (Array.isArray(v) && v.length === 0) return false;
	return true;
}

/** @param {Record<string, unknown>} full */
export function slimChildConversationForStorage(full) {
	const out = {};
	for (const k of CHATBOT_CAPTURED_FIELDS) {
		if (!questionnaireFieldHasValue(k, full)) continue;
		out[k] = full[k];
	}
	return out;
}

/** Questionnaire slice suitable for loading back into the chatbot (non-empty fields only). */
export function pickSavedQuestionnaireForChatbot(raw) {
	const out = {};
	for (const k of CHATBOT_CAPTURED_FIELDS) {
		if (questionnaireFieldHasValue(k, raw)) out[k] = raw[k];
	}
	return out;
}

/**
 * Map a persisted Child entity into questionnaire-shaped fields for chat replay.
 */
export function conversationDraftFromChildRecord(child) {
	if (!child || typeof child !== 'object') return null;
	/** @type {Record<string, unknown>} */
	const out = {};
	if (questionnaireFieldHasValue('name', child)) out.name = child.name;
	if (questionnaireFieldHasValue('school', child)) out.school = child.school;
	if (questionnaireFieldHasValue('age', child)) out.age = String(child.age);
	else if (child.date_of_birth) {
		const d = new Date(String(child.date_of_birth));
		if (!Number.isNaN(d.getTime())) {
			const ageYears = Math.max(
				1,
				Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000)),
			);
			out.age = String(ageYears);
		}
	}
	if (Array.isArray(child.personality_traits) && child.personality_traits.length) {
		out.strengths = child.personality_traits;
	}
	if (Array.isArray(child.interests) && child.interests.length) {
		out.hobbies = child.interests;
	}
	for (const k of [
		'thinking_pattern',
		'communication_style',
		'energy_level',
		'social_behaviour',
		'emotional_behaviour',
	]) {
		if (questionnaireFieldHasValue(k, child)) out[k] = child[k];
	}
	return Object.keys(out).length ? out : null;
}

/**
 * Raw `onboarding_childData` from GET app-state (object or legacy JSON string).
 * Maps older field names so the chatbot can replay persisted answers.
 */
export function normalizeOnboardingChildDataBlob(raw) {
	let o = raw;
	if (typeof o === 'string') {
		try {
			o = JSON.parse(o);
		} catch {
			return null;
		}
	}
	if (!o || typeof o !== 'object') return null;
	return { ...o };
}
