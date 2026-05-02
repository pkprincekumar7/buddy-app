/** Keys stored in PATCH /api/v1/user/app-state payload (excluding access_token). */

export const USER_APP_HOME_RESET_KEYS = [
	'onboarding_phase',
	'onboarding_childData',
	'onboarding_mbti',
	'onboarding_personality_analysis',
	'onboarding_profile',
	'onboarding_recommendations',
	'recommendations_progress',
];

export const USER_APP_FULL_ONBOARDING_KEYS = [
	'onboarding_phase',
	'onboarding_childData',
	'onboarding_mbti',
	'onboarding_personality_analysis',
	'onboarding_profile',
	'onboarding_recommendations',
	'recommendations_progress',
	'completed_growth_areas',
	'parent_concern',
	'goals_plan',
];

/** Cleared when user taps Start Over on onboarding — same scope as Goals/LifePathway (tts_enabled preserved). */
export const USER_APP_ONBOARDING_START_OVER_KEYS = USER_APP_FULL_ONBOARDING_KEYS;

export function patchBodyClearKeys(keys) {
	return Object.fromEntries(keys.map((k) => [k, null]));
}
