/** Keys stored in PATCH /api/v1/user/app-state payload (excluding access_token). */

export const USER_APP_HOME_RESET_KEYS = [
	'onboarding_phase',
	'onboarding_childData',
	'onboarding_mbti',
	'recommendations_progress',
];

/** After LifePathway welcome → Goals; keep completed areas, concern, goals plan */
export const USER_APP_PROCEED_TO_GOALS_KEYS = [
	'onboarding_phase',
	'onboarding_childData',
	'onboarding_mbti',
	'onboarding_profile',
	'onboarding_recommendations',
	'recommendations_progress',
];

export const USER_APP_FULL_ONBOARDING_KEYS = [
	'onboarding_phase',
	'onboarding_childData',
	'onboarding_mbti',
	'onboarding_profile',
	'onboarding_recommendations',
	'recommendations_progress',
	'completed_growth_areas',
	'parent_concern',
	'goals_plan',
];

export function patchBodyClearKeys(keys) {
	return Object.fromEntries(keys.map((k) => [k, null]));
}
