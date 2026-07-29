import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GradientIconBox } from '@/components/shared/GradientView';
import {
  View,
  Text,
  ScrollView,
  Image,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import {
  Sparkles,
  Star,
  Clock,
  Pencil,
  Info,
  Eye,
  Smile,
  Users,
  Heart,
  MessageCircle,
  Compass,
  WandSparkles,
  Plus,
  Brain,
  Check,
} from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { personalityTypes } from '@/lib/personalityLogic';
import type { RootStackParamList } from '@/navigation';

type PersonalityJourneyNavProp = StackNavigationProp<RootStackParamList>;
type PersonalityJourneyRouteProp = RouteProp<
  { PersonalityJourney: { childId?: string } | undefined },
  'PersonalityJourney'
>;

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;
type LucideIcon = typeof Sparkles;

// ── Constants ──────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 8;

const STRENGTH_ICONS: LucideIcon[] = [Info, Eye, Smile, Users, Heart, Sparkles];

// ── Phase bar (numbered stepper — mirrors web OnboardingProgressHeader) ────────

const PHASES = [
  { num: 1, label: 'Getting to Know', done: true, active: false },
  { num: 2, label: 'Personality Analysis', done: true, active: false },
  { num: 3, label: 'Your Journey', done: false, active: true },
];

function PhaseBar() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        {PHASES.map((phase, i, arr) => {
          const isLast = i === arr.length - 1;
          return (
            <View
              key={phase.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                ...(isLast
                  ? { flexGrow: 0, flexShrink: 0 }
                  : { flex: phase.active ? 2 : 1 }),
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  ...(phase.done
                    ? { backgroundColor: colors.success }
                    : phase.active
                    ? { backgroundColor: colors.primary }
                    : {
                        backgroundColor: colors.surfaceElevated,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }),
                }}
              >
                {phase.done ? (
                  <Check size={13} color="#fff" />
                ) : (
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: phase.active ? colors.primaryForeground : colors.textMuted,
                      opacity: phase.active ? 1 : 0.4,
                    }}
                  >
                    {phase.num}
                  </Text>
                )}
              </View>
              {phase.active && (
                <Text
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    fontWeight: '500',
                    color: colors.text,
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {phase.label}
                </Text>
              )}
              {!isLast && (
                <View
                  style={{
                    flex: 1,
                    height: 2,
                    marginHorizontal: 12,
                    minWidth: 24,
                    borderRadius: 1,
                    backgroundColor: colors.border,
                    overflow: 'hidden',
                  }}
                >
                  {phase.done && (
                    <View
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundColor: colors.success,
                      }}
                    />
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Animated step wrapper ─────────────────────────────────────────────────────

function StepWrapper({
  children,
  stepKey,
  direction,
}: {
  children: React.ReactNode;
  stepKey: number;
  direction: 1 | -1;
}) {
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(direction * 40);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.ease) });
    translateX.value = withTiming(0, { duration: 420, easing: Easing.out(Easing.ease) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

// ── Step 1: TheRevealScreen ───────────────────────────────────────────────────

const DOT_CONFIGS = [
  { top: '8%', left: '10%', color: null, size: 8, delay: 200, usePersonality: false },
  { top: '15%', left: '80%', color: null, size: 10, delay: 400, usePersonality: true },
  { top: '40%', left: '5%', color: null, size: 6, delay: 300, useWarning: true },
  { top: '60%', left: '90%', color: null, size: 8, delay: 500, usePersonality: false },
  { top: '75%', left: '15%', color: null, size: 6, delay: 350, useAccentPink: true },
  { top: '80%', left: '75%', color: null, size: 8, delay: 250, usePersonality: true },
  { top: '25%', left: '92%', color: null, size: 6, delay: 450, useWarning: true },
  { top: '55%', left: '3%', color: null, size: 6, delay: 600, usePersonality: false },
] as const;

function FloatingDot({
  cfg,
  dotColor,
}: {
  cfg: (typeof DOT_CONFIGS)[number];
  dotColor: string;
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      opacity.value = withTiming(1, { duration: 400 });
      scale.value = withSpring(1, { stiffness: 200 });
    }, cfg.delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      style={[
        style,
        {
          position: 'absolute',
          top: cfg.top,
          left: cfg.left,
          width: cfg.size,
          height: cfg.size,
          borderRadius: cfg.size / 2,
          backgroundColor: dotColor,
        },
      ]}
    />
  );
}

function TheRevealScreen({
  childName,
  onNext,
}: {
  childName: string;
  onNext: () => void;
}) {
  const { colors } = useTheme();

  const iconScale = useSharedValue(0.3);
  const iconOpacity = useSharedValue(0);
  useEffect(() => {
    iconScale.value = withSpring(1, { stiffness: 60, damping: 10 });
    iconOpacity.value = withTiming(1, { duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));

  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(20);
  useEffect(() => {
    const t = setTimeout(() => {
      textOpacity.value = withTiming(1, { duration: 650 });
      textY.value = withTiming(0, { duration: 650, easing: Easing.out(Easing.ease) });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));

  const btnOpacity = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      btnOpacity.value = withTiming(1, { duration: 500 });
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const btnStyle = useAnimatedStyle(() => ({ opacity: btnOpacity.value }));

  const dotColors = [
    colors.primary,
    colors.personalityAlt,
    colors.warning,
    colors.primary,
    colors.personalityAlt,
    colors.personalityAlt,
    colors.warning,
    colors.primary,
  ];

  return (
    <View
      style={{
        minHeight: 420,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        paddingVertical: 32,
        position: 'relative',
      }}
    >
      {DOT_CONFIGS.map((cfg, i) => (
        <FloatingDot key={i} cfg={cfg} dotColor={dotColors[i]!} />
      ))}

      {/* Web: h-28 w-28 rounded-3xl bg-gradient-to-br from-primary/30 to-personality/30
              ring-4 ring-primary/20 glow-teal-lg */}
      <Animated.View
        style={[
          iconStyle,
          {
            borderRadius: 28,
            borderWidth: 4,
            borderColor: colors.primary + '33',
            shadowColor: colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 24,
            elevation: 8,
          },
        ]}
      >
        <GradientIconBox
          from={colors.primary + '4D'}
          to={colors.personalityAlt + '4D'}
          size={112}
          radius={24}
          diagonal
        >
          <Sparkles size={56} color={colors.primary} />
        </GradientIconBox>
      </Animated.View>

      <Text
        style={{
          color: colors.primary,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 4,
          textTransform: 'uppercase',
        }}
      >
        THE REVEAL
      </Text>

      <Animated.View style={[textStyle, { alignItems: 'center', gap: 8 }]}>
        <Text
          style={{
            color: colors.text,
            fontSize: 28,
            fontWeight: '800',
            textAlign: 'center',
            lineHeight: 36,
          }}
        >
          Your Personalized Journey
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>
          Here's what we've discovered about{' '}
          <Text style={{ fontWeight: '600', color: colors.text }}>{childName}</Text>{' '}
          ✨
        </Text>
      </Animated.View>

      <Animated.View style={btnStyle}>
        <Button onPress={onNext} className="rounded-full px-8">
          <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 16 }}>
            Show me →
          </Text>
        </Button>
      </Animated.View>
    </View>
  );
}

// ── Step 2: PersonalityCardScreen ─────────────────────────────────────────────

function traitIcon(trait: string, size: number, color: string) {
  const t = trait.toLowerCase();
  if (/calm|steady|quiet|peace/.test(t)) return <Heart size={size} color={color} />;
  if (/friend|social|connect|warm|kind/.test(t)) return <Users size={size} color={color} />;
  if (/visual|see|look|observ/.test(t)) return <Eye size={size} color={color} />;
  if (/talk|voice|speak|express|verbal/.test(t)) return <MessageCircle size={size} color={color} />;
  return <Sparkles size={size} color={color} />;
}

function FamousPersonCircle({
  name,
  image,
  index,
}: {
  name: string;
  image?: string;
  index: number;
}) {
  const { colors } = useTheme();
  const [imgFailed, setImgFailed] = useState(false);
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
  const bgColors = [colors.primarySubtle, colors.successSubtle, colors.primaryMuted];
  const textColors = [colors.primary, colors.success, colors.personalityAlt];
  const showImage = !!image && !imgFailed;
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <View
        style={{
          height: 56,
          width: 56,
          borderRadius: 28,
          borderWidth: 2,
          borderColor: colors.border,
          backgroundColor: bgColors[index % bgColors.length],
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {showImage ? (
          <Image
            source={{ uri: image }}
            style={{ width: 56, height: 56, borderRadius: 28 }}
            resizeMode="cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <Text
            style={{
              color: textColors[index % textColors.length],
              fontWeight: '700',
              fontSize: 16,
            }}
          >
            {initials}
          </Text>
        )}
      </View>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 11,
          fontWeight: '500',
          textAlign: 'center',
          maxWidth: 72,
          lineHeight: 15,
        }}
      >
        {name}
      </Text>
    </View>
  );
}

function PersonalityCardScreen({
  childName,
  personalityType,
  traits,
  famousPeople,
  typeColor,
  onNext,
}: {
  childName: string;
  personalityType: string;
  traits: string[];
  famousPeople: Array<{ name: string; image?: string }>;
  typeColor: string;
  onNext: () => void;
}) {
  const { colors } = useTheme();
  const typeTitle = personalityType?.split(' - ')[1] ?? personalityType ?? 'Unique';
  // typeColor is a web Tailwind class like "from-primary to-primary/70" — use primary on mobile
  void typeColor;

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: 20,
        gap: 20,
      }}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            height: 40,
            width: 40,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primarySubtle,
          }}
        >
          <Brain size={20} color={colors.primary} />
        </View>
        <View>
          <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>
            {childName}'s Profile · 1 of 3
          </Text>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
            Personality Type
          </Text>
        </View>
      </View>

      {/* Inner card */}
      <View
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surfaceDark,
          padding: 20,
          alignItems: 'center',
          gap: 16,
        }}
      >
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 3, textTransform: 'uppercase' }}>
            {childName.toUpperCase()} IS A
          </Text>
          <Text style={{ color: colors.primary, fontSize: 40, fontWeight: '800', lineHeight: 48, textAlign: 'center' }}>
            {typeTitle}
          </Text>
        </View>

        {/* Traits */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {traits.map((trait, idx) => (
            <View
              key={trait}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.ghostLight,
                paddingHorizontal: 12,
                paddingVertical: 6,
                opacity: 1,
              }}
            >
              {traitIcon(trait, 12, colors.textMuted)}
              <Text
                style={{ color: colors.text, fontSize: 12, fontWeight: '500' }}
                key={`t-${idx}`}
              >
                {trait}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Famous people */}
      {famousPeople.length > 0 && (
        <View
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceElevated,
            padding: 16,
            gap: 12,
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>
            Famous people with similar traits
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
            {famousPeople.map((person, i) => (
              <FamousPersonCircle key={person.name} name={person.name} image={person.image} index={i} />
            ))}
          </View>
        </View>
      )}

      <Button onPress={onNext} className="rounded-full">
        <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 16 }}>
          See the summary →
        </Text>
      </Button>
    </View>
  );
}

