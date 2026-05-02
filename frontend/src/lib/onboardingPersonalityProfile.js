/**
 * Shapes onboarding_profile consumed by Goals, LifePathway, Recommendations intro.
 * @param {{ type: string, profile?: Record<string, unknown> }} vm
 */
export function onboardingProfileFromViewModel(vm) {
	if (!vm?.profile || !vm.type) return null;
	const p = vm.profile;
	const ga =
		Array.isArray(p.growth_areas) && p.growth_areas.length ? p.growth_areas :
		Array.isArray(p.growthAreas) && p.growthAreas.length ? p.growthAreas : [];
	return {
		summary: p.description || '',
		top_strengths: Array.isArray(p.strengths)
			? p.strengths.map((s) => ({ strength: s, description: '' }))
			: [],
		personality_type: `${vm.type} - ${p.name || vm.type}`,
		growth_areas: ga,
	};
}
