import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
  type ViewStyle,
} from 'react-native';
import { Portal } from '@/components/ui/portal';
import { Pressable } from '@/components/ui/pressable';
import Animated, {
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import {
  GAME_ROUNDS_PER_AREA,
  fillTemplate,
  pickedOptions,
  resolveRounds,
  topArchetype,
} from '@/lib/growthAreaData';
import type {
  GameOption,
  GameRound,
  GrowthArea,
  GrowthRecommendation,
  Question,
} from '@/lib/growthAreaData';
import { color, css, font, rgb } from '@/theme';
import ResultPhase, { type RecsPhase } from './ResultPhase';
import SetGate, { type SetStatus } from './SetGate';
import {
  CTA,
  CTA_TEXT,
  EASE_OUT,
  EASE_OUT_EXPO,
  PathIcon,
  Pill,
  fadeUp,
} from './shared';

export type { RecsPhase } from './ResultPhase';
export type { SetStatus } from './SetGate';

/**
 * The whole per-area flow, as one overlay over the Growth Map:
 *
 *   questions → the parent's five free-text reflections
 *   handoff   → the "hand the screen over" beat
 *   rounds    → the child's six either/or choices
 *   result    → constellation + recommendations
 *
 * Nothing is written per step. The parent's answers persist once, when they hit
 * Finish (onSaveAnswers); the child's picks persist once, after round six
 * (onCompleteRounds) — which also kicks off recommendation generation in the
 * caller. The archetype and constellation render instantly off the picks alone
 * (no network needed); recsPhase/recommendations stream in afterwards as that
 * generation progresses. Closing the sheet mid-run discards the current step,
 * matching the source design — except mid-round, where it would strand the
 * child half-way through their six choices.
 *
 * Neither question set is owned here: both are generated per child per area by
 * the caller and arrive as props, along with the status of that generation.
 *
 * RN: a Portal overlay (Android back = the web's Escape) holding the web's
 * centred panel, with the same fade-in backdrop and rise-in panel; the fade-out
 * plays before onClose so the caller's unmount isn't abrupt.
 */

type Phase = 'questions' | 'handoff' | 'rounds' | 'result';

const PANEL_MAX = 620;
const BACKDROP_MS = 300;

/** Star, shown on the handoff beat. */
const HANDOFF_STAR_PATH =
  'M12 3l2.2 5.6L20 9.4l-4 4 1 6-5-2.9-5 2.9 1-6-4-4 5.8-.8z';
const CLOSE_PATH = 'M6 6l12 12M18 6L6 18';
const CHEVRON_LEFT = 'M14 6l-6 6 6 6';
const CHEVRON_RIGHT = 'M10 6l6 6-6 6';

const BACKDROP_BG = css(
  'radial-gradient(ellipse at 50% 40%,rgb(var(--constellation-overlay-rgb) / .72),rgb(var(--constellation-void-rgb) / .93) 70%)',
);
const BADGE_BG = css(
  'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
);

const PANEL: ViewStyle = {
  width: '100%',
  maxWidth: PANEL_MAX,
  maxHeight: '100%',
  borderRadius: 20,
  experimental_backgroundImage: css(
    'linear-gradient(165deg,rgb(var(--constellation-navy-panel3-rgb) / .96),rgb(var(--constellation-ink-navy-rgb) / .98))',
  ),
  borderWidth: 1,
  borderColor: rgb('constellation-gold', 0.42),
  boxShadow: css(
    '0 26px 70px rgb(var(--black-rgb) / .6),0 0 44px rgb(var(--constellation-cyan-rgb) / .12)',
  ),
};

const PANEL_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 26 }, { scale: 0.985 }] },
  100: {
    opacity: 1,
    transform: [{ translateY: 0 }, { scale: 1 }],
    easing: EASE_OUT_EXPO,
  },
}).duration(420);

