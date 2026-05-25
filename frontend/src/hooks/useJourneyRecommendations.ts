import { useEffect } from 'react';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { recommendationsJourneySchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft, determinePhase } from '@/lib/onboardingHelpers';
import { buildJourneyRecommendationsPrompt } from '@/lib/prompts';

import type { DispatchFn } from '@/types';

interface UseJourneyRecommendationsProps {
  hydrated: boolean;
  currentPhase: number;
  activeChildId: string | undefined;
  dispatch: DispatchFn;
}

// Fires when the wizard reaches the journey/recommendations phase (phase 3).
// Reads from and writes to the child record directly — no separate onboarding collection.
export function useJourneyRecommendations({
  hydrated,
  currentPhase,
  activeChildId,
  dispatch,
}: UseJourneyRecommendationsProps) {
  useEffect(() => {
    if (!hydrated || currentPhase !== 3 || !activeChildId) return;
    let cancelled = false;

    const run = async () => {
      try {
        const child = await api.entities.Child.get(activeChildId);
        const childRecord = child as Record<string, unknown>;
        if (cancelled) return;

        const recommendations = childRecord?.recommendations as Record<string, unknown> | undefined;
        if (
          recommendations &&
          (typeof recommendations.pathway_overview === 'string' ||
            (Array.isArray(recommendations.focus_areas) && recommendations.focus_areas.length > 0))
        ) {
          dispatch({ type: 'SET_RECOMMENDATIONS', payload: recommendations });
          return;
        }

        const mergedChild = mergeChildDraft(normalizeOnboardingChildDataBlob(childRecord) ?? {});
        if (!mergedChild.name?.trim?.()) return;

        const personality = childRecord?.personality as Record<string, unknown> | undefined;
        const vmJ = personality?.view_model as
          | { type?: string; profile?: Record<string, unknown> }
          | undefined;
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
                gp?.personality_type ??
                `${vmJ?.type ?? 'Unknown'} (${(vmJ?.profile?.name as string | undefined) ?? ''})`,
              personalityNarrative: gp?.summary,
              growthAreas: gp?.growth_areas as string[] | undefined,
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

    void run();
    return () => {
      cancelled = true;
      dispatch({ type: 'SET_JOURNEY_BUSY', payload: false });
    };
  }, [hydrated, currentPhase, activeChildId, dispatch]);
}
