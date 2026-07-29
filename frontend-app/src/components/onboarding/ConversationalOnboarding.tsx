import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { EmojiText } from '@/components/ui/EmojiText';
import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import {
  Activity,
  BarChart2,
  Check,
  ChevronDown,
  Cloud,
  Eye,
  Hand,
  Headphones,
  Heart,
  HelpCircle,
  MessageSquare,
  Mic,
  Moon,
  Search,
  Send,
  Shield,
  Shuffle,
  Sparkles,
  User,
  VolumeX,
  Zap,
} from 'lucide-react-native';
import Speech from '@mhpdev/react-native-speech';
import InputWithVoice from '@/components/shared/InputWithVoice';
import { api } from '@/api/client';
import { env } from '@/lib/env';
import { useTheme } from '@/lib/ThemeContext';
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
  /** Called whenever the current step index advances so parent screens can
   *  render an accurate phase-1 progress bar. Step is 0-indexed; total = 8. */
  onStepChange?: (step: number) => void;
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


function findResumeStepIndex(
  flow: ConversationStep[],
  data: Record<string, unknown>,
): number {
  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    if (!step) break;
    if (step.type === 'auto') return i;
    if (!questionnaireFieldHasValue(step.field, data)) return i;
  }
  const autoIx = flow.findIndex(s => s.type === 'auto');
  return autoIx >= 0 ? autoIx : flow.length - 1;
}

const ANALYZING_INITIAL: AnalyzingState = {
  show: false,
  progress: 0,
  name: '',
  showingDots: false,
  dotCount: 0,
};


// ── Resume summary helpers (mirrors web buildResumeSummary) ──────────────────

const FIELD_LABELS: Record<string, string> = {
  strengths: 'Strengths',
  hobbies: 'Hobbies',
  thinking_pattern: 'Thinking style',
  communication_style: 'Communication',
  energy_level: 'Energy level',
  social_behaviour: 'Social behaviour',
  emotional_behaviour: 'Emotional nature',
};

function buildResumeSummary(
  flow: ConversationStep[],
  data: Record<string, unknown>,
  upToIdx: number,
): Array<{ label: string; answer: string }> {
  const items: Array<{ label: string; answer: string }> = [];
  for (let i = 0; i < upToIdx; i++) {
    const step = flow[i];
    if (!step || step.type === 'auto') break;
    const val = data[step.field];
    const answer = Array.isArray(val)
      ? val.join(', ')
      : typeof val === 'string'
      ? val
      : typeof val === 'number'
      ? String(val)
      : '';
    if (!answer) continue;
    const label = FIELD_LABELS[step.field] ?? step.field;
    items.push({ label, answer });
  }
  return items;
}

// ── Option icon map (mirrors web OPTION_ICONS) ────────────────────────────────
type LucideRNIcon = React.ComponentType<{ size?: number; color?: string }>;

const OPTION_ICONS: Record<string, LucideRNIcon> = {
  Visual: Eye,
  Analytical: BarChart2,
  Imaginative: Sparkles,
  'Not sure': HelpCircle,
  'Not Sure': HelpCircle,
  Talkative: MessageSquare,
  'Deep Listener': Headphones,
  'Communicates through gestures': Hand,
  Silent: VolumeX,
  Observant: Search,
  'High energy - always active': Zap,
  'Moderate - balanced': Activity,
  'Calm and composed': Heart,
  'Variable - depends on interest': Shuffle,
  Confident: Shield,
  Friendly: Heart,
  Reserved: User,
  Expressive: Mic,
  Withdrawn: User,
  Calm: Moon,
  Sensitive: Heart,
  Impulsive: Zap,
  Moody: Cloud,
};

// ── Phase splash types and data (mirrors web PHASE_SPLASHES) ─────────────────

interface PhaseSplash {
  icon: string;
  title: string;
  subtitle: string;
  displayStep: number;
}

// Splashes shown BEFORE advancing to the given flow index (0-based, after
// removing the name/age/gender/school steps — same indices as web).
const PHASE_SPLASHES: Record<number, PhaseSplash> = {
  2: {
    icon: '🧠',
    title: "Now let's understand how {name} thinks",
    subtitle: 'Two quick taps — pick the one that feels closest.',
    displayStep: 3,
  },
  4: {
    icon: '⚡',
    title: 'Almost there — a few more about their nature ⚡',
    subtitle: 'Energy, social, emotional. One tap each. Promise.',
    displayStep: 5,
  },
};

// ── GradientRoundedBox ────────────────────────────────────────────────────────
// Renders a rounded square with a diagonal SVG LinearGradient background.
// Used for the brain icon container, done step icons, and the loading-dots icon.
// Mirrors web's `bg-gradient-to-br ${class}` utility.
function GradientRoundedBox({
  from,
  size,
  radius,
  children,
}: {
  from: string;
  size: number;
  radius: number;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: from,
      }}
    >
      {children}
    </View>
  );
}

