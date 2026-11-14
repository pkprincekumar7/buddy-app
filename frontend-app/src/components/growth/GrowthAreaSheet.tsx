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
  type TextStyle,
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
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { SPINNER } from '@/lib/animations';
import { daysAgo, rankedGames, type WorldSummary } from '@/api/kidWorlds';
import { fillTemplate } from '@/lib/growthAreaData';
import type {
  GrowthArea,
  GrowthRecommendation,
  Question,
  RecommendationSource,
} from '@/lib/growthAreaData';
import { color, css, font, rgb } from '@/theme';
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

export type { SetStatus } from './SetGate';

/**
 * The per-area overlay over the Growth Map, as the prototype has it:
 *
 *   questions → "Guided Reflection": the parent's five free-text reflections
 *   insights  → "Growth insights": what the parent answered and what the child played
 *               in child view (the area's world), and the recommendations from both
 *
 * Two tabs switch between them. An area the parent has answered opens on its insights;
 * one they haven't, on its questions. The answers persist once, on Finish
 * (onSaveAnswers), which moves to the insights; the caller keeps the recommendations
 * current (onShowInsights) and passes them down.
 *
 * The questions are generated per child per area by the caller and arrive as props, with
 * the status of that generation: waiting, unusable (with a retry) or ready.
 *
 * RN: a Portal overlay (Android back = the web's Escape) holding the web's centred
 * panel, with the same fade-in backdrop and rise-in panel; the fade-out plays before
 * onClose so the caller's unmount isn't abrupt.
 */

type Phase = 'questions' | 'insights';
export type RecsPhase = 'idle' | 'loading' | 'ready' | 'error';

const PANEL_MAX = 620;
const BACKDROP_MS = 300;

const CLOSE_PATH = 'M6 6l12 12M18 6L6 18';
const CHEVRON_LEFT = 'M14 6l-6 6 6 6';
const CHEVRON_RIGHT = 'M10 6l6 6-6 6';
const ARROW_RIGHT = 'M5 12h13M12 6l6 6-6 6';

/** The score ring: its box, the ring's width (the web's inset) and the arc's circle. */
const RING = 92;
const RING_W = 8;
const RING_R = (RING - RING_W) / 2;
const RING_C = 2 * Math.PI * RING_R;