const STEP_IN = fadeUp(10, 340);
const HANDOFF_IN = fadeUp(10, 400);

const CHOICE_TILE: ViewStyle = {
  flex: 1,
  borderRadius: 16,
  paddingVertical: 18,
  paddingHorizontal: 16,
  experimental_backgroundImage: css(
    'linear-gradient(160deg,rgb(var(--constellation-navy-soft-rgb) / .9),rgb(var(--constellation-ink-navy-rgb) / .9))',
  ),
  borderWidth: 1,
  borderColor: rgb('constellation-cyan', 0.26),
  alignItems: 'center',
  gap: 12,
};

// Marks the option that occupied this round on the previous run — shown on a
// Play Again replay so it reads as "here's what was picked, change it if you
// like" rather than a blank round with no memory of the earlier answer.
const CHOICE_TILE_PICKED: ViewStyle = {
  ...CHOICE_TILE,
  borderColor: rgb('constellation-gold', 0.85),
  boxShadow: css(
    '0 0 0 1px rgb(var(--constellation-gold-rgb) / .35),0 0 22px rgb(var(--constellation-gold-rgb) / .25)',
  ),
};

const PIP_CURRENT = css(
  'linear-gradient(90deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-cyan-bright-rgb)))',
);

const COUNTER_TEXT = {
  fontSize: 11,
  fontWeight: '700' as const,
  letterSpacing: 11 * 0.16,
  color: rgb('constellation-slate-dark'),
};

interface GrowthAreaSheetProps {
  area: GrowthArea;
  childName: string;
  childGender: string;
  /** The parent's five reflections for this area — data, generation status,
   *  progress note, and retry, grouped since they're one stage's state. */
  parentQuestions: {
    data: Question[] | null;
    status: SetStatus;
    /** Elapsed-time note shown while the reflections generate; '' when there is none. */
    progress?: string;
    onRetry: () => void;
  };
  /** The child's six either/or rounds for this area — same shape as parentQuestions. */
  childRounds: {
    data: GameRound[] | null;
    status: SetStatus;
    progress?: string;
    onRetry: () => void;
  };
  /** Previously saved answers for this area, used to prefill a redo. */
  initialAnswers?: Record<string, unknown>;
  /** Mount straight into the result view for an already-finished area. Requires initialPicks. */
  initialPhase?: Phase;
  /** The picks a completed area's result was generated from — only with initialPhase="result". */
  initialPicks?: string[];
  onClose: () => void;
  /** Resolve true to advance to the handoff; false keeps the parent on question five. */
  onSaveAnswers: (answers: Record<string, string>) => Promise<boolean>;
  /** Called on Play Again, so the caller can generate rounds if it has none yet. */
  onReplayRounds: () => void;
  /** Called once, with the six chosen option ids, after the last round (and after any replay). */
  onCompleteRounds: (pickedIds: string[]) => void;
  /** Called from the result phase's "Explore Transform" button. */
  onExploreTransform: () => void;
  /** True while either of the caller's writes is in flight. */
  isSaving?: boolean;
  /** Status of the recommendation generation the caller kicked off. */
  recsPhase?: RecsPhase;
  recommendations?: GrowthRecommendation[];
}