// ── AnimatedOrb ───────────────────────────────────────────────────────────────
// Pulsing blue orb — mirrors web's AnimatedOrb (orb-sphere/orb-swirl/orb-core CSS).
// conic-gradient is unavailable in React Native so we approximate with layered
// circles at different blue tones + reanimated scale/rotation.
function AnimatedOrb() {
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.3);
  const rot1 = useSharedValue(0);
  const rot2 = useSharedValue(0);

  useEffect(() => {
    const cfg = { duration: 2000, easing: Easing.inOut(Easing.ease) };
    pulseScale.value = withRepeat(withTiming(1.15, cfg), -1, true);
    pulseOpacity.value = withRepeat(withTiming(0.6, cfg), -1, true);
    rot1.value = withRepeat(withTiming(360, { duration: 10000, easing: Easing.linear }), -1, false);
    rot2.value = withRepeat(withTiming(-360, { duration: 7000, easing: Easing.linear }), -1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ambientStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));
  const sphereStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot1.value}deg` }],
  }));
  const swirlStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot2.value}deg` }],
  }));

  return (
    <View style={{ width: 128, height: 128, alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer ambient pulse — radial glow approximation */}
      <Animated.View
        style={[
          ambientStyle,
          {
            position: 'absolute',
            width: 160,
            height: 160,
            borderRadius: 80,
            backgroundColor: 'rgba(59,130,246,0.15)',
          },
        ]}
      />
      {/* Main sphere — deep to mid blue */}
      <Animated.View
        style={[
          sphereStyle,
          {
            position: 'absolute',
            width: 100,
            height: 100,
            borderRadius: 50,
            backgroundColor: '#3b82f6',
            shadowColor: '#3b82f6',
            shadowOffset: { width: 0, height: 0 },
            shadowRadius: 20,
            shadowOpacity: 0.7,
            elevation: 10,
          },
        ]}
      />
      {/* Inner swirl — lighter blue */}
      <Animated.View
        style={[
          swirlStyle,
          {
            position: 'absolute',
            width: 66,
            height: 66,
            borderRadius: 33,
            backgroundColor: '#93c5fd',
            opacity: 0.85,
          },
        ]}
      />
      {/* Bright core */}
      <View
        style={{
          position: 'absolute',
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: '#ffffff',
          opacity: 0.9,
        }}
      />
    </View>
  );
}

// ── BouncingDots ──────────────────────────────────────────────────────────────
// Three vertically-bouncing dots with 150 ms stagger — mirrors web's `animate-bounce`.
// `colors` defaults to gray (typing indicator); pass teal for the loading-dots footer.
function BouncingDots({
  colors: dotColors,
}: {
  colors?: [string, string, string];
}) {
  const { colors: themeColors } = useTheme();
  const colors =
    dotColors ??
    ([themeColors.iconColor, themeColors.iconColor, themeColors.iconColor] as [
      string,
      string,
      string,
    ]);
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

  const s1 = useAnimatedStyle(() => ({
    transform: [{ translateY: d1.value }],
  }));
  const s2 = useAnimatedStyle(() => ({
    transform: [{ translateY: d2.value }],
  }));
  const s3 = useAnimatedStyle(() => ({
    transform: [{ translateY: d3.value }],
  }));

  const dot = (color: string) =>
    ({ width: 6, height: 6, borderRadius: 3, backgroundColor: color } as const);

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
  const { colors } = useTheme();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, {
        duration: 450,
        easing: Easing.out(Easing.ease),
      });
      translateY.value = withTiming(0, {
        duration: 450,
        easing: Easing.out(Easing.ease),
      });
    } else {
      opacity.value = withTiming(0, {
        duration: 300,
        easing: Easing.in(Easing.ease),
      });
      translateY.value = withTiming(-6, {
        duration: 300,
        easing: Easing.in(Easing.ease),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={style} className="flex-row justify-start">
      <View
        className="rounded-2xl rounded-tl-sm px-4 py-3"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.muted,
        }}
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
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(role === 'bot' ? 16 : 0);
  const translateX = useSharedValue(role === 'user' ? 40 : 0);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
    ],
  }));

  useEffect(() => {
    if (role === 'bot') {
      opacity.value = withTiming(1, {
        duration: 2000,
        easing: Easing.bezier(0.0, 0.0, 0.6, 1.0),
      });
      translateY.value = withTiming(0, {
        duration: 1600,
        easing: Easing.out(Easing.ease),
      });
    } else {
      opacity.value = withTiming(1, {
        duration: 1600,
        easing: Easing.bezier(0.0, 0.0, 0.6, 1.0),
      });
      translateX.value = withTiming(0, {
        duration: 1400,
        easing: Easing.bezier(0.22, 1.0, 0.36, 1.0),
      });
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
// Now includes a Lucide icon on the left and a check badge when selected —
// matching web's MCQGrid icon + check-circle behaviour.
function AnimatedChoiceChip({
  option,
  index,
  isSelected,
  onPress,
  icon: Icon,
}: {
  option: string;
  index: number;
  isSelected: boolean;
  onPress: () => void;
  icon: LucideRNIcon;
}) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);

  useEffect(() => {
    const delay = index * 120;
    const cfg = { duration: 400, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    scale.value = withDelay(delay, withTiming(1, cfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[animStyle, { width: '100%' }]}>
      <Pressable
        onPress={onPress}
        className="flex-row items-center gap-3 rounded-xl px-4 py-3"
        style={
          isSelected
            ? {
                borderWidth: 1,
                borderColor: 'rgba(59,130,246,0.6)',
                backgroundColor: 'rgba(59,130,246,0.2)',
              }
            : {
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
              }
        }
      >
        <Icon
          size={16}
          color={isSelected ? '#93c5fd' : 'rgba(255,255,255,0.4)'}
        />
        <Text
          className="text-sm font-medium flex-1"
          style={{
            color: isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)',
          }}
        >
          {option}
        </Text>
        {isSelected && (
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: '#3b82f6',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check size={11} color="#ffffff" />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ── PhaseSplashScreen ─────────────────────────────────────────────────────────
// Full-screen interstitial shown between question groups via Modal.
// Mirrors web's PhaseSplashScreen (motion.div fixed inset-0 z-50).
function PhaseSplashScreen({ splash }: { splash: PhaseSplash }) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0);
  const iconScale = useSharedValue(0.5);
  const textY = useSharedValue(14);
  const textOpacity = useSharedValue(0);
  const pulseOpacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    iconScale.value = withDelay(150, withTiming(1, { duration: 500, easing: Easing.out(Easing.ease) }));
    textOpacity.value = withDelay(300, withTiming(1, { duration: 500 }));
    textY.value = withDelay(300, withTiming(0, { duration: 500, easing: Easing.out(Easing.ease) }));
    pulseOpacity.value = withDelay(600, withRepeat(withTiming(1, { duration: 600 }), -1, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulseOpacity.value }));

  return (
    <Animated.View
      style={[
        {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          paddingHorizontal: 32,
          backgroundColor: colors.background,
        },
        containerStyle,
      ]}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: 3,
          color: colors.textMuted,
          opacity: 0.5,
          textAlign: 'center',
        }}
      >
        Getting to Know — Step {splash.displayStep} / 8
      </Text>

      <Animated.View style={iconStyle}>
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primarySubtle,
            borderWidth: 4,
            borderColor: colors.primaryBorder,
          }}
        >
          <EmojiText size="3xl">{splash.icon}</EmojiText>
        </View>
      </Animated.View>

      <Animated.View
        style={[textStyle, { alignItems: 'center', gap: 12, maxWidth: 300 }]}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: '700',
            textAlign: 'center',
            color: colors.text,
          }}
        >
          {splash.title}
        </Text>
        <Text
          style={{
            fontSize: 14,
            textAlign: 'center',
            color: colors.textMuted,
          }}
        >
          {splash.subtitle}
        </Text>
      </Animated.View>

      <Animated.View style={pulseStyle}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: 3,
            color: colors.primary,
          }}
        >
          One moment…
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