// ── Step 3: InANutshellScreen ─────────────────────────────────────────────────

function InANutshellScreen({
  childName,
  description,
  traits,
  onNext,
}: {
  childName: string;
  description: string;
  traits: string[];
  onNext: () => void;
}) {
  const { colors } = useTheme();
  const HIGHLIGHT_COLORS = [colors.primary, colors.personalityAlt, colors.warning];

  function highlightTraits(text: string): React.ReactNode[] {
    if (!traits.length) return [<Text key="all">{text}</Text>];
    const sorted = [...traits].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = text.split(pattern);
    let colorIdx = 0;
    return parts.map((part, i) => {
      if (sorted.some(t => t.toLowerCase() === part.toLowerCase())) {
        const color = HIGHLIGHT_COLORS[colorIdx++ % HIGHLIGHT_COLORS.length] ?? HIGHLIGHT_COLORS[0]!;
        return (
          <Text key={i} style={{ fontWeight: '600', color }}>
            {part}
          </Text>
        );
      }
      return <Text key={i}>{part}</Text>;
    });
  }

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: 20,
        gap: 20,
      }}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            height: 40,
            width: 40,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primarySubtle,
            borderWidth: 1,
            borderColor: colors.primaryBorder,
          }}
        >
          <Pencil size={20} color={colors.primary} />
        </View>
        <View>
          <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>
            {childName}'s Profile · 2 of 3
          </Text>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
            In a nutshell
          </Text>
        </View>
      </View>

      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', lineHeight: 28 }}>
        "{highlightTraits(description)}"
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Sparkles size={14} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
          One sentence — read it slowly. We'll get into the details next.
        </Text>
      </View>

      <Button onPress={onNext} className="rounded-full">
        <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 16 }}>
          Show emerging strengths →
        </Text>
      </Button>
    </View>
  );
}

