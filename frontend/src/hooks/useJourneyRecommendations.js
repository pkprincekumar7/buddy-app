import { useEffect } from 'react';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { recommendationsJourneySchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft, determinePhase } from '@/lib/onboardingHelpers';
import { buildJourneyRecommendationsPrompt } from '@/lib/prompts';

// Fires when the wizard reaches the journey/recommendations phase (phase 3).
// Reads from and writes to the child record directly — no separate onboarding collection.
export function useJourneyRecommendations({ hydrated, currentPhase, activeChildId, dispatch }) {
  useEffect(() => {
    if (!hydrated || currentPhase !== 3 || !activeChildId) return;
    let cancelled = false;

    const run = async () => {
      try {
        const child = await api.entities.Child.get(activeChildId);
        if (cancelled) return;

        if (
          child.recommendations &&
          (typeof child.recommendations.pathway_overview === 'string' ||
            (Array.isArray(child.recommendations.focus_areas) &&
              child.recommendations.focus_areas.length > 0))
        ) {
          dispatch({ type: 'SET_RECOMMENDATIONS', payload: child.recommendations });
          return;
        }

        const mergedChild = mergeChildDraft(normalizeOnboardingChildDataBlob(child) || {});
        if (!mergedChild.name?.trim?.()) return;

        const vmJ = child.personality?.view_model;
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
              personalityType:
                gp?.personality_type || `${vmJ?.type || 'Unknown'} (${vmJ?.profile?.name || ''})`,
              personalityNarrative: gp?.summary,
              growthAreas: gp?.growth_areas,
            }),
            response_json_schema: recommendationsJourneySchema(),
          });
          if (cancelled) return;

          dispatch({ type: 'SET_RECOMMENDATIONS', payload: result });
          if (result)
            await api.entities.Child.update(activeChildId, {
              recommendations: result,
              onboarding_phase: 3,
            });
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
  }, [hydrated, currentPhase, activeChildId, dispatch]);
}