// ── IvyIntroScreen ────────────────────────────────────────────────────────────
// Full-screen Ivy portrait — mirrors web's IvyIntroScreen exactly.
// Image is served from the same CDN path as the web's /app-assets/avatars/ivy-intro.jpg.
function IvyIntroScreen() {
  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(10);

  useEffect(() => {
    textOpacity.value = withDelay(
      300,
      withTiming(1, { duration: 600, easing: Easing.out(Easing.ease) }),
    );
    textY.value = withDelay(
      300,
      withTiming(0, { duration: 600, easing: Easing.out(Easing.ease) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Full-screen portrait — mirrors web's <img object-cover object-top> */}
      <Image
        source={{ uri: `${env.CDN_BASE_URL}/app-assets/avatars/ivy-intro.jpg` }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        resizeMode="cover"
      />
      {/* Dark veil — approximates web's onboarding-intro-veil gradient */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '50%',
          backgroundColor: 'rgba(0,0,0,0.55)',
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '25%',
          backgroundColor: 'rgba(0,0,0,0.45)',
        }}
      />
      {/* Greeting text — mirrors web's absolute bottom-16 white text */}
      <Animated.View
        style={[
          textStyle,
          {
            position: 'absolute',
            bottom: 64,
            left: 0,
            right: 0,
            paddingHorizontal: 32,
          },
        ]}
      >
        <Text
          style={{
            fontSize: 20,
            fontWeight: '700',
            textAlign: 'center',
            lineHeight: 28,
            color: '#ffffff',
          }}
        >
          Hi, I am Ivy. Let's transform your child to their superpower
          personality.
        </Text>
      </Animated.View>
    </View>
  );
}

// ── AnalyzingScreen ───────────────────────────────────────────────────────────
// Matches web's analyzing overlay: pulsing emoji box, title, thin progress bar,
// "One moment…" label.
function AnalyzingScreen({
  analyzingName,
  analyzeProgress,
}: {
  analyzingName: string;
  analyzeProgress: number;
}) {
  const { colors } = useTheme();

  // Pulsing scale — matches web's scale: [1, 1.06, 1] / duration: 2s / repeat Infinity
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.06, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  // Animated progress bar width
  const progressWidth = useSharedValue(0);
  useEffect(() => {
    progressWidth.value = withTiming(analyzeProgress, { duration: 100 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeProgress]);
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingVertical: 64,
        gap: 24,
      }}
    >
      {/* Pulsing emoji box — web: motion.div scale [1,1.06,1] / 2s / Infinity */}
      <Animated.View
        style={[
          pulseStyle,
          {
            width: 80,
            height: 80,
            borderRadius: 16,
            backgroundColor: colors.primaryMuted,
            borderWidth: 4,
            borderColor: colors.personalityAlt + '33',
            alignItems: 'center',
            justifyContent: 'center',
          },
        ]}
      >
        <Text style={{ fontSize: 36 }}>🎉</Text>
      </Animated.View>

      {/* Title + subtitle */}
      <View style={{ gap: 6, alignItems: 'center' }}>
        <Text
          style={{
            color: 'rgba(255,255,255,0.9)',
            fontSize: 22,
            fontWeight: '700',
            textAlign: 'center',
            lineHeight: 30,
          }}
        >
          {'Perfect! Let\'s do '}
          <Text style={{ color: colors.primary }}>
            {analyzingName || 'your child'}
          </Text>
          {"'s personality analysis ✨"}
        </Text>
        <Text
          style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          Getting things ready — almost there.
        </Text>
      </View>

      {/* Progress bar + percentage */}
      <View style={{ width: '100%', maxWidth: 280, gap: 6 }}>
        <View
          style={{
            height: 6,
            borderRadius: 999,
            backgroundColor: colors.muted,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={[
              progressStyle,
              { height: '100%', borderRadius: 999, backgroundColor: colors.primary },
            ]}
          />
        </View>
        <Text
          style={{
            textAlign: 'right',
            fontSize: 11,
            color: 'rgba(255,255,255,0.35)',
          }}
        >
          {analyzeProgress}%
        </Text>
      </View>

      {/* "One moment…" pulsing label */}
      <Text
        style={{
          color: colors.primary,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 3.5,
          textTransform: 'uppercase',
        }}
      >
        One moment…
      </Text>
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
  onStepChange,
}: ConversationalOnboardingProps) {
  const { colors } = useTheme();
  const [showIntro, setShowIntro] = useState(true);
  const showIntroRef = useRef(true);
  const [phaseSplash, setPhaseSplash] = useState<PhaseSplash | null>(null);
  const splashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [collectedData, setCollectedData] = useState<Record<string, unknown>>(
    {},
  );
  const [isTyping, setIsTyping] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [analyzingState, setAnalyzingState] =
    useState<AnalyzingState>(ANALYZING_INITIAL);
  const {
    show: showAnalyzing,
    progress: analyzeProgress,
    name: analyzingName,
    showingDots: showingLoadingDots,
    dotCount,
  } = analyzingState;
  const [allAnswered, setAllAnswered] = useState(false);
  const [resumeSummary, setResumeSummary] = useState<
    Array<{ label: string; answer: string }> | null
  >(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const summaryInitializedRef = useRef(false);

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

  const activeChildIdRef = useRef(activeChildId);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  const isScrollingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatSessionStartedRef = useRef(false);
  const allowEmptySessionRecoveryRef = useRef(false);
  const userTurnCountRef = useRef(0);
  const collectedDataRef = useRef<Record<string, unknown>>({});
  const msgIdCounterRef = useRef(0);
  const newMsgId = useCallback(
    () => `${Date.now()}-${++msgIdCounterRef.current}`,
    [],
  );

  useEffect(() => {
    collectedDataRef.current = collectedData;
  }, [collectedData]);

  useEffect(() => {
    activeChildIdRef.current = activeChildId;
  }, [activeChildId]);

  // Flush any unsaved answer when the component unmounts (mirrors web).
  useEffect(
    () => () => {
      if (persistTimerRef.current === null) return;
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
      const childId = activeChildIdRef.current;
      const data = collectedDataRef.current;
      if (childId && Object.keys(data).length > 0) {
        void api.entities.Child.update(childId, data).catch(() => {});
      }
    },
    [],
  );

  // Cleanup splash timer on unmount.
  useEffect(
    () => () => {
      if (splashTimerRef.current !== null) clearTimeout(splashTimerRef.current);
    },
    [],
  );

  // Notify parent so it can show accurate phase-1 progress (mirrors web's
  // dynamic progressPct = displayStep / TOTAL_CHAT_STEPS * 100).
  useEffect(() => {
    onStepChange?.(currentStep);
  }, [currentStep, onStepChange]);

  const persistQuestionnaireDraft = useCallback(
    (mergedCollected: Record<string, unknown>) => {
      onQuestionnairePersisted?.(mergedCollected);
      if (persistTimerRef.current !== null)
        clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        void (async () => {
          if (!activeChildId) return;
          try {
            await api.entities.Child.update(activeChildId, mergedCollected);
          } catch (err) {
            console.warn(
              '[ConversationalOnboarding] Auto-persist child data failed:',
              err,
            );
          }
        })();
      }, 500);
    },
    [onQuestionnairePersisted, activeChildId],
  );

  const parentName = user?.full_name?.split(' ')[0] ?? 'there';

  // Derive the latest bot message for the ambient heading (mirrors web's latestBotContent).
  const latestBotContent = useMemo(() => {
    if (messages.length === 0) return null;
    const last = messages[messages.length - 1];
    return last?.role === 'bot' ? last.content : null;
  }, [messages]);

  const conversationFlow = useMemo<ConversationStep[]>(
    () => [
      // name/age/gender/school are collected by ChildProfileStep before this
      // screen opens — skip them here to match the web flow exactly.
      {
        id: 'ready_check',
        message: data => {
          const name =
            typeof data.name === 'string' && data.name
              ? data.name
              : 'your child';
          return `Hey ${parentName}! Let's now explore what makes ${name} unique.\nMention the top 3 strengths that ${name} has from your perspective.`;
        },
        field: 'strengths',
        type: 'multi_text',
        placeholder: 'e.g., Intelligent, Energetic, Well-mannered',
        hint: 'Separate each with a comma',
        phase: 1,
      },
      {
        id: 'strengths_response',
        message: data =>
          `Happy to know that! You are a lucky parent 😊.\n\nMention the top 3 hobbies where ${
            typeof data.name === 'string' ? data.name : ''
          } spends their time.`,
        field: 'hobbies',
        type: 'multi_text',
        placeholder: 'e.g., Cricket, Drawing, Reading',
        phase: 1,
      },
      {
        id: 'thinking_pattern',
        message: data =>
          `Choose the kind of thinking pattern that ${
            typeof data.name === 'string' ? data.name : ''
          } predominantly has:`,
        field: 'thinking_pattern',
        type: 'choice',
        options: ['Visual', 'Analytical', 'Imaginative', 'Not sure'],
        phase: 1,
      },
      {
        id: 'communication_style',
        message: data =>
          `Choose the kind of communication style that ${
            typeof data.name === 'string' ? data.name : ''
          } predominantly has:`,
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
        message: data =>
          `How would you describe ${
            typeof data.name === 'string' ? data.name : ''
          }'s energy level?`,
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
        message: data =>
          `How does ${
            typeof data.name === 'string' ? data.name : ''
          } behave in social situations?`,
        field: 'social_behaviour',
        type: 'choice',
        options: [
          'Confident',
          'Friendly',
          'Reserved',
          'Expressive',
          'Withdrawn',
        ],
        phase: 1,
      },
      {
        id: 'emotional_behaviour',
        message: data =>
          `What kind of a child ${
            typeof data.name === 'string' ? data.name : ''
          } emotionally is?`,
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
    const startY = scrollYRef.current;
    const initialEnd = Math.max(
      0,
      contentHeightRef.current - containerHeightRef.current,
    );
    if (initialEnd <= startY + 2) return;

    isScrollingRef.current = true;
    const duration = 2500;
    let startTime = -1;
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const step = (now: number) => {
      if (startTime < 0) startTime = now;
      const liveEnd = Math.max(
        0,
        contentHeightRef.current - containerHeightRef.current,
      );
      const targetEnd = Math.max(initialEnd, liveEnd);
      const progress = Math.min((now - startTime) / duration, 1);
      el.scrollTo({
        x: 0,
        y: startY + (targetEnd - startY) * easeInOutCubic(progress),
        animated: false,
      });
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        isScrollingRef.current = false;
      }
    };
    requestAnimationFrame(step);
  }, []);

  // Configure TTS on mount and stop any ongoing speech on unmount.
  useEffect(() => {
    Speech.configure({ language: 'en-US', rate: 1.0, pitch: 1.0 });
    return () => {
      Speech.stop();
    };
  }, []);

  // Ivy intro: speak the greeting then auto-dismiss when the utterance finishes.
  // Fallback timer (10 s) dismisses it if TTS never fires.
  useEffect(() => {
    const IVY_MSG =
      "Hi, I am Ivy. Let's transform your child to their superpower personality.";
    let subs: { remove(): void }[] = [];

    const dismiss = () => {
      showIntroRef.current = false;
      setShowIntro(false);
      subs.forEach(s => s.remove());
      subs = [];
    };

    const fallback = setTimeout(dismiss, 10000);

    void Speech.speak(IVY_MSG)
      .then(id => {
        const finishSub = Speech.onFinish(({ id: eventId }) => {
          if (eventId === id) {
            clearTimeout(fallback);
            dismiss();
          }
        });
        const errorSub = Speech.onError(({ id: eventId }) => {
          if (eventId === id) {
            clearTimeout(fallback);
            setTimeout(dismiss, 2500);
          }
        });
        subs = [finishSub, errorSub];
      })
      .catch(() => {
        clearTimeout(fallback);
        setTimeout(dismiss, 2500);
      });

    return () => {
      clearTimeout(fallback);
      subs.forEach(s => s.remove());
      void Speech.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceEnabledRef.current) return;
    // Don't cancel the Ivy intro while it is still speaking — let it finish.
    if (showIntroRef.current) return;
    // Strip all emoji (Unicode Extended_Pictographic) and collapse whitespace/newlines.
    const cleanText = text
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanText) return;
    Speech.stop(); // cancel any currently playing speech before starting new
    Speech.speak(cleanText);
  }, []);

  const addBotMessage = useCallback(
    (text: string) => {
      setIsTyping(true);
      if (botMsgTimerRef.current !== null) clearTimeout(botMsgTimerRef.current);
      botMsgTimerRef.current = setTimeout(() => {
        setMessages(prev => [
          ...prev,
          { id: newMsgId(), role: 'bot', content: text },
        ]);
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
          activeChildId
            ? api.entities.Child.get(activeChildId)
            : Promise.resolve(null),
          api.preferences.get().catch(() => null),
        ]);

        if (prefs && typeof prefs.tts_enabled === 'boolean') {
          voiceEnabledRef.current = prefs.tts_enabled;
          setVoiceEnabled(prefs.tts_enabled);
        }

        slim = child
          ? pickSavedQuestionnaireForChatbot(
              normalizeOnboardingChildDataBlob(child) ?? {},
            )
          : {};

        if (cancelled) return;

        const hasSaved = Object.keys(slim).length > 0;

        if (chatSessionStartedRef.current) {
          const canRecover =
            allowEmptySessionRecoveryRef.current &&
            hasSaved &&
            userTurnCountRef.current === 0;
          if (!canRecover) return;
          chatSessionStartedRef.current = false;
          allowEmptySessionRecoveryRef.current = false;
        }

        chatSessionStartedRef.current = true;
        allowEmptySessionRecoveryRef.current = !hasSaved;

        const autoIx = conversationFlow.findIndex(s => s.type === 'auto');
        const answered =
          autoIx >= 0 &&
          CHATBOT_CAPTURED_FIELDS.every(f =>
            questionnaireFieldHasValue(f, slim),
          );

        if (hasSaved && answered && autoIx >= 0) {
          summaryInitializedRef.current = true;
          setResumeSummary(buildResumeSummary(conversationFlow, slim, autoIx));
          setCollectedData({ ...slim });
          setMessages([]);
          setCurrentStep(autoIx);
          setWaitingForResponse(false);
          setAnalyzingState(ANALYZING_INITIAL);
          setAllAnswered(true);
          return;
        }

        if (!hasSaved) {
          const firstStep = conversationFlow[0];
          const firstMessage = firstStep
            ? typeof firstStep.message === 'function'
              ? firstStep.message({})
              : firstStep.message
            : '';
          addBotMessage(firstMessage);
          return;
        }

        const resumeIdx = findResumeStepIndex(conversationFlow, slim);
        if (resumeIdx > 0) {
          summaryInitializedRef.current = true;
          setResumeSummary(buildResumeSummary(conversationFlow, slim, resumeIdx));
        }
        setCollectedData({ ...slim });
        setMessages([]);
        setCurrentStep(resumeIdx);

        const stepAt = conversationFlow[resumeIdx];
        if (!stepAt) return;
        if (stepAt.type === 'auto') {
          setWaitingForResponse(false);
          setAnalyzingState(ANALYZING_INITIAL);
          setAllAnswered(true);
          return;
        }

        const accR = buildAccThrough(conversationFlow, slim, resumeIdx);
        const nextBot =
          typeof stepAt.message === 'function'
            ? stepAt.message(accR)
            : stepAt.message;
        addBotMessage(nextBot);
      } catch (err) {
        console.warn(
          '[ConversationalOnboarding] Resume hydration failed:',
          err,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    resumeHydrationReady,
    conversationFlow,
    addBotMessage,
    newMsgId,
    activeChildId,
  ]);

  // Slow-scroll to bottom whenever messages arrive or typing state changes.
  useEffect(() => {
    const t = setTimeout(() => slowScrollToEnd(), 0);
    return () => clearTimeout(t);
  }, [messages, isTyping, slowScrollToEnd]);

  // Pre-fill text/multi answers from persisted data when landing on a question.
  useEffect(() => {
    if (!waitingForResponse || allAnswered) return;
    const stepData = conversationFlow[currentStep];
    if (
      !stepData?.field ||
      stepData.type === 'choice' ||
      stepData.type === 'auto'
    ) {
      setCurrentInput('');
      return;
    }
    const raw = collectedData[stepData.field];
    if (raw === undefined || raw === null) {
      setCurrentInput('');
      return;
    }
    const text = Array.isArray(raw)
      ? raw.join(', ')
      : typeof raw === 'string'
      ? raw
      : typeof raw === 'number' || typeof raw === 'boolean'
      ? String(raw)
      : '';
    setCurrentInput(text);
  }, [
    waitingForResponse,
    currentStep,
    collectedData,
    conversationFlow,
    allAnswered,
  ]);

  // Idle reminder — fires after 30s of no input when waiting for a response.
  useEffect(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    if (
      !waitingForResponse ||
      showAnalyzing ||
      showingLoadingDots ||
      allAnswered
    )
      return;

    idleTimerRef.current = setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: newMsgId(),
          role: 'bot',
          content:
            "Just checking in 😊 — whenever you're ready, go ahead and share your answer!",
        },
      ]);
    }, 30000);

    return () => {
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    };
  }, [
    waitingForResponse,
    currentStep,
    showAnalyzing,
    showingLoadingDots,
    allAnswered,
    newMsgId,
  ]);

  // Keep previously-answered summary in sync as the user progresses (mirrors web).
  useEffect(() => {
    if (!summaryInitializedRef.current) return;
    setResumeSummary(buildResumeSummary(conversationFlow, collectedData, currentStep));
  }, [collectedData, currentStep, conversationFlow]);

  const processResponse = useCallback(
    (response: string) => {
      const step = conversationFlow[currentStep];

      setMessages(prev => [
        ...prev,
        { id: newMsgId(), role: 'user', content: response },
      ]);
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
          value = response
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        }
        nextCollected = { ...collectedData, [step.field]: value };
        setCollectedData(nextCollected);
        persistQuestionnaireDraft(nextCollected);
      }

      if (step?.id === 'complete') {
        const finalData = nextCollected;
        setAnalyzingState({
          show: true,
          progress: 0,
          name:
            typeof finalData.name === 'string' ? finalData.name : 'your child',
          showingDots: false,
          dotCount: 0,
        });
        let progress = 0;
        const interval = setInterval(() => {
          progress += 1;
          setAnalyzingState(s => ({ ...s, progress }));
          if (progress >= 100) {
            clearInterval(interval);
            Promise.resolve(onComplete(finalData)).catch(() => {});
          }
        }, 28);
        return;
      }

      const nextStep = currentStep + 1;
      if (nextStep < conversationFlow.length) {
        // Check if we need to show a phase splash before advancing (mirrors web).
        const splash = PHASE_SPLASHES[nextStep];
        if (splash) {
          const childName =
            typeof nextCollected.name === 'string'
              ? nextCollected.name
              : 'your child';
          const resolvedTitle = splash.title.replace('{name}', childName);
          setPhaseSplash({ ...splash, title: resolvedTitle });
          splashTimerRef.current = setTimeout(() => {
            setPhaseSplash(null);
            setCurrentStep(nextStep);
            const nextStepData = conversationFlow[nextStep];
            const nextMessage = nextStepData
              ? typeof nextStepData.message === 'function'
                ? nextStepData.message(nextCollected)
                : nextStepData.message
              : '';
            setTimeout(() => addBotMessage(nextMessage), 400);
          }, 2400);
        } else {
          setCurrentStep(nextStep);
          const nextStepData = conversationFlow[nextStep];
          const nextMessage = nextStepData
            ? typeof nextStepData.message === 'function'
              ? nextStepData.message(nextCollected)
              : nextStepData.message
            : '';
          setTimeout(() => addBotMessage(nextMessage), 700);
          if (nextStepData?.type === 'final') {
            setTimeout(() => {
              void onComplete(nextCollected);
            }, 2000);
          }
        }
      }
    },
    [
      conversationFlow,
      currentStep,
      collectedData,
      addBotMessage,
      persistQuestionnaireDraft,
      onComplete,
      newMsgId,
    ],
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
    if (!next) Speech.stop(); // cancel ongoing speech immediately when toggling off
    try {
      await api.preferences.patch({ tts_enabled: next });
    } catch (err) {
      console.warn(
        '[ConversationalOnboarding] Could not persist TTS preference:',
        err,
      );
    }
  }, []);

  const handleReset = useCallback(() => {
    chatSessionStartedRef.current = false;
    allowEmptySessionRecoveryRef.current = false;
    userTurnCountRef.current = 0;
    summaryInitializedRef.current = false;
    setMessages([]);
    setCurrentStep(0);
    setCollectedData({});
    setCurrentInput('');
    setIsTyping(false);
    setWaitingForResponse(false);
    setAnalyzingState(ANALYZING_INITIAL);
    setAllAnswered(false);
    setResumeSummary(null);
    void (async () => {
      try {
        if (activeChildId) {
          const cleared: Record<string, null> = {};
          for (const k of CHATBOT_CAPTURED_FIELDS) cleared[k] = null;
          await api.entities.Child.update(activeChildId, cleared);
        }
        onQuestionnaireCleared?.();
      } catch (err) {
        console.warn(
          '[ConversationalOnboarding] Questionnaire clear failed:',
          err,
        );
      }
    })();
    setTimeout(() => {
      const firstStep = conversationFlow[0];
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
    if (!waitingForResponse || currentStepData?.type !== 'auto' || allAnswered)
      return;
    setAnalyzingState(s => ({ ...s, showingDots: true, dotCount: 0 }));

    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let count = 0;
    const dotInterval = setInterval(() => {
      count += 1;
      setAnalyzingState(s => ({ ...s, dotCount: count }));
      if (count >= 12) {
        clearInterval(dotInterval);
        const finalData = { ...collectedDataRef.current };
        setAnalyzingState({
          show: true,
          progress: 0,
          name:
            typeof finalData.name === 'string' ? finalData.name : 'your child',
          showingDots: false,
          dotCount: 0,
        });
        let progress = 0;
        progressInterval = setInterval(() => {
          progress += 1;
          setAnalyzingState(s => ({ ...s, progress }));
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
  }, [
    waitingForResponse,
    currentStep,
    currentStepData?.type,
    allAnswered,
    onComplete,
  ]);

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
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={150}
    >
      {/* ── Scrollable top: orb + greeting + message + summary ──────────── */}
      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        onScroll={e => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
        onLayout={e => {
          containerHeightRef.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_, h) => {
          contentHeightRef.current = h;
        }}
      >
        {/* Orb + greeting + current question */}
        <View
          style={{
            alignItems: 'center',
            paddingHorizontal: 24,
            paddingTop: 28,
            paddingBottom: 20,
          }}
        >
          <AnimatedOrb />
          <Text
            style={{
              marginTop: 20,
              fontSize: 14,
              fontWeight: '500',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            Hello {parentName}!
          </Text>
          {showingTyping ? (
            <View style={{ marginTop: 16 }}>
              <BouncingDots
                colors={[
                  'rgba(147,197,253,0.5)',
                  'rgba(147,197,253,0.5)',
                  'rgba(147,197,253,0.5)',
                ]}
              />
            </View>
          ) : (
            <Text
              style={{
                marginTop: 12,
                fontSize: 20,
                fontWeight: '600',
                textAlign: 'center',
                color: 'rgba(255,255,255,0.9)',
                lineHeight: 28,
                maxWidth: 320,
              }}
            >
              {latestBotContent ?? 'How can I help you today?'}
            </Text>
          )}
        </View>

        {/* Previously answered summary — collapsible (mirrors web <details>) */}
        {resumeSummary && resumeSummary.length > 0 && (
          <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
            <Pressable
              onPress={() => setSummaryExpanded(s => !s)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 12,
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: 'rgba(16,183,127,0.15)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Check size={10} color="#10b77f" />
                </View>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: 'rgba(255,255,255,0.5)',
                  }}
                >
                  Previously answered · {resumeSummary.length} of 7
                </Text>
              </View>
              <View style={{ transform: [{ rotate: summaryExpanded ? '180deg' : '0deg' }] }}>
                <ChevronDown size={14} color="rgba(255,255,255,0.3)" />
              </View>
            </Pressable>
            {summaryExpanded && (
              <View
                style={{
                  paddingHorizontal: 12,
                  paddingTop: 8,
                  paddingBottom: 4,
                  gap: 6,
                }}
              >
                {resumeSummary.map(item => (
                  <View
                    key={item.label}
                    style={{ flexDirection: 'row', gap: 8 }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '500',
                        color: 'rgba(255,255,255,0.4)',
                        width: 112,
                        flexShrink: 0,
                      }}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: 'rgba(255,255,255,0.7)',
                        flex: 1,
                      }}
                    >
                      {item.answer}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Loading dots (personality analysis transition) ─────────────── */}
      {showingLoadingDots && !allAnswered && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingBottom: 16,
            paddingTop: 8,
          }}
        >
          <View
            style={{
              borderWidth: 1,
              borderColor: 'rgba(59,130,246,0.15)',
              backgroundColor: 'rgba(59,130,246,0.07)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <View className="flex-row items-start gap-3">
              <GradientRoundedBox from="#0b62ef" size={36} radius={10}>
                <Sparkles size={16} color="#ffffff" />
              </GradientRoundedBox>
              <View className="flex-1 pt-0.5">
                <Text
                  className="text-sm font-semibold leading-snug"
                  style={{ color: 'rgba(255,255,255,0.9)' }}
                >
                  Let's do a personality analysis
                  {'.'.repeat(1 + (dotCount % 3))}
                </Text>
                <Text
                  className="mt-1.5 text-xs"
                  style={{ color: 'rgba(147,197,253,0.8)' }}
                >
                  Getting things ready — almost there
                </Text>
                <View className="mt-3">
                  <BouncingDots
                    colors={['#93c5fd', '#3b82f6', '#1d4ed8']}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ── Choice buttons ─────────────────────────────────────────────── */}
      {waitingForResponse &&
        !allAnswered &&
        currentStepData?.type === 'choice' && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8, gap: 10 }}>
            {(currentStepData.options ?? []).map((option, index) => {
              const chosen = collectedData[currentStepData.field];
              const isSelected = chosen === option;
              const OptionIcon = OPTION_ICONS[option] ?? HelpCircle;
              return (
                <AnimatedChoiceChip
                  key={`${currentStep}-${option}`}
                  option={option}
                  index={index}
                  isSelected={isSelected}
                  onPress={() => handleChoiceSelect(option)}
                  icon={OptionIcon}
                />
              );
            })}
          </View>
        )}

      {/* ── Text / multi-text input — pill style matching web ──────────── */}
      {waitingForResponse &&
        !allAnswered &&
        (currentStepData?.type === 'text' ||
          currentStepData?.type === 'multi_text') && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}>
            {currentStepData.hint && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Sparkles size={12} color="rgba(147,197,253,0.6)" />
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  {currentStepData.hint}
                </Text>
              </View>
            )}
            {/* Pill input container — mirrors web's onboarding-input-pill */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderWidth: 1,
                borderColor: 'rgba(59,130,246,0.2)',
                borderRadius: 999,
                paddingHorizontal: 20,
                paddingVertical: 6,
              }}
            >
              <InputWithVoice
                value={currentInput}
                onChange={e => setCurrentInput(e.target.value)}
                placeholder={currentStepData.placeholder ?? 'Type your response…'}
                style={{
                  color: 'rgba(255,255,255,0.9)',
                  backgroundColor: 'transparent',
                  borderWidth: 0,
                  height: 36,
                }}
                placeholderTextColor="rgba(255,255,255,0.3)"
                onSubmitEditing={handleSubmit}
                returnKeyType="send"
              />
              <Pressable
                onPress={handleSubmit}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#0b62ef',
                  flexShrink: 0,
                }}
              >
                <Send size={14} color="#ffffff" />
              </Pressable>
            </View>
          </View>
        )}

      {/* ── Continue button (all answered) ─────────────────────────────── */}
      {allAnswered && typeof onContinueToPersonality === 'function' && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}>
          <Pressable
            onPress={() => onContinueToPersonality()}
            style={({ pressed }) => ({
              height: 48,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? '#0f3ea3' : '#0b62ef',
            })}
          >
            <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '500' }}>
              Continue to personality analysis
            </Text>
          </Pressable>
        </View>
      )}

      {/* ── Ivy intro — full-screen Modal, auto-dismissed on TTS end ─── */}
      <Modal visible={showIntro} animationType="fade" transparent={false}>
        <IvyIntroScreen />
      </Modal>

      {/* ── Phase splash — full-screen interstitial between question groups ── */}
      <Modal visible={!!phaseSplash} animationType="fade" transparent={false}>
        {phaseSplash && <PhaseSplashScreen splash={phaseSplash} />}
      </Modal>
    </KeyboardAvoidingView>
  );
}