export default function GrowthAreaSheet({
  area,
  childName,
  childGender,
  parentQuestions,
  childRounds,
  initialAnswers,
  initialPhase = 'questions',
  initialPicks,
  onClose,
  onSaveAnswers,
  onReplayRounds,
  onCompleteRounds,
  onExploreTransform,
  isSaving = false,
  recsPhase = 'idle',
  recommendations = [],
}: GrowthAreaSheetProps) {
  const insets = useSafeAreaInsets();
  const {
    data: generatedQuestions,
    status: questionsStatus,
    progress: questionsProgress = '',
    onRetry: onRetryQuestions,
  } = parentQuestions;
  const {
    data: generatedRounds,
    status: roundsStatus,
    progress: roundsProgress = '',
    onRetry: onRetryRounds,
  } = childRounds;
  // Stable empty arrays, so an area still waiting on its sets does not hand every
  // downstream memo and effect a fresh reference on each render.
  const questions: Question[] = useMemo(
    () => generatedQuestions ?? [],
    [generatedQuestions],
  );
  const rounds: GameRound[] = useMemo(
    () => generatedRounds ?? [],
    [generatedRounds],
  );

  if (__DEV__ && generatedRounds && rounds.length !== GAME_ROUNDS_PER_AREA) {
    // The handoff copy promises "Six quick choices"; shout in dev if a generated
    // set ever stops matching that promise.
    console.warn(
      `[GrowthAreaSheet] ${area.id} has ${rounds.length} rounds but the handoff copy says ${GAME_ROUNDS_PER_AREA}.`,
    );
  }

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [qIdx, setQIdx] = useState(0);
  const [rIdx, setRIdx] = useState(0);
  const [picks, setPicks] = useState<string[]>(
    initialPhase === 'result' ? initialPicks ?? [] : [],
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const textareaRef = useRef<TextInput | null>(null);

  // Prefill a redo from previously saved answers, keeping only keys belonging to
  // the current question set. An effect because the questions arrive
  // asynchronously; merging means a late set can never discard typed input.
  useEffect(() => {
    if (questions.length === 0) return;
    const known = new Set(questions.map(q => q.id));
    setAnswers(prev => {
      const seed: Record<string, string> = {};
      for (const [k, v] of Object.entries(initialAnswers ?? {})) {
        if (known.has(k) && typeof v === 'string' && prev[k] === undefined)
          seed[k] = v;
      }
      return Object.keys(seed).length > 0 ? { ...prev, ...seed } : prev;
    });
  }, [questions, initialAnswers]);

  const currentQuestion = questions[qIdx];
  const currentRound = rounds[rIdx];
  const isLastQuestion = qIdx >= questions.length - 1;

  // Closing mid-round would strand the child half-way through their choices —
  // but while the rounds are still being written (or have failed) there is no run
  // to strand, and a parent stuck on that wait must be able to get out.
  const dismissable = phase !== 'rounds' || roundsStatus !== 'ready';

  // ── Open / close motion ───────────────────────────────────────────────────
  const backdrop = useSharedValue(0);
  const leavingRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    backdrop.value = withTiming(1, { duration: BACKDROP_MS, easing: EASE_OUT });
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [backdrop]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  // The caller ignores a close while a write is in flight; mirror that here so
  // the overlay never fades out from under a sheet that stays mounted.
  const requestClose = useCallback(() => {
    if (isSaving || leavingRef.current) return;
    leavingRef.current = true;
    backdrop.value = withTiming(0, { duration: BACKDROP_MS, easing: EASE_OUT });
    closeTimer.current = setTimeout(onClose, BACKDROP_MS);
  }, [isSaving, backdrop, onClose]);

  // Move focus into the field on open and on each question change — including
  // the moment the generated questions land and the field first exists.
  useEffect(() => {
    if (phase === 'questions' && questionsStatus === 'ready')
      textareaRef.current?.focus();
  }, [qIdx, phase, questionsStatus]);

  const goNext = useCallback(async () => {
    if (isSaving) return;
    if (!isLastQuestion) {
      setQIdx(i => i + 1);
      return;
    }
    // Only advance once the single write has landed — a failed save leaves the
    // parent on question five with their text intact.
    const saved = await onSaveAnswers(answers);
    if (saved) setPhase('handoff');
  }, [isLastQuestion, onSaveAnswers, answers, isSaving]);

  const choose = useCallback(
    (option: GameOption) => {
      if (isSaving) return;
      // Assign by index rather than appending — on a Play Again replay it
      // overwrites the previous run's pick at this round in place.
      const next = [...picks];
      next[rIdx] = option.id;
      setPicks(next);
      if (rIdx >= rounds.length - 1) {
        // The archetype and constellation are derived from `next` alone, so the
        // result view renders immediately — recommendations catch up via props.
        setPhase('result');
        onCompleteRounds(next);
      } else {
        setRIdx(i => i + 1);
      }
    },
    [picks, rIdx, rounds.length, onCompleteRounds, isSaving],
  );

  const playAgain = useCallback(() => {
    setRIdx(0);
    // Deliberately keep `picks` — each round pre-highlights what was chosen last time.
    setPhase('rounds');
    // No-op unless this area finished before its rounds were generated.
    onReplayRounds();
  }, [onReplayRounds]);

  // The picks being rendered may predate this child's generated rounds — the set
  // the ids belong to decides which one they resolve against.
  const pickRounds = useMemo(
    () => resolveRounds(area.id, generatedRounds, picks),
    [area.id, generatedRounds, picks],
  );
  const archetype = useMemo(
    () => topArchetype(area.id, pickRounds, picks)?.archetype ?? null,
    [area.id, pickRounds, picks],
  );
  const pickedStars = useMemo(
    () => pickedOptions(pickRounds, picks).map(o => o.star),
    [pickRounds, picks],
  );

  return (
    <Portal
      onRequestClose={() => {
        // Android back = the web's Escape: closes, except once the child is answering.
        if (dismissable) requestClose();
      }}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { experimental_backgroundImage: BACKDROP_BG },
          backdropStyle,
        ]}
      >
        {/* Backdrop dismiss, except mid-round where it would discard the child's run. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (dismissable) requestClose();
          }}
          accessible={false}
          importantForAccessibility="no"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
          pointerEvents="box-none"
        >
          <View
            pointerEvents="box-none"
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: 22,
              paddingTop: 22 + insets.top,
              paddingBottom: 22 + insets.bottom,
            }}
          >
            <Animated.View
              entering={PANEL_IN}
              style={PANEL}
              accessibilityViewIsModal
              accessibilityLabel={`${area.name} — guided reflection`}
            >
              <ScrollView
                style={{ flexGrow: 0, borderRadius: 20 }}
                contentContainerStyle={{
                  paddingTop: 26,
                  paddingHorizontal: 30,
                  paddingBottom: 24,
                }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Area header — persists across the first three phases. */}
                {phase !== 'result' && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingRight: 34,
                    }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 19,
                        flexShrink: 0,
                        alignItems: 'center',
                        justifyContent: 'center',
                        experimental_backgroundImage: BADGE_BG,
                        borderWidth: 1.5,
                        borderColor: rgb('constellation-gold', 0.75),
                        boxShadow: css(
                          '0 0 22px rgb(var(--constellation-cyan-rgb) / .22)',
                        ),
                      }}
                    >
                      <PathIcon
                        d={area.iconPath}
                        size={19}
                        stroke={area.iconColor}
                        strokeWidth={1.8}
                      />
                    </View>
                    <View style={{ flexShrink: 1 }}>
                      <Text
                        style={{
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          letterSpacing: 9.5 * 0.34,
                          fontSize: 9.5,
                          color: rgb('constellation-cyan-bright'),
                        }}
                      >
                        Guided Reflection
                      </Text>
                      <Text
                        accessibilityRole="header"
                        style={[
                          font('orbitron', 700),
                          {
                            fontSize: 17,
                            marginTop: 3,
                            color: rgb('constellation-cyan-paler'),
                          },
                        ]}
                      >
                        {area.name}
                      </Text>
                    </View>
                  </View>
                )}

                {/* ── Phase: the parent's five reflections ── */}
                {phase === 'questions' && questionsStatus !== 'ready' && (
                  <SetGate
                    status={questionsStatus}
                    progress={questionsProgress}
                    onRetry={onRetryQuestions}
                    waiting={fillTemplate(
                      'Writing questions about {name}…',
                      childName,
                      childGender,
                    )}
                  />
                )}

                {phase === 'questions' &&
                  questionsStatus === 'ready' &&
                  currentQuestion && (
                    <>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 7,
                          marginTop: 20,
                        }}
                      >
                        {questions.map((q, i) => (
                          <View
                            key={q.id}
                            style={[
                              { height: 3, flex: 1, borderRadius: 2 },
                              i === qIdx
                                ? { experimental_backgroundImage: PIP_CURRENT }
                                : {
                                    backgroundColor:
                                      i < qIdx
                                        ? rgb('constellation-gold', 0.7)
                                        : rgb('constellation-cyan', 0.16),
                                  },
                            ]}
                          />
                        ))}
                        <Text
                          numberOfLines={1}
                          style={[COUNTER_TEXT, { marginLeft: 6 }]}
                        >
                          {qIdx + 1} / {questions.length}
                        </Text>
                      </View>

                      <View style={{ marginTop: 22, minHeight: 150 }}>
                        <Animated.View
                          key={qIdx}
                          entering={STEP_IN}
                          style={{ flexDirection: 'row', gap: 14 }}
                        >
                          <Text
                            style={[
                              font('orbitron', 700),
                              {
                                flexShrink: 0,
                                fontSize: 26,
                                lineHeight: 26,
                                color: rgb('constellation-gold', 0.55),
                              },
                            ]}
                          >
                            {String(qIdx + 1).padStart(2, '0')}
                          </Text>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text
                              style={[
                                font('orbitron', 500),
                                {
                                  fontSize: 17,
                                  lineHeight: 17 * 1.45,
                                  color: rgb('constellation-cyan-pale'),
                                },
                              ]}
                            >
                              {fillTemplate(
                                currentQuestion.question,
                                childName,
                                childGender,
                              )}
                            </Text>
                            <Text
                              style={{
                                marginTop: 8,
                                fontSize: 13.5,
                                fontWeight: '600',
                                color: rgb('constellation-slate-dark'),
                              }}
                            >
                              {fillTemplate(
                                currentQuestion.hint,
                                childName,
                                childGender,
                              )}
                            </Text>
                            <TextareaWithVoice
                              ref={textareaRef}
                              value={answers[currentQuestion.id] ?? ''}
                              onChange={e =>
                                setAnswers(prev => ({
                                  ...prev,
                                  [currentQuestion.id]: e.target.value,
                                }))
                              }
                              placeholder="Type your thoughts…"
                              accessibilityLabel={fillTemplate(
                                currentQuestion.question,
                                childName,
                                childGender,
                              )}
                              rows={3}
                              placeholderTextColor={color['muted-foreground']}
                              style={{
                                marginTop: 14,
                                width: '100%',
                                borderRadius: 12,
                                paddingVertical: 12,
                                paddingLeft: 14,
                                paddingRight: 44,
                                backgroundColor: rgb(
                                  'constellation-surface',
                                  0.85,
                                ),
                                borderWidth: 1,
                                borderColor: rgb('constellation-cyan', 0.24),
                                fontWeight: '600',
                                fontSize: 15,
                                lineHeight: 15 * 1.5,
                                color: rgb('constellation-cyan-pale'),
                              }}
                            />
                          </View>
                        </Animated.View>
                      </View>

                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          marginTop: 20,
                        }}
                      >
                        <Pill
                          label="Back"
                          accessibilityLabel="Previous question"
                          onPress={() => setQIdx(i => Math.max(0, i - 1))}
                          disabled={qIdx === 0}
                          textColor={rgb('constellation-slate-soft')}
                          icon={{
                            d: CHEVRON_LEFT,
                            side: 'left',
                            size: 13,
                            strokeWidth: 2.2,
                          }}
                          style={{
                            paddingVertical: 10,
                            paddingHorizontal: 20,
                            backgroundColor: rgb('constellation-overlay', 0.85),
                            borderWidth: 1,
                            borderColor: rgb('constellation-cyan', 0.28),
                            opacity: qIdx === 0 ? 0.35 : 1,
                          }}
                        />
                        <Pill
                          label={
                            isSaving
                              ? 'Saving…'
                              : isLastQuestion
                              ? 'Finish'
                              : 'Next'
                          }
                          onPress={() => void goNext()}
                          disabled={isSaving}
                          textColor={CTA_TEXT}
                          icon={{
                            d: CHEVRON_RIGHT,
                            side: 'right',
                            size: 13,
                            strokeWidth: 2.4,
                          }}
                          style={[
                            CTA,
                            {
                              gap: 9,
                              paddingVertical: 11,
                              paddingHorizontal: 26,
                              opacity: isSaving ? 0.6 : 1,
                            },
                          ]}
                        />
                      </View>
                    </>
                  )}

                {/* ── Phase: hand the device to the child ── */}
                {phase === 'handoff' && (
                  <Animated.View
                    entering={HANDOFF_IN}
                    style={{ marginTop: 26, alignItems: 'center' }}
                  >
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        alignItems: 'center',
                        justifyContent: 'center',
                        experimental_backgroundImage: BADGE_BG,
                        borderWidth: 1.5,
                        borderColor: rgb('constellation-gold', 0.75),
                        boxShadow: css(
                          '0 0 30px rgb(var(--constellation-cyan-rgb) / .28)',
                        ),
                      }}
                    >
                      <PathIcon
                        d={HANDOFF_STAR_PATH}
                        size={28}
                        stroke={rgb('constellation-gold')}
                        strokeWidth={1.7}
                      />
                    </View>
                    <Text
                      accessibilityRole="header"
                      style={[
                        font('orbitron', 700),
                        {
                          marginTop: 16,
                          fontSize: 18,
                          textAlign: 'center',
                          color: rgb('constellation-cyan-paler'),
                        },
                      ]}
                    >
                      {fillTemplate(
                        'Thank you. Now {name}’s turn.',
                        childName,
                        childGender,
                      )}
                    </Text>
                    <Text
                      style={{
                        marginTop: 9,
                        maxWidth: 400,
                        fontSize: 14.5,
                        fontWeight: '600',
                        textAlign: 'center',
                        color: rgb('constellation-slate-soft'),
                      }}
                    >
                      {fillTemplate(
                        // Spelled out, as the design has it — the round count is fixed by
                        // GAME_ROUNDS_PER_AREA, asserted above.
                        `Hand the screen to {name}. Six quick choices, then {his} ${area.name} constellation appears.`,
                        childName,
                        childGender,
                      )}
                    </Text>
                    {/* The child's rounds are written while the parent reads the copy above. */}
                    {roundsStatus === 'ready' ? (
                      <Pill
                        label="I’m ready"
                        onPress={() => {
                          setRIdx(0);
                          setPicks([]);
                          setPhase('rounds');
                        }}
                        textColor={CTA_TEXT}
                        fontSize={13}
                        style={[
                          CTA,
                          {
                            marginTop: 20,
                            paddingVertical: 12,
                            paddingHorizontal: 30,
                          },
                        ]}
                      />
                    ) : (
                      <SetGate
                        status={roundsStatus}
                        progress={roundsProgress}
                        onRetry={onRetryRounds}
                        waiting={fillTemplate(
                          'Building {name}’s choices…',
                          childName,
                          childGender,
                        )}
                      />
                    )}
                  </Animated.View>
                )}

                {/* ── Phase: the child's six either/or rounds ── */}
                {/* Reachable un-generated only via Play Again on an area finished before
                    its rounds were ever generated; the handoff gates every other route in. */}
                {phase === 'rounds' && roundsStatus !== 'ready' && (
                  <SetGate
                    status={roundsStatus}
                    progress={roundsProgress}
                    onRetry={onRetryRounds}
                    waiting={fillTemplate(
                      'Building {name}’s choices…',
                      childName,
                      childGender,
                    )}
                  />
                )}

                {phase === 'rounds' &&
                  roundsStatus === 'ready' &&
                  currentRound && (
                    <Animated.View
                      key={rIdx}
                      entering={STEP_IN}
                      style={{ marginTop: 22 }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <Text
                          accessibilityRole="header"
                          style={[
                            font('orbitron', 500),
                            {
                              flexShrink: 1,
                              fontSize: 16,
                              color: rgb('constellation-cyan-pale'),
                            },
                          ]}
                        >
                          Which would you rather do?
                        </Text>
                        <Text numberOfLines={1} style={COUNTER_TEXT}>
                          Round {rIdx + 1} of {rounds.length}
                        </Text>
                      </View>

                      <View
                        style={{ flexDirection: 'row', gap: 14, marginTop: 16 }}
                      >
                        {[currentRound.a, currentRound.b].map(
                          (option, side) => {
                            const wasPickedLastTime = picks[rIdx] === option.id;
                            return (
                              <Pressable
                                key={option.id}
                                accessibilityRole="button"
                                accessibilityLabel={`${option.text}${
                                  wasPickedLastTime ? ' (picked last time)' : ''
                                }`}
                                accessibilityState={{ disabled: isSaving }}
                                onPress={() => choose(option)}
                                disabled={isSaving}
                                style={({ pressed }) => [
                                  wasPickedLastTime
                                    ? CHOICE_TILE_PICKED
                                    : CHOICE_TILE,
                                  pressed
                                    ? { transform: [{ scale: 0.98 }] }
                                    : null,
                                ]}
                              >
                                <PathIcon
                                  d={option.icon}
                                  size={30}
                                  stroke={
                                    side === 0
                                      ? rgb('constellation-cyan')
                                      : rgb('constellation-gold')
                                  }
                                  strokeWidth={1.7}
                                />
                                <Text
                                  style={{
                                    fontWeight: '700',
                                    fontSize: 14.5,
                                    lineHeight: 14.5 * 1.4,
                                    textAlign: 'center',
                                    color: rgb('constellation-cyan-pale'),
                                  }}
                                >
                                  {option.text}
                                </Text>
                                {wasPickedLastTime && (
                                  <Text
                                    numberOfLines={1}
                                    style={{
                                      fontSize: 9.5,
                                      fontWeight: '700',
                                      letterSpacing: 9.5 * 0.12,
                                      textTransform: 'uppercase',
                                      color: rgb('constellation-gold', 0.9),
                                    }}
                                  >
                                    Picked last time
                                  </Text>
                                )}
                              </Pressable>
                            );
                          },
                        )}
                      </View>
                    </Animated.View>
                  )}

                {/* ── Phase: constellation + recommendations ── */}
                {phase === 'result' && (
                  <ResultPhase
                    area={area}
                    childName={childName}
                    childGender={childGender}
                    archetype={archetype}
                    pickedStars={pickedStars}
                    recsPhase={recsPhase}
                    recommendations={recommendations}
                    onPlayAgain={playAgain}
                    onDone={requestClose}
                    onExploreTransform={onExploreTransform}
                  />
                )}

                {/* Close — after the content so it stacks on top of the header row. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={requestClose}
                  hitSlop={8}
                  style={({ pressed }) => [
                    {
                      position: 'absolute',
                      top: 16,
                      right: 18,
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderColor: rgb('constellation-cyan', 0.28),
                    },
                    pressed ? { transform: [{ scale: 0.97 }] } : null,
                  ]}
                >
                  <PathIcon
                    d={CLOSE_PATH}
                    size={13}
                    stroke={rgb('constellation-slate-dark')}
                    strokeWidth={2.2}
                  />
                </Pressable>
              </ScrollView>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Portal>
  );
}
