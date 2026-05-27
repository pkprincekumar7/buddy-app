import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import Svg, {
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
  Defs,
} from 'react-native-svg';
import { Volume2, VolumeX, Send, RotateCcw, Brain, Star, Sparkles } from 'lucide-react-native';
import InputWithVoice from '@/components/shared/InputWithVoice';
import { Button } from '@/components/ui/Button';
import { api } from '@/api/client';
import {
  CHATBOT_CAPTURED_FIELDS,
  questionnaireFieldHasValue,
  pickSavedQuestionnaireForChatbot,
  normalizeOnboardingChildDataBlob,
} from '@/lib/onboardingChildData';

// ── types ─────────────────────────────────────────────────────────────────────

interface ConversationStep {
  id: string;
  message: string | ((data: Record<string, unknown>) => string);
  field: string;
  type: 'text' | 'multi_text' | 'choice' | 'auto' | 'final';
  options?: string[];
  placeholder?: string;
  hint?: string;
  phase?: number;
}

interface ChatMessage {
  id: string;
  role: 'bot' | 'user';
  content: string;
}

interface AnalyzingState {
  show: boolean;
  progress: number;
  name: string;
  showingDots: boolean;
  dotCount: number;
}

interface ConversationalOnboardingProps {
  user?: { full_name?: string; email?: string } | null;
  activeChildId?: string;
  onComplete: (data: Record<string, unknown>) => void | Promise<void>;
  resumeHydrationReady?: boolean;
  onContinueToPersonality?: () => void;
  onQuestionnairePersisted?: (data: Record<string, unknown>) => void;
  onQuestionnaireCleared?: () => void;
}

// ── helper functions ──────────────────────────────────────────────────────────

function buildAccThrough(
  flow: ConversationStep[],
  data: Record<string, unknown>,
  beforeStepIdx: number,
): Record<string, unknown> {
  const acc: Record<string, unknown> = {};
  for (let j = 0; j < beforeStepIdx; j++) {
    const st = flow[j];
    if (!st) break;
    if (st.type === 'auto') break;
    acc[st.field] = data[st.field];
  }
  return acc;
}

function buildReplayMessages(
  flow: ConversationStep[],
  data: Record<string, unknown>,
  resumeIdx: number,
  newMsgId: () => string,
): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < resumeIdx; i++) {
    const step = flow[i];
    if (!step) break;
    if (step.type === 'auto') break;
    const acc = buildAccThrough(flow, data, i);
    const botText = typeof step.message === 'function' ? step.message(acc) : step.message;
    msgs.push({ id: newMsgId(), role: 'bot', content: botText });
    const val = data[step.field];
    const userDisplay = Array.isArray(val)
      ? val.join(', ')
      : typeof val === 'string'
        ? val
        : typeof val === 'number' || typeof val === 'boolean'
          ? String(val)
          : '';
    msgs.push({ id: newMsgId(), role: 'user', content: userDisplay });
  }
  return msgs;
}

function findResumeStepIndex(flow: ConversationStep[], data: Record<string, unknown>): number {
  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    if (!step) break;
    if (step.type === 'auto') return i;
    if (!questionnaireFieldHasValue(step.field, data)) return i;
  }
  const autoIx = flow.findIndex((s) => s.type === 'auto');
  return autoIx >= 0 ? autoIx : flow.length - 1;
}

const ANALYZING_INITIAL: AnalyzingState = {
  show: false,
  progress: 0,
  name: '',
  showingDots: false,
  dotCount: 0,
};

// Analyzing step definitions — Lucide icons match web's Brain / Star / Sparkles icons.
const ANALYZE_STEPS = [
  { label: 'Reading personality traits...',    Icon: Brain,    threshold: 25  },
  { label: 'Mapping strengths & interests...', Icon: Star,     threshold: 55  },
  { label: 'Building growth profile...',        Icon: Sparkles, threshold: 80  },
  { label: 'Finalizing personalized journey...', Icon: Sparkles, threshold: 100 },
] as const;

// bg-background (hsl 0 0% 4% ≈ #0a0a0a) — used as mask overlay for gradient progress bar.
const PROGRESS_MASK_BG = '#0a0a0a';

// ── GradientRoundedBox ────────────────────────────────────────────────────────
// Renders a rounded square with a diagonal SVG LinearGradient background.
// Used for the brain icon container, done step icons, and the loading-dots icon.
// Mirrors web's `bg-gradient-to-br ${class}` utility.
function GradientRoundedBox({
  from,
  to,
  size,
  radius,
  children,
}: {
  from: string;
  to: string;
  size: number;
  radius: number;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: radius,
        overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        backgroundColor: from, // fallback before SVG renders
      }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <SvgLinearGradient id="boxGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={from} />
            <Stop offset="100%" stopColor={to} />
          </SvgLinearGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#boxGrad)" rx={radius} />
      </Svg>
      {children}
    </View>
  );
}