// ── Step 4: StrengthsIntroScreen (auto-advance) ───────────────────────────────

function StrengthsIntroScreen({
  childName,
  onComplete,
}: {
  childName: string;
  onComplete: () => void;
}) {
  const { colors } = useTheme();
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; });

  useEffect(() => {
    const t = setTimeout(() => onCompleteRef.current(), 2800);
    return () => clearTimeout(t);
  }, []);

  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  useEffect(() => {
    iconScale.value = withSpring(1, { stiffness: 60, damping: 10 });
    iconOpacity.value = withTiming(1, { duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));

  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(12);
  useEffect(() => {
    const t = setTimeout(() => {
      textOpacity.value = withTiming(1, { duration: 500 });
      textY.value = withTiming(0, { duration: 500 });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));

  return (
    <View
      style={{
        minHeight: 380,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        paddingVertical: 32,
      }}
    >
      <Text
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          color: colors.textMuted,
          fontSize: 11,
          opacity: 0.4,
        }}
      >
        Friendly pause...
      </Text>

      <Animated.View
        style={[
          iconStyle,
          {
            height: 96,
            width: 96,
            borderRadius: 48,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primarySubtle,
            borderWidth: 4,
            borderColor: colors.primaryBorder,
          },
        ]}
      >
        <Star size={40} color={colors.primary} />
      </Animated.View>

      <Animated.View style={[textStyle, { alignItems: 'center', gap: 8 }]}>
        <Text
          style={{ color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' }}
        >
          Here come {childName}'s emerging strengths ⭐
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>
          We've split them across two screens so each one lands.
        </Text>
      </Animated.View>

      <Text
        style={{
          color: colors.primary,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 3.5,
          textTransform: 'uppercase',
          opacity: 0.7,
        }}
      >
        One moment...
      </Text>
    </View>
  );
}

// ── Steps 5–6: StrengthsScreen ────────────────────────────────────────────────

function StrengthItem({
  strength,
  globalIdx,
  itemIdx,
}: {
  strength: string;
  globalIdx: number;
  itemIdx: number;
}) {
  const { colors } = useTheme();
  const Icon = STRENGTH_ICONS[globalIdx % STRENGTH_ICONS.length]!;
  const num = String(globalIdx + 1).padStart(2, '0');

  const sep = strength.match(/[:—–-](.+)/);
  const title = sep ? strength.slice(0, strength.indexOf(sep[0]!)).trim() : strength;
  const detail = sep ? (sep[1]?.trim() ?? '') : '';

  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-16);
  useEffect(() => {
    const t = setTimeout(() => {
      opacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) });
      translateX.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.ease) });
    }, 100 + itemIdx * 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  const bgColors = [
    colors.primarySubtle,
    colors.successSubtle,
    colors.primaryMuted,
    colors.primarySubtle,
    colors.successSubtle,
    colors.primarySubtle,
  ];
  const fgColors = [
    colors.primary,
    colors.success,
    colors.personalityAlt,
    colors.primary,
    colors.success,
    colors.primary,
  ];

  return (
    <Animated.View
      style={[
        style,
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surfaceElevated,
          paddingHorizontal: 14,
          paddingVertical: 12,
        },
      ]}
    >
      <View
        style={{
          height: 36,
          width: 36,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          backgroundColor: bgColors[globalIdx % bgColors.length],
          borderWidth: 1,
          borderColor: fgColors[globalIdx % fgColors.length] + '33',
          flexShrink: 0,
        }}
      >
        <Text
          style={{
            color: fgColors[globalIdx % fgColors.length],
            fontSize: 10,
            fontWeight: '700',
            lineHeight: 12,
          }}
        >
          {num}
        </Text>
        <Icon size={12} color={fgColors[globalIdx % fgColors.length]!} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{title}</Text>
        {detail ? (
          <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 2 }}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

