import { useEffect } from 'react';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { recommendationsJourneySchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft, determinePhase } from '@/lib/onboardingHelpers';
import { buildJourneyRecommendationsPrompt } from '@/lib/prompts';

// Fires when the wizard reaches the journey/recommendations phase (phase 3).
// Reuses cached recommendations if present, otherwise invokes the LLM.
// Dispatches results to the Onboarding reducer.
export function useJourneyRecommendations({ hydrated, currentPhase, dispatch }) {
  useEffect(() => {
    if (!hydrated || currentPhase !== 3) return;
    let cancelled = false;

    const run = async () => {
      try {
        const s = await api.onboarding.get();
        if (cancelled) return;

        if (
          s.recommendations &&
          (typeof s.recommendations.pathway_overview === 'string' ||
            (Array.isArray(s.recommendations.focus_areas) && s.recommendations.focus_areas.length > 0))
        ) {
          dispatch({ type: 'SET_RECOMMENDATIONS', payload: s.recommendations });
          return;
        }

        const normalizedChild = normalizeOnboardingChildDataBlob(s.child_data);
        const mergedChild = mergeChildDraft(normalizedChild || {});
        if (!mergedChild.name?.trim?.()) return;

        const vmJ = s.personality?.view_model;
        const gp = vmJ?.type && vmJ?.profile ? onboardingProfileFromViewModel(vmJ) : null;

        dispatch({ type: 'SET_JOURNEY_BUSY', payload: true });
        if (cancelled) {
          dispatch({ type: 'SET_JOURNEY_BUSY', payload: false });
          return;
        }

        const age = parseInt(String(mergedChild.age), 10) || 10;
        const lifePhase = determinePhase(age);

        try {
          if (cancelled) return;
          const result = await api.integrations.Core.InvokeLLM({
            prompt: buildJourneyRecommendationsPrompt({
              childData: mergedChild,
              age,
              lifePhase,
              personalityType: gp?.personality_type || `${vmJ?.type || 'Unknown'} (${vmJ?.profile?.name || ''})`,
              personalityNarrative: gp?.summary,
              growthAreas: gp?.growth_areas,
            }),
            response_json_schema: recommendationsJourneySchema(),
          });
          if (cancelled) return;

          dispatch({ type: 'SET_RECOMMENDATIONS', payload: result });
          if (result) await api.onboarding.patch({ recommendations: result });
        } catch (err) {
          console.error('[useJourneyRecommendations] Failed to generate recommendations:', err);
        } finally {
          if (!cancelled) dispatch({ type: 'SET_JOURNEY_BUSY', payload: false });
        }
      } catch (err) {
        console.warn('[useJourneyRecommendations] Server fetch failed:', err);
      }
    };

    run();
    return () => {
      cancelled = true;
      dispatch({ type: 'SET_JOURNEY_BUSY', payload: false });
    };
  }, [hydrated, currentPhase, dispatch]);
}
