import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { useNavigate, useParams } from '@/lib/router';
import { useAuth } from '@/lib/AuthContext';
import { onboarding, answersFrom, ONBOARDING_ERRORS } from '@/api/onboarding';
import { settlePersonality } from '@/api/discover';
import { useFocusEffect } from '@react-navigation/native';
import ConversationalOnboardingChat from '@/components/onboarding/ConversationalOnboarding';
import PageLoader from '@/components/shared/PageLoader';
import PageBackRow from '@/components/layout/PageBackRow';
import { httpErrorMessage } from '@/lib/apiError';
import { Button } from '@/components/ui/button';
import { raw } from '@/theme';

// The conversational onboarding (build plan 7.5): the chat keeps the answers until the
// end, then this screen saves all seven in one PUT and goes on to the Personality
// Journey. Discover starts the personality by itself, and the hub waits for it. The same
// flow as the web's pages/ConversationalOnboarding.tsx.

// web: initial={{ opacity: 0 }} animate={{ opacity: 1 }}, 0.8s easeOut.
const PAGE_FADE = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1, easing: Easing.out(Easing.ease) },
}).duration(800);

const ERROR_FADE_IN = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1 },
}).duration(300);
const ERROR_FADE_OUT = new Keyframe({
  0: { opacity: 1 },
  100: { opacity: 0 },
}).duration(300);

const DEEP_BG = { backgroundColor: raw['bg-deep-3'] };

export default function ConversationalOnboarding() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  // What the chat resumed from (the child's fields, and any saved answers).
  const draftRef = useRef<Record<string, unknown>>({});
  const [hydrated, setHydrated] = useState(false);
  // The answers being saved, kept for "Try again" after a failed save.
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // bootKey is a static mount key for the chat component; held as a constant since it never changes.
  const bootKey = 0;
  // One save at a time: a second tap (Try again, Continue) while one is in flight
  // must not send the answers twice or navigate twice.
  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  // The wait for the personality (below) stops when the parent leaves this screen:
  // going Back unmounts it, but the header's Home pushes over it and keeps it mounted,
  // so it's tied to focus, not to unmounting.
  const waitRef = useRef<AbortController | null>(null);
  // The answers were saved but the parent left before the wait ended: coming back goes
  // straight on to the hub, which keeps waiting for the personality itself.
  const savedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (savedRef.current && !inFlightRef.current && childId) {
        void navigate(`/PersonalityJourney/${childId}`, { replace: true });
      }
      return () => waitRef.current?.abort();
    }, [childId, navigate]),
  );
  // A second save while one runs gets the same promise, so whoever awaits it (the
  // Continue button) waits for the real outcome.
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const draft = await onboarding.draft(childId);
        if (!cancelled) draftRef.current = draft;
      } catch (err) {
        console.warn('[ConversationalOnboarding] Hydration failed:', err);
        if (!cancelled) void navigate('/Home', { replace: true });
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const save = useCallback(
    (collected: Record<string, unknown>): Promise<void> => {
      if (inFlightRef.current) return inFlightRef.current;
      const run = (async () => {
        if (!childId || savingRef.current) return;
        pendingRef.current = collected;
        setSaveError(null);
        const answers = answersFrom(collected);
        if (!answers) {
          setSaveError(
            'Some answers are missing. Please go through the chat again.',
          );
          return;
        }
        savingRef.current = true;
        setIsSaving(true);
        try {
          try {
            await onboarding.save(childId, answers);
          } catch (err) {
            console.warn(
              '[ConversationalOnboarding] Could not save the answers:',
              err,
            );
            setSaveError(
              httpErrorMessage(err as Error, {
                codeMessages: ONBOARDING_ERRORS,
                fallback: "We couldn't save your answers. Please try again.",
              }),
            );
            return;
          }
          savedRef.current = true;
          // Wait here, on the thank-you screen, for discover to finish the personality.
          // Whatever happens (it failed, it's slow, the network dropped), go on to the
          // hub: it shows a failure with Try again, and keeps waiting for a slow one.
          const wait = new AbortController();
          waitRef.current = wait;
          const { signal } = wait;
          try {
            await settlePersonality(childId, { signal, timeoutMs: 180_000 });
          } catch (err) {
            if (signal.aborted) return;
            console.warn(
              '[ConversationalOnboarding] Personality not ready yet:',
              err,
            );
          }
          if (signal.aborted) return;
          void navigate(`/PersonalityJourney/${childId}`);
        } finally {
          savingRef.current = false;
          setIsSaving(false);
        }
      })();
      inFlightRef.current = run;
      void run.finally(() => {
        inFlightRef.current = null;
      });
      return run;
    },
    [childId, navigate],
  );

  const handleComplete = useCallback(
    (conversationData: Record<string, unknown>) =>
      save({ ...draftRef.current, ...conversationData }),
    [save],
  );

  return (
    <View className="flex-1 bg-background">
      <PageBackRow />
      {/* Page content — fades in smoothly */}
      <Animated.View entering={PAGE_FADE} className="flex-1">
        {isLoadingAuth || !hydrated ? (
          <PageLoader />
        ) : (
          <View className="relative flex-1" style={DEEP_BG}>
            {/* Chat fills remaining height */}
            <View className="min-h-0 flex-1">
              <ConversationalOnboardingChat
                key={bootKey}
                user={user}
                activeChildId={childId}
                resumeHydrationReady={hydrated}
                onComplete={handleComplete}
                onContinueToPersonality={() => handleComplete({})}
                saving={isSaving}
              />
            </View>

            {/* Error overlay — fades in over the loading screen when the save fails */}
            {saveError !== null && (
              <Animated.View
                key="save-error"
                entering={ERROR_FADE_IN}
                exiting={ERROR_FADE_OUT}
                className="absolute inset-0 items-center justify-center gap-4 px-6 pb-20"
                style={DEEP_BG}
              >
                <Text
                  accessibilityRole="header"
                  className="w-full max-w-2xl text-center text-3xl font-bold text-white/90"
                  style={{ lineHeight: 30 * 1.08 }}
                >
                  Something went wrong
                </Text>
                <Text className="text-center text-base text-white/60">
                  {saveError}
                </Text>
                <Button
                  onPress={() =>
                    void save(pendingRef.current ?? draftRef.current)
                  }
                  size="lg"
                  className="mt-4"
                  disabled={isSaving}
                  accessibilityLabel="Try again"
                >
                  Try again
                </Button>
              </Animated.View>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
}