// ── BouncingDots ──────────────────────────────────────────────────────────────
// Three vertically-bouncing dots with 150 ms stagger — mirrors web's `animate-bounce`.
// `colors` defaults to gray (typing indicator); pass teal for the loading-dots footer.
function BouncingDots({
  colors = ['#475569', '#475569', '#475569'],
}: {
  colors?: [string, string, string];
}) {
  const d1 = useSharedValue(0);
  const d2 = useSharedValue(0);
  const d3 = useSharedValue(0);

  useEffect(() => {
    const cfg = { duration: 380, easing: Easing.inOut(Easing.ease) };
    d1.value = withRepeat(withTiming(-5, cfg), -1, true);
    d2.value = withRepeat(withDelay(150, withTiming(-5, cfg)), -1, true);
    d3.value = withRepeat(withDelay(300, withTiming(-5, cfg)), -1, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s1 = useAnimatedStyle(() => ({ transform: [{ translateY: d1.value }] }));
  const s2 = useAnimatedStyle(() => ({ transform: [{ translateY: d2.value }] }));
  const s3 = useAnimatedStyle(() => ({ transform: [{ translateY: d3.value }] }));

  const dot = (color: string) =>
    ({ width: 6, height: 6, borderRadius: 3, backgroundColor: color }) as const;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Animated.View style={[dot(colors[0]), s1]} />
      <Animated.View style={[dot(colors[1]), s2]} />
      <Animated.View style={[dot(colors[2]), s3]} />
    </View>
  );
}

// ── TypingIndicatorBubble ─────────────────────────────────────────────────────
// Enter: opacity 0→1 + y 10→0 (450ms easeOut).
// Exit:  opacity 1→0 + y 0→-6 (300ms easeIn).
// Mirrors web's AnimatePresence exit={{ opacity:0, y:-6, transition:{ duration:0.3 } }}.
function TypingIndicatorBubble({ visible }: { visible: boolean }) {
  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(10);

  useEffect(() => {
    if (visible) {
      opacity.value    = withTiming(1, { duration: 450, easing: Easing.out(Easing.ease) });
      translateY.value = withTiming(0, { duration: 450, easing: Easing.out(Easing.ease) });
    } else {
      opacity.value    = withTiming(0, { duration: 300, easing: Easing.in(Easing.ease) });
      translateY.value = withTiming(-6, { duration: 300, easing: Easing.in(Easing.ease) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const style = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={style} className="flex-row justify-start">
      <View
        className="rounded-2xl rounded-tl-sm bg-surface-input px-4 py-3"
        style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <BouncingDots />
      </View>
    </Animated.View>
  );
}

// ── AnimatedMessage ───────────────────────────────────────────────────────────
// Per-message entrance animation — matches web's Framer Motion durations exactly:
//   bot:  opacity 2000ms bezier(0,0,0.6,1)  y 1600ms easeOut
//   user: opacity 1600ms bezier(0,0,0.6,1)  x 1400ms bezier(0.22,1,0.36,1)
function AnimatedMessage({
  role,
  children,
}: {
  role: 'bot' | 'user';
  children: React.ReactNode;
}) {
  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(role === 'bot' ? 16 : 0);
  const translateX = useSharedValue(role === 'user' ? 40 : 0);

  const style = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }, { translateX: translateX.value }],
  }));

  useEffect(() => {
    if (role === 'bot') {
      opacity.value    = withTiming(1, { duration: 2000, easing: Easing.bezier(0.0, 0.0, 0.6, 1.0) });
      translateY.value = withTiming(0, { duration: 1600, easing: Easing.out(Easing.ease) });
    } else {
      opacity.value    = withTiming(1, { duration: 1600, easing: Easing.bezier(0.0, 0.0, 0.6, 1.0) });
      translateX.value = withTiming(0, { duration: 1400, easing: Easing.bezier(0.22, 1.0, 0.36, 1.0) });
    }
  // shared values are stable refs — safe to exclude from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={style}
      className={`flex-row ${role === 'bot' ? 'justify-start' : 'justify-end'}`}
    >
      {children}
    </Animated.View>
  );
}

// ── AnimatedChoiceChip ────────────────────────────────────────────────────────
// Staggered entrance: opacity 0→1 + scale 0.9→1.
// Mirrors web's Framer Motion: initial={{ opacity:0, scale:0.9 }}
// transition={{ delay: index * 0.12, duration: 0.4 }}
function AnimatedChoiceChip({
  option,
  index,
  isSelected,
  onPress,
}: {
  option: string;
  index: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  const opacity = useSharedValue(0);
  const scale   = useSharedValue(0.9);

  useEffect(() => {
    const delay = index * 120;
    const cfg   = { duration: 400, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    scale.value   = withDelay(delay, withTiming(1, cfg));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={onPress}
        className={isSelected ? 'rounded-xl border border-teal-500 bg-teal-500/15 px-3 py-1.5' : 'rounded-xl px-3 py-1.5'}
        style={!isSelected ? {
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderWidth:      1,
          borderColor:      'rgba(255,255,255,0.10)',
        } : undefined}
      >
        <Text className={`text-xs font-medium ${isSelected ? 'text-teal-300' : 'text-slate-400'}`}>
          {option}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ── AnalyzingScreen ───────────────────────────────────────────────────────────
// Matches web's analyzing overlay:
//   • Spinning gradient brain icon (rotate 360 / 3s / linear / infinite)
//   • SVG gradient progress bar (from-teal-500 to-teal-300) with animated width
//   • Step indicators with gradient done-state icon + Lucide icons
function AnalyzingScreen({
  analyzingName,
  analyzeProgress,
}: {
  analyzingName: string;
  analyzeProgress: number;
}) {
  // Brain container rotation — matches web's rotate:360 / duration:3 / repeat:Infinity / ease:linear
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 3000, easing: Easing.linear }),
      -1,
      false,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // Gradient progress bar — SVG LinearGradient + animated mask reveal (same technique as
  // PersonalityAnalysis bars).  `trackWidthSv` mirrors `trackPx` for worklet access.
  const [trackPx, setTrackPx]       = useState(0);
  const trackWidthSv                = useSharedValue(0);
  const progressWidthSv             = useSharedValue(0);

  useEffect(() => {
    if (trackWidthSv.value === 0) return;
    const targetPx = trackWidthSv.value * (analyzeProgress / 100);
    progressWidthSv.value = withTiming(targetPx, { duration: 80 });
  // trackWidthSv / progressWidthSv are stable refs — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeProgress]);

  const progressMaskStyle = useAnimatedStyle(() => ({
    position:        'absolute',
    right:           0,
    top:             0,
    bottom:          0,
    width:           Math.max(0, trackWidthSv.value - progressWidthSv.value),
    backgroundColor: PROGRESS_MASK_BG,
  }));

  const activeStep = ANALYZE_STEPS.findIndex((s) => analyzeProgress < s.threshold);
  const stepEntry  = ANALYZE_STEPS[activeStep >= 0 ? activeStep : ANALYZE_STEPS.length - 1];
  const currentLabel = stepEntry?.label ?? '';

  return (
    <View className="flex-1 items-center justify-center px-6 py-10 gap-8">

      {/* Spinning gradient brain icon — web: motion.div rotate:360 / 3s / Infinity */}
      <Animated.View style={rotateStyle}>
        <GradientRoundedBox from="#2dd4bf" to="#0d9488" size={64} radius={16}>
          <Brain size={32} color="white" />
        </GradientRoundedBox>
      </Animated.View>

      {/* Title + current step label */}
      <View className="items-center gap-2">
        <Text className="text-center text-xl font-bold text-white">
          Analyzing {analyzingName}'s personality
        </Text>
        <Text className="text-sm font-medium text-teal-400">{currentLabel}</Text>
      </View>

      {/* Gradient progress bar + percentage */}
      <View className="w-full gap-2">
        <View
          style={{
            height:          8,
            borderRadius:    999,
            backgroundColor: 'rgba(255,255,255,0.06)',
            overflow:        'hidden',
          }}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            setTrackPx(w);
            trackWidthSv.value = w;
          }}
        >
          {trackPx > 0 && (
            <>
              {/* Full-width gradient — mask progressively reveals it */}
              <Svg width={trackPx} height={8} style={{ position: 'absolute', top: 0, left: 0 }}>
                <Defs>
                  <SvgLinearGradient id="progressGrad" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0%" stopColor="#14b8a6" />  {/* teal-500 */}
                    <Stop offset="100%" stopColor="#5eead4" /> {/* teal-300 */}
                  </SvgLinearGradient>
                </Defs>
                <Rect width={trackPx} height={8} fill="url(#progressGrad)" rx={4} />
              </Svg>
              <Animated.View style={progressMaskStyle} />
            </>
          )}
        </View>
        <Text className="text-right text-xs font-medium text-slate-500">{analyzeProgress}%</Text>
      </View>

      {/* Step indicators */}
      <View className="w-full gap-3">
        {ANALYZE_STEPS.map((s, i) => {
          const { Icon } = s;
          const done  = analyzeProgress >= s.threshold;
          const prevS = ANALYZE_STEPS[i - 1];
          const active = !done && (i === 0 || analyzeProgress >= (prevS?.threshold ?? 0));
          return (
            <View
              key={s.label}
              className="flex-row items-center gap-3"
              style={{ opacity: done || active ? 1 : 0.3 }}
            >
              {done ? (
                // Done: gradient icon — web: bg-gradient-to-br from-emerald-500 to-teal-600
                <GradientRoundedBox from="#10b981" to="#0d9488" size={32} radius={10}>
                  <Icon size={16} color="white" />
                </GradientRoundedBox>
              ) : active ? (
                // Active: teal tinted with ring — web: bg-teal-500/20 ring-1 ring-teal-500/30
                <View style={{
                  width: 32, height: 32, borderRadius: 10,
                  backgroundColor: 'rgba(20,184,166,0.20)',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: 'rgba(20,184,166,0.30)',
                }}>
                  <Icon size={16} color="#2dd4bf" />
                </View>
              ) : (
                // Inactive: subtle dark background
                <View style={{
                  width: 32, height: 32, borderRadius: 10,
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={16} color="#64748b" />
                </View>
              )}
              <Text
                className={`text-sm flex-1 ${
                  done ? 'font-medium text-emerald-400' : active ? 'font-semibold text-white' : 'text-slate-500'
                }`}
              >
                {s.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ConversationalOnboarding({
  user,
  activeChildId,
  onComplete,
  resumeHydrationReady = true,
  onContinueToPersonality,
  onQuestionnairePersisted,
  onQuestionnaireCleared,
}: ConversationalOnboardingProps) {
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentStep, setCurrentStep]   = useState(0);
  const [collectedData, setCollectedData] = useState<Record<string, unknown>>({});
  const [isTyping, setIsTyping]         = useState(false);
  // voiceEnabled drives the header TTS toggle icon (UI-only — expo-speech not installed).
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef                 = useRef(true);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [analyzingState, setAnalyzingState] = useState<AnalyzingState>(ANALYZING_INITIAL);
  const {
    show: showAnalyzing,
    progress: analyzeProgress,
    name: analyzingName,
    showingDots: showingLoadingDots,
    dotCount,
  } = analyzingState;
  const [allAnswered, setAllAnswered] = useState(false);

  // showingTyping stays true for 350ms after isTyping goes false so the exit
  // animation in TypingIndicatorBubble can complete before unmounting.
  const [showingTyping, setShowingTyping] = useState(false);
  const typingExitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isTyping) {
      if (typingExitRef.current !== null) clearTimeout(typingExitRef.current);
      setShowingTyping(true);
    } else {
      typingExitRef.current = setTimeout(() => setShowingTyping(false), 350);
    }
    return () => {
      if (typingExitRef.current !== null) clearTimeout(typingExitRef.current);
    };
  }, [isTyping]);

  const scrollViewRef          = useRef<ScrollView | null>(null);
  const scrollYRef             = useRef(0);
  const contentHeightRef       = useRef(0);
  const containerHeightRef     = useRef(0);
  const isScrollingRef         = useRef(false);
  const idleTimerRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botMsgTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatSessionStartedRef  = useRef(false);
  const allowEmptySessionRecoveryRef = useRef(false);
  const userTurnCountRef       = useRef(0);
  const collectedDataRef       = useRef<Record<string, unknown>>({});
  const msgIdCounterRef        = useRef(0);
  const newMsgId = useCallback(() => `${Date.now()}-${++msgIdCounterRef.current}`, []);

  useEffect(() => {
    collectedDataRef.current = collectedData;
  }, [collectedData]);

  const persistQuestionnaireDraft = useCallback(
    (mergedCollected: Record<string, unknown>) => {
      onQuestionnairePersisted?.(mergedCollected);
      if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        void (async () => {
          if (!activeChildId) return;
          try {
            await api.entities.Child.update(activeChildId, mergedCollected);
          } catch (err) {
            console.warn('[ConversationalOnboarding] Auto-persist child data failed:', err);
          }
        })();
      }, 500);
    },
    [onQuestionnairePersisted, activeChildId],
  );

  const parentName = user?.full_name?.split(' ')[0] ?? 'there';

  const conversationFlow = useMemo<ConversationStep[]>(
    () => [
      {
        id: 'greeting',
        message: `Hey ${parentName}! Hope your day is going well.\nLet's start.\nWhat is your child's name?`,
        field: 'name',
        type: 'text',
        phase: 1,
      },
      {
        id: 'age',
        message: (data) =>
          `Wonderful! And how old is ${typeof data['name'] === 'string' ? data['name'] : ''}?`,
        field: 'age',
        type: 'text',
        placeholder: 'e.g., 10 years',
        phase: 1,
      },
      {
        id: 'school',
        message: (data) =>
          `Great! Which school does ${typeof data['name'] === 'string' ? data['name'] : ''} go to?`,
        field: 'school',
        type: 'text',
        phase: 1,
      },
      {
        id: 'ready_check',
        message: (data) =>
          `Fantastic, Let's start exploring ${typeof data['name'] === 'string' ? data['name'] : ''}'s best version for life right away.\nMention the top 3 strengths that ${typeof data['name'] === 'string' ? data['name'] : ''} has from your perspective.`,
        field: 'strengths',
        type: 'multi_text',
        placeholder: 'e.g., Intelligent, Energetic, Well-mannered',
        hint: 'Separate with commas',
        phase: 1,
      },
      {
        id: 'strengths_response',
        message: (data) =>
          `Happy to know that! You are a lucky parent 😊.\n\nMention the top 3 hobbies where ${typeof data['name'] === 'string' ? data['name'] : ''} spends their time.`,
        field: 'hobbies',
        type: 'multi_text',
        placeholder: 'e.g., Cricket, Drawing, Reading',
        phase: 1,
      },
      {
        id: 'thinking_pattern',
        message: (data) =>
          `Choose the kind of thinking pattern that ${typeof data['name'] === 'string' ? data['name'] : ''} predominantly has:`,
        field: 'thinking_pattern',
        type: 'choice',
        options: ['Visual', 'Analytical', 'Imaginative', 'Not sure'],
        phase: 1,
      },
      {
        id: 'communication_style',
        message: (data) =>
          `Choose the kind of communication style that ${typeof data['name'] === 'string' ? data['name'] : ''} predominantly has:`,
        field: 'communication_style',
        type: 'choice',
        options: [
          'Talkative',
          'Deep Listener',
          'Communicates through gestures',
          'Silent',
          'Observant',
          'Not Sure',
        ],
        phase: 1,
      },
      {
        id: 'energy_level',
        message: (data) =>
          `How would you describe ${typeof data['name'] === 'string' ? data['name'] : ''}'s energy level?`,
        field: 'energy_level',
        type: 'choice',
        options: [
          'High energy - always active',
          'Moderate - balanced',
          'Calm and composed',
          'Variable - depends on interest',
        ],
        phase: 1,
      },
      {
        id: 'social_behaviour',
        message: (data) =>
          `How does ${typeof data['name'] === 'string' ? data['name'] : ''} behave in social situations?`,
        field: 'social_behaviour',
        type: 'choice',
        options: ['Confident', 'Friendly', 'Reserved', 'Expressive', 'Withdrawn'],
        phase: 1,
      },
      {
        id: 'emotional_behaviour',
        message: (data) =>
          `What kind of a child ${typeof data['name'] === 'string' ? data['name'] : ''} emotionally is?`,
        field: 'emotional_behaviour',
        type: 'choice',
        options: ['Calm', 'Sensitive', 'Reserved', 'Impulsive', 'Moody'],
        phase: 1,
      },
      {
        id: 'complete',
        message: () => '',
        field: 'start_analysis',
        type: 'auto',
        phase: 1,
      },
    ],
    [parentName],
  );

  /**
   * Slow-scrolls the chat to the bottom using a 2.5 s easeInOutCubic curve.
   * isScrollingRef guard prevents multiple concurrent RAF loops.
   * Live target recalculation on every frame chases growing content.
   */
  const slowScrollToEnd = useCallback(() => {
    if (isScrollingRef.current) return;
    const el = scrollViewRef.current;
    if (!el) return;
    const startY     = scrollYRef.current;
    const initialEnd = Math.max(0, contentHeightRef.current - containerHeightRef.current);
    if (initialEnd <= startY + 2) return;

    isScrollingRef.current = true;
    const duration  = 2500;
    const startTime = performance.now();
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const step = (now: number) => {
      const liveEnd   = Math.max(0, contentHeightRef.current - containerHeightRef.current);
      const targetEnd = Math.max(initialEnd, liveEnd);
      const progress  = Math.min((now - startTime) / duration, 1);
      el.scrollTo({ x: 0, y: startY + (targetEnd - startY) * easeInOutCubic(progress), animated: false });
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        isScrollingRef.current = false;
      }
    };
    requestAnimationFrame(step);
  }, []);

  /**
   * Adds a batch of messages with 120 ms stagger so they cascade in as the
   * slow scroll reveals them — mirrors the web's staggered replay.
   */
  const addMessagesStaggered = useCallback((msgs: ChatMessage[]) => {
    if (msgs.length === 0) { setMessages([]); return; }
    setMessages([msgs[0]!]);
    for (let i = 1; i < msgs.length; i++) {
      const m = msgs[i]!;
      setTimeout(() => setMessages((prev) => [...prev, m]), i * 120);
    }
  }, []);

  // TTS stub — expo-speech not installed; toggle state is saved via persistVoiceToggle
  // so the preference round-trips through the server even without actual speech.
  const speak = useCallback((_text: string) => {
    // No-op: install expo-speech and call Speech.speak(_text) here to enable TTS.
  }, []);

  const addBotMessage = useCallback(
    (text: string) => {
      setIsTyping(true);
      if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current);
      botMsgTimerRef.current = setTimeout(() => {
        setMessages((prev) => [...prev, { id: newMsgId(), role: 'bot', content: text }]);
        setIsTyping(false);
        speak(text);
        setWaitingForResponse(true);
      }, 1600);
    },
    [speak, newMsgId],
  );

  useEffect(() => {
    return () => {
      if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current);
    };
  }, []);

  // Hydration + preferences load — mirrors web's parallel Promise.all([child, prefs]).
  useEffect(() => {
    if (!resumeHydrationReady) return;

    let cancelled = false;

    void (async () => {
      try {
        let slim: Record<string, unknown> = {};

        // Load child data and TTS preference in parallel — same as web.
        const [child, prefs] = await Promise.all([
          activeChildId ? api.entities.Child.get(activeChildId) : Promise.resolve(null),
          api.preferences.get().catch(() => null),
        ]);

        if (prefs && typeof prefs.tts_enabled === 'boolean') {
          voiceEnabledRef.current = prefs.tts_enabled;
          setVoiceEnabled(prefs.tts_enabled);
        }

        slim = child
          ? pickSavedQuestionnaireForChatbot(normalizeOnboardingChildDataBlob(child) ?? {})
          : {};

        if (cancelled) return;

        const hasSaved = Object.keys(slim).length > 0;

        if (chatSessionStartedRef.current) {
          const canRecover =
            allowEmptySessionRecoveryRef.current && hasSaved && userTurnCountRef.current === 0;
          if (!canRecover) return;
          chatSessionStartedRef.current = false;
          allowEmptySessionRecoveryRef.current = false;
        }

        chatSessionStartedRef.current = true;
        allowEmptySessionRecoveryRef.current = !hasSaved;

        const autoIx  = conversationFlow.findIndex((s) => s.type === 'auto');
        const answered =
          autoIx >= 0 && CHATBOT_CAPTURED_FIELDS.every((f) => questionnaireFieldHasValue(f, slim));

        if (hasSaved && answered && autoIx >= 0) {
          const replay = buildReplayMessages(conversationFlow, slim, autoIx, newMsgId);
          setCollectedData({ ...slim });
          addMessagesStaggered(replay);
          setCurrentStep(autoIx);
          setWaitingForResponse(false);
          setAnalyzingState(ANALYZING_INITIAL);
          setAllAnswered(true);
          return;
        }

        if (!hasSaved) {
          const firstStep    = conversationFlow[0];
          const firstMessage = firstStep
            ? typeof firstStep.message === 'function'
              ? firstStep.message({})
              : firstStep.message
            : '';
          addBotMessage(firstMessage);
          return;
        }

        const resumeIdx = findResumeStepIndex(conversationFlow, slim);
        const replay    = buildReplayMessages(conversationFlow, slim, resumeIdx, newMsgId);
        setCollectedData({ ...slim });
        addMessagesStaggered(replay);
        setCurrentStep(resumeIdx);

        const stepAt = conversationFlow[resumeIdx];
        if (!stepAt) return;
        if (stepAt.type === 'auto') {
          setWaitingForResponse(false);
          setAnalyzingState(ANALYZING_INITIAL);
          setAllAnswered(true);
          return;
        }

        const accR   = buildAccThrough(conversationFlow, slim, resumeIdx);
        const nextBot = typeof stepAt.message === 'function' ? stepAt.message(accR) : stepAt.message;
        addBotMessage(nextBot);
      } catch (err) {
        console.warn('[ConversationalOnboarding] Resume hydration failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [resumeHydrationReady, conversationFlow, addBotMessage, addMessagesStaggered, newMsgId, activeChildId]);

  // Slow-scroll to bottom whenever messages arrive or typing state changes.
  useEffect(() => {
    const t = setTimeout(() => slowScrollToEnd(), 0);
    return () => clearTimeout(t);
  }, [messages, isTyping, slowScrollToEnd]);

  // Pre-fill text/multi answers from persisted data when landing on a question.
  useEffect(() => {
    if (!waitingForResponse || allAnswered) return;
    const stepData = conversationFlow[currentStep];
    if (!stepData?.field || stepData.type === 'choice' || stepData.type === 'auto') {
      setCurrentInput('');
      return;
    }
    const raw = collectedData[stepData.field];
    if (raw === undefined || raw === null) { setCurrentInput(''); return; }
    const text = Array.isArray(raw)
      ? raw.join(', ')
      : typeof raw === 'string'
        ? raw
        : typeof raw === 'number' || typeof raw === 'boolean'
          ? String(raw)
          : '';
    setCurrentInput(text);
  }, [waitingForResponse, currentStep, collectedData, conversationFlow, allAnswered]);

  // Idle reminder — fires after 30s of no input when waiting for a response.
  useEffect(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    if (!waitingForResponse || showAnalyzing || showingLoadingDots || allAnswered) return;

    idleTimerRef.current = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: newMsgId(),
          role: 'bot',
          content: "Just checking in 😊 — whenever you're ready, go ahead and share your answer!",
        },
      ]);
    }, 30000);

    return () => {
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    };
  }, [waitingForResponse, currentStep, showAnalyzing, showingLoadingDots, allAnswered, newMsgId]);

  const processResponse = useCallback(
    (response: string) => {
      const step = conversationFlow[currentStep];

      setMessages((prev) => [...prev, { id: newMsgId(), role: 'user', content: response }]);
      userTurnCountRef.current += 1;
      setWaitingForResponse(false);

      if (response === 'Maybe later' || response === 'Catch up later') {
        addBotMessage(
          `No problem! Take your time. Your progress is saved and you can continue whenever you're ready. See you soon! 👋`,
        );
        return;
      }

      let nextCollected = collectedData;
      if (step?.field) {
        let value: unknown = response;
        if (step.type === 'multi_text') {
          value = response.split(',').map((s) => s.trim()).filter(Boolean);
        }
        nextCollected = { ...collectedData, [step.field]: value };
        setCollectedData(nextCollected);
        persistQuestionnaireDraft(nextCollected);
      }

      if (step?.id === 'complete') {
        const finalData = nextCollected;
        setAnalyzingState({
          show:        true,
          progress:    0,
          name:        typeof finalData['name'] === 'string' ? finalData['name'] : 'your child',
          showingDots: false,
          dotCount:    0,
        });
        let progress = 0;
        const interval = setInterval(() => {
          progress += 1;
          setAnalyzingState((s) => ({ ...s, progress }));
          if (progress >= 100) {
            clearInterval(interval);
            Promise.resolve(onComplete(finalData)).catch(() => {});
          }
        }, 28);
        return;
      }

      const nextStep = currentStep + 1;
      if (nextStep < conversationFlow.length) {
        setCurrentStep(nextStep);
        const nextStepData = conversationFlow[nextStep];
        const nextMessage  = nextStepData
          ? typeof nextStepData.message === 'function'
            ? nextStepData.message(nextCollected)
            : nextStepData.message
          : '';
        setTimeout(() => addBotMessage(nextMessage), 700);
        if (nextStepData?.type === 'final') {
          setTimeout(() => { void onComplete(nextCollected); }, 2000);
        }
      }
    },
    [conversationFlow, currentStep, collectedData, addBotMessage, persistQuestionnaireDraft, onComplete, newMsgId],
  );

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!currentInput.trim() || !waitingForResponse) return;
    resetIdleTimer();
    processResponse(currentInput.trim());
    setCurrentInput('');
  }, [currentInput, waitingForResponse, resetIdleTimer, processResponse]);

  const handleChoiceSelect = useCallback(
    (choice: string) => {
      if (!waitingForResponse) return;
      resetIdleTimer();
      processResponse(choice);
    },
    [waitingForResponse, resetIdleTimer, processResponse],
  );

  // Persist voice toggle state to the server (matches web's persistVoiceToggle).
  const persistVoiceToggle = useCallback(async () => {
    const next = !voiceEnabledRef.current;
    voiceEnabledRef.current = next;
    setVoiceEnabled(next);
    try {
      await api.preferences.patch({ tts_enabled: next });
    } catch (err) {
      console.warn('[ConversationalOnboarding] Could not persist TTS preference:', err);
    }
  }, []);

  const handleReset = useCallback(() => {
    chatSessionStartedRef.current = false;
    allowEmptySessionRecoveryRef.current = false;
    userTurnCountRef.current = 0;
    setMessages([]);
    setCurrentStep(0);
    setCollectedData({});
    setCurrentInput('');
    setIsTyping(false);
    setWaitingForResponse(false);
    setAnalyzingState(ANALYZING_INITIAL);
    setAllAnswered(false);
    void (async () => {
      try {
        if (activeChildId) {
          const cleared: Record<string, null> = {};
          for (const k of CHATBOT_CAPTURED_FIELDS) cleared[k] = null;
          await api.entities.Child.update(activeChildId, cleared);
        }
        onQuestionnaireCleared?.();
      } catch (err) {
        console.warn('[ConversationalOnboarding] Questionnaire clear failed:', err);
      }
    })();
    setTimeout(() => {
      const firstStep    = conversationFlow[0];
      const firstMessage = firstStep
        ? typeof firstStep.message === 'function'
          ? firstStep.message({})
          : firstStep.message
        : '';
      addBotMessage(firstMessage);
    }, 100);
  }, [conversationFlow, addBotMessage, onQuestionnaireCleared, activeChildId]);

  const currentStepData = conversationFlow[currentStep];

  // Auto-proceed on 'auto' type steps after showing animated dots (live flow only).
  useEffect(() => {
    if (!waitingForResponse || currentStepData?.type !== 'auto' || allAnswered) return;
    setAnalyzingState((s) => ({ ...s, showingDots: true, dotCount: 0 }));

    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let count = 0;
    const dotInterval = setInterval(() => {
      count += 1;
      setAnalyzingState((s) => ({ ...s, dotCount: count }));
      if (count >= 12) {
        clearInterval(dotInterval);
        const finalData = { ...collectedDataRef.current };
        setAnalyzingState({
          show:        true,
          progress:    0,
          name:        typeof finalData['name'] === 'string' ? finalData['name'] : 'your child',
          showingDots: false,
          dotCount:    0,
        });
        let progress = 0;
        progressInterval = setInterval(() => {
          progress += 1;
          setAnalyzingState((s) => ({ ...s, progress }));
          if (progress >= 100) {
            if (progressInterval !== null) clearInterval(progressInterval);
            Promise.resolve(onComplete(finalData)).catch(() => {});
          }
        }, 55);
      }
    }, 200);

    return () => {
      clearInterval(dotInterval);
      if (progressInterval !== null) clearInterval(progressInterval);
    };
  }, [waitingForResponse, currentStep, currentStepData?.type, allAnswered, onComplete]);

  // ── Analyzing screen ──────────────────────────────────────────────────────
  if (showAnalyzing) {
    return (
      <AnalyzingScreen
        analyzingName={analyzingName}
        analyzeProgress={analyzeProgress}
      />
    );
  }

  // ── Chat UI ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      className="flex-1 rounded-2xl bg-card overflow-hidden"
      style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={80}
    >

      {/* ── Header ──────────────────────────────────────────────────────── */}
      {/* Web: border-b-edge-faint flex items-center justify-between bg-surface-elevated px-5 py-4 */}
      <View
        className="flex-row items-center justify-between bg-surface-elevated px-5 py-4"
        style={{ borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}
      >
        <View className="flex-row items-center gap-3">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-teal-500/20">
            <Text className="text-lg">🌱</Text>
          </View>
          <View>
            <Text className="text-sm font-semibold text-white">Buddy360 Guide</Text>
            <Text className="text-xs text-slate-500">Your growth companion</Text>
          </View>
        </View>
        {/* TTS toggle — mirrors web's Volume2/VolumeX button (UI state only; expo-speech needed for speech) */}
        <Pressable
          onPress={() => { void persistVoiceToggle(); }}
          className="p-2 rounded-xl"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {voiceEnabled
            ? <Volume2 size={16} color="#64748b" />
            : <VolumeX  size={16} color="#64748b" />
          }
        </Pressable>
      </View>

      {/* ── Messages ────────────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollViewRef}
        className="flex-1 p-4"
        contentContainerStyle={{ gap: 12, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        onScroll={(e)             => { scrollYRef.current       = e.nativeEvent.contentOffset.y; }}
        onLayout={(e)             => { containerHeightRef.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_, h) => { contentHeightRef.current = h; }}
      >
        {messages.map((msg) =>
          msg.role === 'bot' ? (
            // Bot: fade + slide up — opacity 2000ms bezier(0,0,0.6,1) / y 1600ms easeOut
            <AnimatedMessage key={msg.id} role="bot">
              <View
                className="rounded-2xl rounded-tl-sm bg-surface-input px-4 py-2.5"
                style={{ maxWidth: '80%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}
              >
                <Text className="text-sm text-slate-300">{msg.content}</Text>
              </View>
            </AnimatedMessage>
          ) : (
            // User: fade + slide from right — opacity 1600ms / x 1400ms bezier(0.22,1,0.36,1)
            <AnimatedMessage key={msg.id} role="user">
              <View
                className="rounded-2xl rounded-tr-sm bg-teal-500 px-4 py-2.5"
                style={{ maxWidth: '80%' }}
              >
                <Text className="text-sm text-white">{msg.content}</Text>
              </View>
            </AnimatedMessage>
          ),
        )}

        {/* Typing indicator — enter / exit animation via TypingIndicatorBubble */}
        {showingTyping && <TypingIndicatorBubble visible={isTyping} />}
      </ScrollView>

      {/* ── Loading dots (personality analysis transition) ─────────────── */}
      {/* Web: teal gradient icon + Sparkles, animated dots, border-teal-500/20 bg-teal-500/[0.05] */}
      {showingLoadingDots && !allAnswered && (
        <View
          className="px-4 pb-4 pt-2"
          style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}
        >
          <View
            className="rounded-2xl rounded-tl-sm px-4 py-4"
            style={{ maxWidth: '90%', borderWidth: 1, borderColor: 'rgba(20,184,166,0.20)', backgroundColor: 'rgba(20,184,166,0.05)' }}
          >
            <View className="flex-row items-start gap-3">
              {/* Gradient icon — web: bg-gradient-to-br from-teal-400 to-teal-600 glow-teal-sm */}
              <GradientRoundedBox from="#2dd4bf" to="#0d9488" size={36} radius={10}>
                <Sparkles size={16} color="white" />
              </GradientRoundedBox>
              <View className="flex-1 pt-0.5">
                <Text className="text-sm font-semibold text-white leading-snug">
                  Let's do a personality analysis{'.'.repeat(1 + (dotCount % 3))}
                </Text>
                <Text className="mt-1.5 text-xs text-teal-400">
                  Getting things ready — almost there
                </Text>
                {/* Web: three animate-bounce teal dots (teal-400 / teal-500 / teal-600) */}
                <View className="mt-3">
                  <BouncingDots colors={['#2dd4bf', '#14b8a6', '#0d9488']} />
                </View>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ── Choice buttons ─────────────────────────────────────────────── */}
      {/* Web: staggered motion.button chips + RotateCcw reset below chips */}
      {waitingForResponse && !allAnswered && currentStepData?.type === 'choice' && (
        <View
          className="px-4 pb-4 pt-3"
          style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}
        >
          <View className="flex-row flex-wrap gap-2">
            {(currentStepData.options ?? []).map((option, index) => {
              const chosen     = collectedData[currentStepData.field];
              const isSelected = chosen === option;
              return (
                <AnimatedChoiceChip
                  key={`${currentStep}-${option}`}
                  option={option}
                  index={index}
                  isSelected={isSelected}
                  onPress={() => handleChoiceSelect(option)}
                />
              );
            })}
          </View>
          {/* Reset below chips — matches web's RotateCcw + "Reset" row */}
          <View className="mt-2 flex-row justify-end">
            <Pressable
              onPress={handleReset}
              className="flex-row items-center gap-1 p-1"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <RotateCcw size={12} color="#475569" />
              <Text className="text-xs text-slate-600">Reset</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Text / multi-text input ─────────────────────────────────────── */}
      {/* Web: input + RotateCcw reset button + Send button in same row */}
      {waitingForResponse &&
        !allAnswered &&
        (currentStepData?.type === 'text' || currentStepData?.type === 'multi_text') && (
          <View
            className="p-4"
            style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}
          >
            {currentStepData.hint && (
              <Text className="mb-2 text-xs text-slate-500">{currentStepData.hint}</Text>
            )}
            <View className="flex-row gap-2">
              <InputWithVoice
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                placeholder={currentStepData.placeholder ?? 'Type your response...'}
                className="flex-1 h-12 rounded-xl bg-surface-input text-white px-3"
                style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
                placeholderTextColor="#475569"
                onSubmitEditing={handleSubmit}
                returnKeyType="send"
              />
              {/* Reset button — matches web's RotateCcw outline button in input row */}
              <Pressable
                onPress={handleReset}
                className="h-12 w-12 items-center justify-center rounded-xl"
                style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'transparent' }}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              >
                <RotateCcw size={16} color="#475569" />
              </Pressable>
              {/* Send button — matches web's Send icon button */}
              <Pressable
                onPress={handleSubmit}
                className="h-12 w-12 items-center justify-center rounded-xl bg-teal-500"
              >
                <Send size={16} color="white" />
              </Pressable>
            </View>
          </View>
        )}

      {/* ── Continue button (all answered) ─────────────────────────────── */}
      {allAnswered && typeof onContinueToPersonality === 'function' && (
        <View
          className="shrink-0 p-4"
          style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}
        >
          <Button
            onPress={() => onContinueToPersonality()}
            className="h-12 w-full rounded-2xl bg-teal-500 items-center justify-center"
          >
            <Text className="font-semibold text-[#0a0a0a]">Continue to personality analysis</Text>
          </Button>
        </View>
      )}

    </KeyboardAvoidingView>
  );
}
