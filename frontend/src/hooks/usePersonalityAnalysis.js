import { useEffect } from 'react';
import { api } from '@/api/client';
import {
  calculateMBTI,
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '@/components/shared/PersonalityAnalysis';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';

// Fires when the wizard reaches the personality phase (phase 2).
// Fetches fresh server state, reuses an existing result if present, or calls the LLM
// with a rule-based fallback. Dispatches results to the Onboarding reducer.
export function usePersonalityAnalysis({ hydrated, currentPhase, dispatch }) {
  useEffect(() => {
    if (!hydrated || currentPhase !== 2) return;
    let cancelled = false;

    const run = async () => {
      try {
        const s = await api.onboarding.get();
        if (cancelled) return;

        const normalized = normalizeOnboardingChildDataBlob(s.child_data);
        const mergedFromServer = mergeChildDraft(normalized || {});

        if (s.personality?.view_model?.type && s.personality?.view_model?.profile) {
          const clampedReuse = maybeClampStoredPersonalityDescription(s.personality.view_model, {
            analysisSource: s.personality.source,
          });
          dispatch({ type: 'SET_MBTI_RESULT', payload: clampedReuse });
          dispatch({ type: 'SET_GENERATED_PROFILE', payload: onboardingProfileFromViewModel(clampedReuse) });
          return;
        }

        if (!mergedFromServer.name?.trim?.()) {
          dispatch({ type: 'SET_MBTI_RESULT', payload: null });
          dispatch({ type: 'SET_GENERATED_PROFILE', payload: null });
          return;
        }

        if (cancelled) return;
        dispatch({ type: 'SET_PERSONALITY_BUSY', payload: true });

        try {
          const prompt = buildPersonalityAnalysisPrompt({
            childData: mergedFromServer,
            personalityTypeKeys: PERSONALITY_TYPE_KEYS,
          });
          if (cancelled) return;

          const ai = await api.integrations.Core.InvokeLLM({
            prompt,
            response_json_schema: personalityLlmSchema(),
          });
          if (cancelled) return;

          const vm = adaptAiPersonalityToViewModel(ai || {}, mergedFromServer.name);
          const prof = onboardingProfileFromViewModel(vm);
          await api.onboarding.patch({ personality: { source: 'llm', view_model: vm } });
          if (cancelled) return;

          dispatch({ type: 'SET_MBTI_RESULT', payload: vm });
          if (prof) dispatch({ type: 'SET_GENERATED_PROFILE', payload: prof });
        } catch (err) {
          console.warn('[usePersonalityAnalysis] LLM failed, falling back to rule-based:', err);
          if (cancelled) return;

          const ruleVm = calculateMBTI(mergedFromServer);
          const prof = onboardingProfileFromViewModel(ruleVm);
          try {
            await api.onboarding.patch({ personality: { source: 'rule_fallback', view_model: ruleVm } });
          } catch (patchErr) {
            console.warn('[usePersonalityAnalysis] Could not persist rule-based personality:', patchErr);
          }
          if (cancelled) return;

          dispatch({ type: 'SET_MBTI_RESULT', payload: ruleVm });
          if (prof) dispatch({ type: 'SET_GENERATED_PROFILE', payload: prof });
        } finally {
          if (!cancelled) dispatch({ type: 'SET_PERSONALITY_BUSY', payload: false });
        }
      } catch (err) {
        console.warn('[usePersonalityAnalysis] Server fetch failed:', err);
      }
    };

    run();
    return () => {
      cancelled = true;
      dispatch({ type: 'SET_PERSONALITY_BUSY', payload: false });
    };
  }, [hydrated, currentPhase, dispatch]);
}