function StrengthsScreen({
  childName,
  strengths,
  globalStartIdx,
  totalStrengths,
  isLastSet,
  onNext,
}: {
  childName: string;
  strengths: string[];
  globalStartIdx: number;
  totalStrengths: number;
  isLastSet: boolean;
  onNext: () => void;
}) {
  const { colors } = useTheme();
  const remaining = totalStrengths - (globalStartIdx + strengths.length);
  const setNum = globalStartIdx === 0 ? 1 : 2;

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: 20,
        gap: 20,
      }}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            height: 40,
            width: 40,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.successSubtle,
            borderWidth: 1,
            borderColor: colors.successBorder,
          }}
        >
          <Star size={20} color={colors.warning} />
        </View>
        <View>
          <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>
            {childName}'s Profile · 3 of 3 · Set {setNum} of 2
          </Text>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
            Emerging Strengths
          </Text>
        </View>
      </View>

      <View style={{ gap: 10 }}>
        {strengths.map((s, idx) => (
          <StrengthItem
            key={s}
            strength={s}
            globalIdx={globalStartIdx + idx}
            itemIdx={idx}
          />
        ))}
      </View>

      {/* Footer row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Sparkles size={14} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
            {isLastSet
              ? `That's all ${totalStrengths} strengths!`
              : `${remaining} more strength${remaining !== 1 ? 's' : ''} to discover.`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onNext}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 20,
            paddingHorizontal: 18,
            paddingVertical: 10,
          }}
        >
          <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 14 }}>
            {isLastSet ? 'See next steps →' : `Next ${remaining} strengths →`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Step 7: WhatsNextScreen (auto-advance) ─────────────────────────────────────

function WhatsNextScreen({
  childName,
  onComplete,
}: {
  childName: string;
  onComplete: () => void;
}) {
  const { colors } = useTheme();
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; });

  useEffect(() => {
    const t = setTimeout(() => onCompleteRef.current(), 2800);
    return () => clearTimeout(t);
  }, []);

  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  useEffect(() => {
    iconScale.value = withSpring(1, { stiffness: 60, damping: 10 });
    iconOpacity.value = withTiming(1, { duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));

  const textOpacity = useSharedValue(0);
  const textY = useSharedValue(12);
  useEffect(() => {
    const t = setTimeout(() => {
      textOpacity.value = withTiming(1, { duration: 500 });
      textY.value = withTiming(0, { duration: 500 });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));

  return (
    <View
      style={{
        minHeight: 380,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        paddingVertical: 32,
      }}
    >
      <Text
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          color: colors.textMuted,
          fontSize: 11,
          opacity: 0.4,
        }}
      >
        Friendly pause...
      </Text>

      <Animated.View
        style={[
          iconStyle,
          {
            height: 96,
            width: 96,
            borderRadius: 48,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primaryMuted,
            borderWidth: 4,
            borderColor: colors.personalityAlt + '33',
          },
        ]}
      >
        <Compass size={40} color={colors.personalityAlt} />
      </Animated.View>

      <Animated.View style={[textStyle, { alignItems: 'center', gap: 8 }]}>
        <Text
          style={{ color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' }}
        >
          Ready to grow further with {childName}?
        </Text>
        <Text style={{ fontSize: 28 }}>🌟</Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>
          Next, we'll show personalized growth areas and activities.
        </Text>
      </Animated.View>

      <Text
        style={{
          color: colors.primary,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 3.5,
          textTransform: 'uppercase',
          opacity: 0.7,
        }}
      >
        One moment...
      </Text>
    </View>
  );
}

// ── Step 8: FinalCTAScreen ─────────────────────────────────────────────────────

function FinalCTAScreen({
  childName,
  childId,
  navigation,
}: {
  childName: string;
  childId: string | undefined;
  navigation: PersonalityJourneyNavProp;
}) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: 24,
        alignItems: 'center',
        gap: 20,
      }}
    >
      {/* Icon */}
      <View
        style={{
          height: 64,
          width: 64,
          borderRadius: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.primaryMuted,
          borderWidth: 4,
          borderColor: colors.personalityAlt + '33',
        }}
      >
        <WandSparkles size={32} color={colors.personalityAlt} />
      </View>

      <Text
        style={{
          color: colors.primary,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 3,
          textTransform: 'uppercase',
        }}
      >
        One Last Step
      </Text>

      <Text
        style={{
          color: colors.text,
          fontSize: 22,
          fontWeight: '800',
          textAlign: 'center',
          lineHeight: 30,
        }}
      >
        Want to explore the specific growth areas for{' '}
        <Text style={{ color: colors.primary }}>{childName}</Text> to become their best
        version?
      </Text>

      <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>
        Discover personalized activities to help {childName} develop key life skills.
      </Text>

      {/* Primary CTAs */}
      <View style={{ width: '100%', gap: 10 }}>
        <TouchableOpacity
          onPress={() =>
            (
              navigation as unknown as {
                navigate: (name: string, params?: unknown) => void;
              }
            ).navigate('Growth', childId ? { childId } : undefined)
          }
          style={{
            backgroundColor: colors.personality,
            borderRadius: 24,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Plus size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>
            Continue Now
          </Text>
        </TouchableOpacity>
        <Button
          size="xl"
          variant="outline"
          onPress={() => navigation.navigate('Main')}
          className="rounded-full"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Clock size={16} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 15 }}>Catch Up Later</Text>
          </View>
        </Button>
      </View>

      {/* Divider + Restart */}
      <View style={{ width: '100%', gap: 10, paddingTop: 4 }}>
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', opacity: 0.5 }}>
          Want to see the flow again?
        </Text>
        <Button
          size="xl"
          variant="outline"
          onPress={() => navigation.navigate('Onboarding')}
          className="rounded-full w-full"
        >
          <Text style={{ color: colors.text, fontSize: 14 }}>Restart the journey</Text>
        </Button>
      </View>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function PersonalityJourneyScreen() {
  const navigation = useNavigation<PersonalityJourneyNavProp>();
  const { colors } = useTheme();
  const route = useRoute<PersonalityJourneyRouteProp>();

  const { isAuthenticated, isLoading: isLoadingAuth, activeChildId } = useAuth();
  const routeChildId = (route.params as { childId?: string } | undefined)?.childId;
  const childId = routeChildId ?? activeChildId;

  const [profile, setProfile] = useState<ProfileType>(null);
  const [viewModel, setViewModel] = useState<Record<string, unknown> | null>(null);
  const [childName, setChildName] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState<1 | -1>(1);

  const markJourneyComplete = useCallback(async () => {
    if (!childId) return;
    try {
      await api.entities.Child.update(childId, {
        onboarding_phase: 3,
        onboarding_completed: true,
      });
    } catch {
      /* non-fatal */
    }
  }, [childId]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      // React Navigation automatically switches to the Auth stack when the user
      // is no longer authenticated — no explicit navigate needed.
      return;
    }
    if (!childId) {
      navigation.navigate('Main');
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          navigation.navigate('Main');
          return;
        }

        const personality = child.personality;
        const vm = personality?.view_model;
        if (!vm?.profile?.name) {
          (
            navigation as unknown as {
              navigate: (name: string, params?: unknown) => void;
            }
          ).navigate('PersonalityType', childId ? { childId } : undefined);
          return;
        }

        setViewModel(vm);
        const merged = mergeChildDraft(
          normalizeOnboardingChildDataBlob(child) ?? {},
        );
        setChildName(merged.name || '');
        setProfile(onboardingProfileFromViewModel(vm));

        if (!child.onboarding_completed) {
          await markJourneyComplete();
        }
        if (!cancelled) setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityJourney] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAuth, isAuthenticated, childId]);

  const goNext = useCallback(() => {
    setDirection(1);
    setCurrentStep(s => Math.min(s + 1, TOTAL_STEPS));
  }, []);

  if (isLoadingAuth || isInitializing) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        className="items-center justify-center"
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (initError) {
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        className="flex-col items-center justify-center gap-4 px-4"
      >
        <Text style={{ color: colors.textMuted }} className="text-center mb-4">
          Something went wrong. Please try again.
        </Text>
        <Button
          onPress={() =>
            (
              navigation as unknown as {
                navigate: (name: string, params?: unknown) => void;
              }
            ).navigate(
              'PersonalityType',
              childId ? { childId, fromBack: true } : { fromBack: true },
            )
          }
          className="rounded-2xl px-8"
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: colors.primaryForeground,
            }}
          >
            Go Back
          </Text>
        </Button>
      </View>
    );
  }

  const strengths = (profile?.top_strengths as string[]) ?? [];
  const traits = Array.isArray(viewModel?.profile)
    ? []
    : (
        ((viewModel?.profile as Record<string, unknown> | undefined)
          ?.traits as string[]) ?? []
      );
  const description = profile?.summary ?? '';
  const personalityType = profile?.personality_type ?? '';
  // personality_type is "vm.type - p.name" (e.g. "Ambitious - Highly Energetic").
  // personalityTypes is keyed by vm.type only, so split to get the lookup key.
  const personalityTypeKey = personalityType.split(' - ')[0] ?? personalityType;
  const famousPeople = (
    personalityTypes[personalityTypeKey]?.famous_people ?? []
  ) as Array<{ name: string; image?: string }>;
  const typeColor =
    personalityTypes[personalityTypeKey]?.color ?? 'from-primary to-primary/70';

  const progress = Math.round(((currentStep - 1) / (TOTAL_STEPS - 1)) * 100);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PhaseBar />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: 40,
        }}
      >
        {/* Step counter + progress */}
        <View style={{ marginBottom: 16, gap: 6 }}>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 2.5,
              textTransform: 'uppercase',
              opacity: 0.6,
            }}
          >
            Your Journey · Step {currentStep} / {TOTAL_STEPS}
          </Text>
          <View
            style={{
              height: 3,
              borderRadius: 2,
              backgroundColor: colors.surfaceDark,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${progress}%`,
                borderRadius: 2,
                backgroundColor: colors.primary,
              }}
            />
          </View>
        </View>

        {/* Step content with slide animation */}
        <StepWrapper stepKey={currentStep} direction={direction}>
          {currentStep === 1 && (
            <TheRevealScreen childName={childName} onNext={goNext} />
          )}
          {currentStep === 2 && (
            <PersonalityCardScreen
              childName={childName}
              personalityType={personalityType}
              traits={traits}
              famousPeople={famousPeople}
              typeColor={typeColor}
              onNext={goNext}
            />
          )}
          {currentStep === 3 && (
            <InANutshellScreen
              childName={childName}
              description={description}
              traits={traits}
              onNext={goNext}
            />
          )}
          {currentStep === 4 && (
            <StrengthsIntroScreen childName={childName} onComplete={goNext} />
          )}
          {currentStep === 5 && (
            <StrengthsScreen
              childName={childName}
              strengths={strengths.slice(0, 3)}
              globalStartIdx={0}
              totalStrengths={strengths.length}
              isLastSet={strengths.length <= 3}
              onNext={goNext}
            />
          )}
          {currentStep === 6 && (
            <StrengthsScreen
              childName={childName}
              strengths={
                strengths.length > 3 ? strengths.slice(3) : strengths.slice(0, 3)
              }
              globalStartIdx={3}
              totalStrengths={strengths.length}
              isLastSet
              onNext={goNext}
            />
          )}
          {currentStep === 7 && (
            <WhatsNextScreen childName={childName} onComplete={goNext} />
          )}
          {currentStep === 8 && (
            <FinalCTAScreen
              childName={childName}
              childId={childId ?? undefined}
              navigation={navigation}
            />
          )}
        </StepWrapper>
      </ScrollView>
    </View>
  );
}
