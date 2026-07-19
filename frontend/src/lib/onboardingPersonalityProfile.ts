/**
 * Shapes onboarding_profile consumed by Goals, LifePathway, Recommendations intro.
 */
export function onboardingProfileFromViewModel(
  vm: { type?: string; profile?: Record<string, unknown> } | null | undefined,
): {
  summary: string;
  top_strengths: unknown[];
  personality_type: string;
  growth_areas: unknown[];
} | null {
  if (!vm?.profile?.name) return null;
  const p = vm.profile;
  const ga = Array.isArray(p.growth_areas) && p.growth_areas.length ? p.growth_areas : [];
  return {
    summary: typeof p.description === 'string' ? p.description : '',
    top_strengths: Array.isArray(p.strengths) ? (p.strengths as unknown[]) : [],
    personality_type: typeof p.name === 'string' ? p.name : '',
    growth_areas: ga,
  };
}
