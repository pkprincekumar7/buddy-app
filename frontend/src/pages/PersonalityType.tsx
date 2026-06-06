import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import PersonalityAnalysis, {
  calculateMBTI,
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
} from '@/components/shared/PersonalityAnalysis';
import type { MbtiResult } from '@/components/shared/PersonalityAnalysis';
import { maybeClampStoredPersonalityDescription } from '@/lib/personalizedDescriptionOneLiner';
import { sanitizeViewModelAvatars, stripViewModelImages } from '@/lib/avatarUtils';
import { personalityLlmSchema } from '@/lib/llmSchemas';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { buildPersonalityAnalysisPrompt } from '@/lib/prompts';
import { SPINNER } from '@/lib/animations';
import PageActions from '@/components/shared/PageActions';
import StartOverButton from '@/components/shared/StartOverButton';

export default function PersonalityType() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [childName, setChildName] = useState('');
  const [mbtiResult, setMbtiResult] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState('loading'); // loading | analysing | ready | error
  const [showSplash, startTimer] = useStageSplash();
  const [ttsEnabled, setTtsEnabled] = useState(true);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const [child, prefs] = await Promise.all([
          api.entities.Child.get(childId),
          api.preferences.get().catch(() => null),
        ]);
        if (cancelled) return;

        if (!child) {
          navigate('/Home', { replace: true });
          return;
        }

        if (prefs && typeof prefs.tts_enabled === 'boolean') {
          setTtsEnabled(prefs.tts_enabled);
        }

        const merged = mergeChildDraft(normalizeOnboardingChildDataBlob(child) ?? {});
        setChildName(merged.name || '');

        // DB hit: personality already analysed — skip LLM
        const personality = child.personality;
        const viewModel = personality?.view_model;
        if (viewModel?.type && viewModel?.profile) {
          const clamped = maybeClampStoredPersonalityDescription(viewModel, {
            analysisSource: personality?.source,
          });
          setMbtiResult(sanitizeViewModelAvatars(clamped));
          setStatus('ready');
          return;
        }

        if (!merged.name?.trim()) {
          navigate(`/ConversationalOnboarding/${childId}`, { replace: true });
          return;
        }

        // Call LLM
        setStatus('analysing');
        const childId_ = child.id;
        try {
          const prompt = buildPersonalityAnalysisPrompt({
            childData: merged,
            personalityTypeKeys: PERSONALITY_TYPE_KEYS,
          });
          const ai = await api.integrations.Core.InvokeLLM({
            prompt,
            response_json_schema: personalityLlmSchema(),
          });
          if (cancelled) return;

          const vm = adaptAiPersonalityToViewModel(
            (ai as Record<string, unknown>) || {},
            merged.name,
          );
          // Strip SVG data-URI images before saving — WAF blocks payloads containing
          // <svg>/<text> tags. sanitizeViewModelAvatars regenerates them on next load.
          await api.entities.Child.update(childId_, {
            personality: { source: 'llm', view_model: stripViewModelImages(vm) },
            onboarding_phase: 2,
          });
          if (cancelled) return;
          setMbtiResult(vm);
        } catch (err) {
          console.warn('[PersonalityType] LLM failed, falling back to rule-based:', err);
          const ruleVm = calculateMBTI(merged);
          try {
            await api.entities.Child.update(childId_, {
              personality: { source: 'rule_fallback', view_model: stripViewModelImages(ruleVm) },
              onboarding_phase: 2,
            });
          } catch {
            /* non-fatal */
          }
          if (cancelled) return;
          setMbtiResult(ruleVm);
        }
        setStatus('ready');
      } catch (err) {
        console.warn('[PersonalityType] Load failed:', err);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const handleContinue = async () => {
    if (childId) {
      await api.entities.Child.update(childId, { onboarding_phase: 3 }).catch(() => {});
    }
    navigate(`/PersonalityJourney/${childId}`);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoadingAuth || status === 'loading' ? (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <motion.div
              {...SPINNER}
              className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent"
            />
          </div>
        ) : status === 'analysing' ? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
            <motion.div
              {...SPINNER}
              className="h-12 w-12 rounded-full border-2 border-teal-500 border-t-transparent"
            />
            <p className="max-w-md text-center font-medium text-slate-400">
              Shaping personality insights from your questionnaire…
            </p>
          </div>
        ) : status === 'error' || !mbtiResult ? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
            <p className="text-slate-400">Something went wrong. Please try again.</p>
            <Button
              onClick={() => navigate(childId ? `/ConversationalOnboarding/${childId}` : '/Home')}
              className="btn-primary rounded-2xl px-8"
            >
              Go Back
            </Button>
          </div>
        ) : (
          <div key={showSplash ? 'splash' : 'content'} className="min-h-screen bg-background">
            {/* Progress indicator */}
            <div className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
              <div className="mx-auto max-w-4xl px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  {[
                    { label: 'Getting to Know', icon: '💬', done: true },
                    { label: 'Personality Analysis', icon: '⭐', active: true },
                    { label: 'Your Journey', icon: '💡', active: false },
                  ].map((phase) => (
                    <div
                      key={phase.label}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 transition-all ${
                        phase.active
                          ? 'border border-teal-500/25 bg-teal-500/10'
                          : phase.done
                            ? 'border border-emerald-500/20 bg-emerald-500/10'
                            : 'bg-ghost border-edge-faint opacity-50'
                      }`}
                    >
                      <span className="text-base" aria-hidden="true">
                        {phase.icon}
                      </span>
                      <span
                        className={`hidden text-xs font-medium sm:block ${phase.active ? 'text-teal-400' : phase.done ? 'text-emerald-400' : 'text-slate-600'}`}
                      >
                        {phase.label}
                      </span>
                      {phase.done && <span className="text-xs text-emerald-400">✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
              <PersonalityAnalysis
                mbtiResult={mbtiResult as unknown as MbtiResult}
                childName={childName}
                ready={!showSplash}
                ttsEnabled={ttsEnabled}
              />

              <PageActions
                className="mt-12"
                left={
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigate(`/ConversationalOnboarding/${childId}`, {
                        state: { fromBack: true },
                      })
                    }
                    className="btn-secondary h-12 w-full rounded-2xl px-6 text-base sm:w-auto"
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                }
                center={<StartOverButton childId={childId} className="w-full sm:w-auto" />}
                right={
                  <Button
                    size="xl"
                    onClick={() => {
                      void handleContinue();
                    }}
                    className="btn-primary w-full rounded-2xl px-8 sm:w-auto"
                  >
                    Continue
                    <ChevronRight className="ml-1 h-5 w-5" />
                  </Button>
                }
              />
            </div>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {showSplash && <StageSplash stage={2} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
