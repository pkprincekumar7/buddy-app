import { useEffect } from 'react';
import { api } from '@/api/client';
import {
  calculateMBTI,
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '@/components/shared/PersonalityAnalysis';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import { sanitizeViewModelAvatars } from '@/lib/avatarUtils';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';

// Fires when the wizard reaches the personality phase (phase 2).
// Reads from and writes to the child record directly — no separate onboarding collection.
export function usePersonalityAnalysis({ hydrated, currentPhase, activeChildId, dispatch }) {
  useEffect(() => {
    if (!hydrated || currentPhase !== 2 || !activeChildId) return;
    let cancelled = false;

    const run = async () => {
      dispatch({ type: 'SET_PERSONALITY_BUSY', payload: true });
      try {
        const child = await api.entities.Child.get(activeChildId);
        if (cancelled) return;

        const mergedFromServer = mergeChildDraft(normalizeOnboardingChildDataBlob(child) || {});

        if (child.personality?.view_model?.type && child.personality?.view_model?.profile) {
          const clampedReuse = maybeClampStoredPersonalityDescription(
            child.personality.view_model,
            {
              analysisSource: child.personality.source,
            },
          );
          // Sanitize any legacy image URLs (e.g. ui-avatars.com) that may have
          // been persisted by older code.  Safe data URIs and Wikipedia images
          // are left unchanged; everything else is replaced with a local avatar.
          const sanitized = sanitizeViewModelAvatars(clampedReuse);
          dispatch({ type: 'SET_MBTI_RESULT', payload: sanitized });
          dispatch({
            type: 'SET_GENERATED_PROFILE',
            payload: onboardingProfileFromViewModel(sanitized),
          });
          return;
        }

        if (!mergedFromServer.name?.trim?.()) {
          dispatch({ type: 'SET_MBTI_RESULT', payload: null });
          dispatch({ type: 'SET_GENERATED_PROFILE', payload: null });
          return;
        }

        if (cancelled) return;

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

          const vm = adaptAiPersonalityToViewModel(ai || {}, mergedFromServer.name);
          const prof = onboardingProfileFromViewModel(vm);
          await api.entities.Child.update(activeChildId, {
            personality: { source: 'llm', view_model: vm },
          });
          if (cancelled) return;

          dispatch({ type: 'SET_MBTI_RESULT', payload: vm });
          if (prof) dispatch({ type: 'SET_GENERATED_PROFILE', payload: prof });
        } catch (err) {
          console.warn('[usePersonalityAnalysis] LLM failed, falling back to rule-based:', err);

          const ruleVm = calculateMBTI(mergedFromServer);
          const prof = onboardingProfileFromViewModel(ruleVm);
          try {
            await api.entities.Child.update(activeChildId, {
              personality: { source: 'rule_fallback', view_model: ruleVm },
            });
          } catch (patchErr) {
            console.warn(
              '[usePersonalityAnalysis] Could not persist rule-based personality:',
              patchErr,
            );
          }
          if (cancelled) return;

          dispatch({ type: 'SET_MBTI_RESULT', payload: ruleVm });
          if (prof) dispatch({ type: 'SET_GENERATED_PROFILE', payload: prof });
        } finally {
          if (!cancelled) dispatch({ type: 'SET_PERSONALITY_BUSY', payload: false });
        }
      } catch (err) {
        console.warn('[usePersonalityAnalysis] Server fetch failed:', err);
      } finally {
        if (!cancelled) dispatch({ type: 'SET_PERSONALITY_BUSY', payload: false });
      }
    };

    run();
    return () => {
      cancelled = true;
      dispatch({ type: 'SET_PERSONALITY_BUSY', payload: false });
    };
  }, [hydrated, currentPhase, activeChildId, dispatch]);
}