const BACKDROP_BG = css(
  'radial-gradient(ellipse at 50% 40%,rgb(var(--constellation-overlay-rgb) / .72),rgb(var(--constellation-void-rgb) / .93) 70%)',
);
const BADGE_BG = css(
  'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
);
const PIP_CURRENT = css(
  'linear-gradient(90deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-cyan-bright-rgb)))',
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
const INSIGHTS_IN = fadeUp(10, 400);

const COUNTER_TEXT: TextStyle = {
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 11 * 0.16,
  color: rgb('constellation-slate-dark'),
};

/** The small cyan caps over a block ("Parent app", "Latest child view result"). */
const EYEBROW: TextStyle = {
  fontWeight: '700',
  fontSize: 9.5,
  letterSpacing: 9.5 * 0.28,
  textTransform: 'uppercase',
  color: rgb('constellation-cyan-bright'),
};

const CARD: ViewStyle = {
  borderRadius: 13,
  experimental_backgroundImage: css(
    'linear-gradient(120deg,rgb(var(--constellation-navy-soft-rgb) / .55),rgb(var(--constellation-ink-navy-rgb) / .55))',
  ),
};

const FILLED = rgb('constellation-gold', 0.45);
const UNFILLED = rgb('constellation-cyan', 0.16);

/** A game score's colour: its band's gold / cyan / violet as the page's tokens. */
const BAND_TOKEN = {
  gold: 'constellation-gold',
  cyan: 'constellation-cyan',
  violet: 'constellation-lavender',
} as const;

/** Each recommendation's tag: its words, colour and border. */
const TAGS: Record<
  RecommendationSource,
  { label: (name: string) => string; color: string; border: string }
> = {
  both: {
    label: name => `You + ${name}`,
    color: rgb('constellation-gold'),
    border: rgb('constellation-gold', 0.5),
  },
  kid: {
    label: name => `${name}’s games`,
    color: rgb('constellation-sky'),
    border: rgb('constellation-cyan', 0.4),
  },
  you: {
    label: () => 'Your answers',
    color: rgb('constellation-lilac'),
    border: rgb('constellation-lilac', 0.45),
  },
  step: {
    label: () => 'Next step',
    color: rgb('constellation-mint'),
    border: rgb('constellation-mint', 0.45),
  },
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** One of the two tabs under the header. */
function Tab({
  on,
  onPress,
  label,
  dot = false,
}: {
  on: boolean;
  onPress: () => void;
  label: string;
  dot?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 8,
          paddingHorizontal: 16,
          borderRadius: 999,
          backgroundColor: on ? rgb('constellation-cyan', 0.16) : 'transparent',
          borderWidth: 1,
          borderColor: on
            ? rgb('constellation-cyan', 0.7)
            : rgb('constellation-cyan', 0.22),
        },
        pressed ? { transform: [{ scale: 0.97 }] } : null,
      ]}
    >
      <Text
        numberOfLines={1}
        style={{
          fontWeight: '700',
          fontSize: 12,
          letterSpacing: 12 * 0.14,
          textTransform: 'uppercase',
          color: on
            ? rgb('constellation-cyan-pale')
            : rgb('constellation-slate-dark'),
        }}
      >
        {label}
      </Text>
      {dot ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: rgb('constellation-gold'),
            boxShadow: css('0 0 8px rgb(var(--constellation-gold-rgb) / .9)'),
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** "Parent app" / "Child view": where the insights come from, gold-edged once there. */
function SourceCard({
  label,
  text,
  filled,
}: {
  label: string;
  text: string;
  filled: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: 13,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: filled ? FILLED : UNFILLED,
        backgroundColor: rgb('constellation-ink-navy', 0.55),
      }}
    >
      <Text style={EYEBROW}>{label}</Text>
      <Text
        style={{
          marginTop: 4,
          fontWeight: '700',
          fontSize: 14,
          color: rgb('constellation-cyan-pale'),
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * The run's total as a ring. The web draws it with a conic gradient; RN has none, so
 * it's an SVG track circle and an arc from the top to total%, cyan into gold.
 */
function ScoreRing({ total }: { total: number }) {
  const share = Math.max(0, Math.min(100, total)) / 100;
  return (
    <View
      accessibilityLabel={`${total} out of 100`}
      style={{ width: RING, height: RING, flexShrink: 0 }}
    >
      <Svg
        width={RING}
        height={RING}
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          <LinearGradient id="growthRing" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={rgb('constellation-cyan')} />
            <Stop offset="100%" stopColor={rgb('constellation-gold')} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={RING_R}
          fill="none"
          stroke={rgb('constellation-cyan', 0.12)}
          strokeWidth={RING_W}
        />
        {share > 0 ? (
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_R}
            fill="none"
            stroke="url(#growthRing)"
            strokeWidth={RING_W}
            strokeDasharray={`${RING_C} ${RING_C}`}
            strokeDashoffset={RING_C * (1 - share)}
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        ) : null}
      </Svg>
      <View
        style={{
          position: 'absolute',
          top: RING_W,
          left: RING_W,
          right: RING_W,
          bottom: RING_W,
          borderRadius: RING / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: rgb('constellation-badge-b'),
        }}
      >
        <Text
          style={[
            font('orbitron', 700),
            {
              fontSize: 26,
              lineHeight: 26,
              color: rgb('constellation-cyan-paler'),
            },
          ]}
        >
          {total}
        </Text>
        <Text
          style={{
            marginTop: 2,
            fontSize: 9.5,
            fontWeight: '700',
            letterSpacing: 9.5 * 0.18,
            color: rgb('constellation-slate-dark'),
          }}
        >
          / 100
        </Text>
      </View>
    </View>
  );
}

/** The latest run: its total in a ring, its strongest and weakest game, and each game. */
function WorldResult({ world }: { world: WorldSummary }) {
  const order = rankedGames(world.rows.map(r => r.score));
  const best = world.rows[order[0] ?? 0];
  const weakest = world.rows[order[order.length - 1] ?? 0];
  const up = world.change !== null && world.change > 0;
  const change =
    world.change === null
      ? ''
      : ` · ${world.change >= 0 ? '+' : ''}${world.change} vs last try`;

  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <ScoreRing total={world.total} />
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text style={[EYEBROW, { letterSpacing: 9.5 * 0.3 }]}>
            Latest child view result
          </Text>
          <Text
            style={[
              font('orbitron', 700),
              {
                marginTop: 6,
                fontSize: 17,
                color: rgb('constellation-cyan-paler'),
              },
            ]}
          >
            Strongest: {best?.skill}. Room to grow: {weakest?.skill}.
          </Text>
          <Text
            style={{
              marginTop: 5,
              fontSize: 13.5,
              fontWeight: '600',
              color: up
                ? rgb('constellation-mint')
                : rgb('constellation-slate-dark'),
            }}
          >
            Played {daysAgo(world.at)} · {plural(world.tries, 'try', 'tries')}
            {change}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 16, gap: 9 }}>
        {world.rows.map(row => {
          const token = BAND_TOKEN[row.band?.color ?? 'cyan'];
          return (
            <View
              key={row.title}
              style={[
                CARD,
                {
                  paddingVertical: 11,
                  paddingHorizontal: 14,
                  borderWidth: 1,
                  borderColor: rgb('constellation-cyan', 0.16),
                },
              ]}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <View style={{ flexShrink: 1, minWidth: 0, gap: 2 }}>
                  <Text
                    style={{
                      fontWeight: '700',
                      fontSize: 14.5,
                      lineHeight: 14.5 * 1.25,
                      color: rgb('constellation-cyan-pale'),
                    }}
                  >
                    {row.skill}
                  </Text>
                  <Text
                    style={{
                      fontWeight: '600',
                      fontSize: 12.5,
                      lineHeight: 12.5 * 1.25,
                      color: rgb('constellation-slate-dark'),
                    }}
                  >
                    {row.title}
                  </Text>
                </View>
                <Text
                  style={[
                    font('orbitron', 700),
                    { fontSize: 15, color: rgb(token) },
                  ]}
                >
                  {row.score}
                </Text>
              </View>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  marginTop: 9,
                  height: 5,
                  borderRadius: 3,
                  overflow: 'hidden',
                  backgroundColor: rgb('constellation-cyan', 0.12),
                }}
              >
                <View
                  style={{
                    width: `${row.score}%`,
                    height: '100%',
                    borderRadius: 3,
                    experimental_backgroundImage: css(
                      `linear-gradient(90deg,rgb(var(--constellation-cyan-bright-rgb)),rgb(var(--${token}-rgb)))`,
                    ),
                  }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

/** One numbered recommendation, with its tag. */
function Recommendation({
  rec,
  index,
  childName,
}: {
  rec: GrowthRecommendation;
  index: number;
  childName: string;
}) {
  const tag = rec.source ? TAGS[rec.source] : null;
  return (
    <View
      style={[
        CARD,
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderWidth: 1,
          borderColor: rgb('constellation-gold', 0.18),
        },
      ]}
    >
      <View style={{ width: 26, alignItems: 'center', gap: 6, paddingTop: 2 }}>
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: rgb('constellation-gold-pale'),
            boxShadow: css('0 0 10px rgb(var(--constellation-gold-rgb) / .9)'),
          }}
        />
        <Text
          style={[
            font('orbitron', 700),
            { fontSize: 10, color: rgb('constellation-gold', 0.6) },
          ]}
        >
          {String(index + 1).padStart(2, '0')}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Text
            style={{
              flexShrink: 1,
              fontWeight: '700',
              fontSize: 14.5,
              lineHeight: 14.5 * 1.35,
              color: rgb('constellation-cyan-pale'),
            }}
          >
            {rec.title}
          </Text>
          {tag ? (
            <View
              style={{
                paddingVertical: 2,
                paddingHorizontal: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: tag.border,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontWeight: '700',
                  fontSize: 10,
                  letterSpacing: 10 * 0.14,
                  textTransform: 'uppercase',
                  color: tag.color,
                }}
              >
                {tag.label(childName)}
              </Text>
            </View>
          ) : null}
        </View>
        {rec.detail ? (
          <Text
            style={{
              marginTop: 3,
              fontWeight: '600',
              fontSize: 13,
              lineHeight: 13 * 1.45,
              color: rgb('constellation-slate-cool'),
            }}
          >
            {rec.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

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
  /** Previously saved answers for this area, used to prefill a redo. */
  initialAnswers?: Record<string, unknown>;
  /** Open on the insights (an answered area) rather than the questions. */
  initialPhase?: Phase;
  /** How many of the area's reflections the parent has saved. */
  answered: number;
  /** The child's latest run of this area's world in child view; null until played. */
  world: WorldSummary | null;
  onClose: () => void;
  /** Resolve true to move to the insights; false keeps the parent on question five. */
  onSaveAnswers: (answers: Record<string, string>) => Promise<boolean>;
  /** Called when the insights are shown from a tab, so the caller can bring the
   *  recommendations up to date. */
  onShowInsights: () => void;
  /** Leaves the sheet for the Life Pathway (Transform) page. */
  onExploreTransform: () => void;
  /** True while the caller's save is in flight. */
  isSaving?: boolean;
  /** Status of the recommendation generation the caller runs. */
  recsPhase?: RecsPhase;
  recommendations?: GrowthRecommendation[];
  onRetryRecommendations: () => void;
}

export default function GrowthAreaSheet({
  area,
  childName,
  childGender,
  parentQuestions,
  initialAnswers,
  initialPhase = 'questions',
  answered,
  world,
  onClose,
  onSaveAnswers,
  onShowInsights,
  onExploreTransform,
  isSaving = false,
  recsPhase = 'idle',
  recommendations = [],
  onRetryRecommendations,
}: GrowthAreaSheetProps) {
  const insets = useSafeAreaInsets();
  const {
    data: generatedQuestions,
    status: questionsStatus,
    progress: questionsProgress = '',
    onRetry: onRetryQuestions,
  } = parentQuestions;
  // Stable while the set is pending, so the prefill effect doesn't rerun every render.
  const questions: Question[] = useMemo(
    () => generatedQuestions ?? [],
    [generatedQuestions],
  );

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const textareaRef = useRef<TextInput | null>(null);
  const who = childName || 'Your child';
  const fill = (text: string) => fillTemplate(text, childName, childGender);

  // Prefill a redo from previously saved answers, keeping only keys belonging to the
  // current question set. An effect, because the questions may arrive after opening;
  // merging means a late set never discards what the parent has typed.
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
  const isLastQuestion = qIdx >= questions.length - 1;

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

  // Focus the field on open and on each question change, including when the
  // generated questions land and the field first exists.
  useEffect(() => {
    if (phase === 'questions' && questionsStatus === 'ready')
      textareaRef.current?.focus();
  }, [qIdx, phase, questionsStatus]);

  const showInsights = useCallback(() => {
    setPhase('insights');
    onShowInsights();
  }, [onShowInsights]);

  const goNext = useCallback(async () => {
    if (isSaving) return;
    if (!isLastQuestion) {
      setQIdx(i => i + 1);
      return;
    }
    // Only move on once the write has landed: a failed save leaves the parent on
    // question five with their text intact.
    if (await onSaveAnswers(answers)) setPhase('insights');
  }, [isLastQuestion, onSaveAnswers, answers, isSaving]);

  const hasInput = answered > 0 || world !== null;
  const recsFrom =
    answered > 0 && world
      ? `From your answers and ${who}’s games`
      : answered > 0
      ? 'From your answers'
      : `From ${who}’s games`;

  return (
    <Portal onRequestClose={requestClose}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { experimental_backgroundImage: BACKDROP_BG },
          backdropStyle,
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
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
              accessibilityLabel={`${area.name} — ${
                phase === 'insights' ? 'growth insights' : 'guided reflection'
              }`}
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
                      numberOfLines={1}
                      style={{
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: 9.5 * 0.34,
                        fontSize: 9.5,
                        lineHeight: 9.5 * 1.3,
                        color: rgb('constellation-cyan-bright'),
                      }}
                    >
                      {phase === 'insights'
                        ? 'Growth insights'
                        : 'Guided Reflection'}
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

                <View
                  accessibilityRole="tablist"
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginTop: 18,
                  }}
                >
                  <Tab
                    label="Reflection"
                    on={phase === 'questions'}
                    onPress={() => {
                      setQIdx(0);
                      setPhase('questions');
                    }}
                  />
                  <Tab
                    label="Recommendations"
                    on={phase === 'insights'}
                    onPress={showInsights}
                    dot={world !== null}
                  />
                </View>

                {/* ── Growth insights ── */}
                {phase === 'insights' && (
                  <Animated.View
                    entering={INSIGHTS_IN}
                    style={{ marginTop: 20 }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: 10,
                        marginBottom: 16,
                      }}
                    >
                      <SourceCard
                        label="Parent app"
                        text={
                          answered > 0
                            ? `${answered} of ${
                                questions.length || 5
                              } reflections answered`
                            : 'No reflections yet'
                        }
                        filled={answered > 0}
                      />
                      <SourceCard
                        label="Child view"
                        text={
                          world
                            ? `${plural(
                                world.tries,
                                'game round',
                                'game rounds',
                              )}, last ${daysAgo(world.at)}`
                            : 'Games not played yet'
                        }
                        filled={world !== null}
                      />
                    </View>

                    {world ? (
                      <WorldResult world={world} />
                    ) : (
                      <View
                        style={{
                          paddingVertical: 18,
                          paddingHorizontal: 20,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderStyle: 'dashed',
                          borderColor: rgb('constellation-cyan', 0.3),
                          alignItems: 'center',
                        }}
                      >
                        <Text
                          style={[
                            font('orbitron', 700),
                            {
                              fontSize: 16,
                              textAlign: 'center',
                              color: rgb('constellation-cyan-paler'),
                            },
                          ]}
                        >
                          {answered > 0
                            ? `${who}’s side is missing`
                            : 'Nothing to go on yet'}
                        </Text>
                        <Text
                          style={{
                            marginTop: 8,
                            fontSize: 14.5,
                            fontWeight: '600',
                            lineHeight: 14.5 * 1.45,
                            textAlign: 'center',
                            color: rgb('constellation-slate-soft'),
                          }}
                        >
                          {answered > 0
                            ? `${who} hasn’t played the ${area.name} games in child view yet. For now, these recommendations use your answers only.`
                            : `Answer the reflection questions here and ask ${who} to play the ${area.name} games in child view. Recommendations will appear once either is done.`}
                        </Text>
                      </View>
                    )}

                    {hasInput && (
                      <View
                        style={{
                          marginTop: 18,
                          borderTopWidth: 1,
                          borderTopColor: rgb('constellation-gold', 0.22),
                          paddingTop: 18,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            gap: 14,
                          }}
                        >
                          <Text
                            accessibilityRole="header"
                            style={[
                              font('orbitron', 700),
                              {
                                fontSize: 13.5,
                                letterSpacing: 13.5 * 0.14,
                                textTransform: 'uppercase',
                                color: rgb('constellation-gold'),
                              },
                            ]}
                          >
                            Recommendations
                          </Text>
                          <Text
                            style={{
                              fontSize: 10.5,
                              fontWeight: '600',
                              letterSpacing: 10.5 * 0.14,
                              textTransform: 'uppercase',
                              color: rgb('constellation-slate'),
                            }}
                          >
                            {recsFrom}
                          </Text>
                        </View>

                        <View
                          accessibilityLiveRegion="polite"
                          style={{ gap: 9, marginTop: 14 }}
                        >
                          {(recsPhase === 'loading' ||
                            recsPhase === 'idle') && (
                            <View
                              style={{
                                alignItems: 'center',
                                gap: 12,
                                paddingVertical: 24,
                              }}
                            >
                              <Animated.View
                                accessibilityRole="progressbar"
                                accessibilityLabel="Loading"
                                style={[
                                  {
                                    width: 34,
                                    height: 34,
                                    borderRadius: 17,
                                    borderWidth: 2,
                                    borderColor: rgb('constellation-gold', 0.2),
                                    borderTopColor: rgb('constellation-gold'),
                                  },
                                  SPINNER,
                                ]}
                              />
                              <Text
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: '600',
                                  textAlign: 'center',
                                  color: rgb('constellation-slate-soft'),
                                }}
                              >
                                {fill('Writing recommendations for {name}…')}
                              </Text>
                            </View>
                          )}

                          {recsPhase === 'error' && (
                            <View
                              style={{
                                alignItems: 'center',
                                gap: 12,
                                paddingVertical: 8,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 13,
                                  fontWeight: '600',
                                  textAlign: 'center',
                                  color: rgb('constellation-slate-soft'),
                                }}
                              >
                                We couldn’t write the recommendations just now.
                              </Text>
                              <Pill
                                label="Try again"
                                onPress={onRetryRecommendations}
                                textColor={CTA_TEXT}
                                style={[
                                  CTA,
                                  {
                                    paddingVertical: 10,
                                    paddingHorizontal: 24,
                                  },
                                ]}
                              />
                            </View>
                          )}

                          {recsPhase === 'ready' &&
                            recommendations.map((rec, i) => (
                              <Recommendation
                                key={i}
                                rec={rec}
                                index={i}
                                childName={who}
                              />
                            ))}
                        </View>
                      </View>
                    )}

                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        marginTop: 18,
                      }}
                    >
                      <Pill
                        label="Done"
                        onPress={requestClose}
                        textColor={CTA_TEXT}
                        style={[
                          CTA,
                          { paddingVertical: 11, paddingHorizontal: 26 },
                        ]}
                      />
                      <Pill
                        label="Explore Transform"
                        onPress={onExploreTransform}
                        textColor={rgb('constellation-gold-pale')}
                        icon={{
                          d: ARROW_RIGHT,
                          side: 'right',
                          size: 14,
                          strokeWidth: 2.4,
                        }}
                        style={{
                          paddingVertical: 11,
                          paddingHorizontal: 22,
                          backgroundColor: rgb('constellation-navy-deep', 0.9),
                          borderWidth: 1,
                          borderColor: rgb('constellation-gold', 0.5),
                        }}
                      />
                    </View>
                  </Animated.View>
                )}

                {/* ── Guided Reflection: the parent's five reflections ── */}
                {phase === 'questions' && questionsStatus !== 'ready' && (
                  <SetGate
                    status={questionsStatus}
                    progress={questionsProgress}
                    onRetry={onRetryQuestions}
                    waiting={fill('Writing questions about {name}…')}
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
                              {fill(currentQuestion.question)}
                            </Text>
                            <Text
                              style={{
                                marginTop: 8,
                                fontSize: 13.5,
                                fontWeight: '600',
                                color: rgb('constellation-slate-dark'),
                              }}
                            >
                              {fill(currentQuestion.hint)}
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
                              accessibilityLabel={fill(
                                currentQuestion.question,
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
