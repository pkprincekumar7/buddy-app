import type { ComponentType } from 'react';
import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { View, Text, Pressable } from 'react-native';
import Svg, { Path as SvgPath, Line as SvgLine } from 'react-native-svg';
import { MessageSquare, Sparkles, Target } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { api } from '@/api/client';
import { useSlideUp } from '@/lib/animations';
import { useTheme } from '@/lib/ThemeContext';

type LucideIcon = ComponentType<{ size?: number; color?: string }>;

const FEATURES: { icon: LucideIcon; text: string }[] = [
  { icon: MessageSquare, text: 'Quick chat' },
  { icon: Sparkles, text: 'Personalized' },
  { icon: Target, text: 'Actionable' },
];

interface WelcomePhaseProps {
  onContinue: () => void;
  isAuthenticated?: boolean;
  user?: { full_name?: string; email?: string } | null;
}

export default function WelcomePhase({
  onContinue,
  isAuthenticated,
  user,
}: WelcomePhaseProps) {
  const { colors } = useTheme();
  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  const handleGoogleLogin = () => {
    void api.auth.redirectToLogin();
  };

  // Logo spring animation — mirrors web Framer Motion: scale 0→1, stiffness: 70, damping: 12
  const logoScale = useSharedValue(0);
  const logoOpacity = useSharedValue(0);
  useEffect(() => {
    logoScale.value = withDelay(100, withSpring(1, { stiffness: 70, damping: 12 }));
    logoOpacity.value = withDelay(
      100,
      withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const logoSpringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
    opacity: logoOpacity.value,
  }));

  const titleAnim = useSlideUp(0.55, 800);
  const subtitleAnim = useSlideUp(0.85, 800);
  // Staggered per-chip animations — mirrors web: delay 1.0 + i * 0.1s
  const chip0Anim = useSlideUp(1.0, 800);
  const chip1Anim = useSlideUp(1.1, 800);
  const chip2Anim = useSlideUp(1.2, 800);
  const chipAnims = [chip0Anim, chip1Anim, chip2Anim];
  const ctaAnim = useSlideUp(2.15, 800);
  const timeAnim = useSlideUp(2.5, 800);

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: 24,
      }}
    >
      {/* Hero */}
      <View className="items-center mb-6">
        {/* Logo — spring scale + fade, mirrors web Framer Motion spring */}
        <Animated.View
          style={[logoSpringStyle, { backgroundColor: colors.primary }]}
          className="mb-6 h-20 w-20 items-center justify-center rounded-full"
        >
          <Svg width={40} height={44} viewBox="0 0 20 22">
            <SvgLine
              x1="10"
              y1="21"
              x2="10"
              y2="14"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <SvgPath
              d="M10 15 C9 12 4 10 4 6.5 C4 3.5 6.5 2.5 8.5 3.5 C9.5 4 10 9 10 15 Z"
              fill="white"
            />
            <SvgPath
              d="M10 15 C11 12 16 10 16 6.5 C16 3.5 13.5 2.5 11.5 3.5 C10.5 4 10 9 10 15 Z"
              fill="white"
            />
          </Svg>
        </Animated.View>

        <Animated.View style={titleAnim} className="items-center">
          <Text
            className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-center"
            style={{ color: colors.primary }}
          >
            Welcome to your growth journey
          </Text>
          <Text
            className="text-3xl font-bold leading-tight tracking-tight text-center"
            style={{ color: colors.text }}
          >
            Hey {firstName}! 👋{'\n'}I'm{' '}
            <Text style={{ color: colors.primary }}>Buddy</Text>
            , your child's{'\n'}growth companion.
          </Text>
        </Animated.View>

        <Animated.View style={subtitleAnim} className="items-center mt-4">
          <Text
            className="text-center text-sm leading-relaxed"
            style={{ color: colors.textMuted }}
          >
            In a few light, friendly questions I'll learn about your child —
            one thing at a time. No long forms, no pressure. Promise.
          </Text>
        </Animated.View>
      </View>

      {/* Feature chips — staggered entrance, Lucide icons in primary color */}
      <View className="flex-row mb-6" style={{ gap: 12 }}>
        {FEATURES.map((f, i) => {
          const Icon = f.icon;
          return (
            <Animated.View key={f.text} style={[chipAnims[i], { flex: 1 }]}>
              <View
                className="items-center gap-2 rounded-xl border py-4"
                style={{
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                }}
              >
                <Icon size={20} color={colors.primary} />
                <Text
                  className="text-xs font-medium text-center"
                  style={{ color: colors.text }}
                >
                  {f.text}
                </Text>
              </View>
            </Animated.View>
          );
        })}
      </View>

      {/* CTA — glow shadow mirrors web glow-teal-md */}
      <Animated.View style={[ctaAnim, { gap: 8 }]} className="items-center mb-4">
        {isAuthenticated ? (
          <View
            style={{
              width: '100%',
              shadowColor: colors.primary,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.35,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Button
              onPress={onContinue}
              className="w-full rounded-full h-12 items-center justify-center"
              style={{ backgroundColor: colors.primary }}
            >
              <Text
                className="text-base font-semibold"
                style={{ color: colors.primaryForeground }}
              >
                Let's start →
              </Text>
            </Button>
          </View>
        ) : (
          <>
            <View
              style={{
                width: '100%',
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.35,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <Pressable
                onPress={handleGoogleLogin}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 999,
                  height: 48,
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                android_ripple={{ color: colors.pressedBackground }}
              >
                <Text
                  className="text-base font-semibold"
                  style={{ color: colors.primaryForeground }}
                >
                  Get started →
                </Text>
              </Pressable>
            </View>
            <Text
              className="text-xs text-center"
              style={{ color: colors.iconColor }}
            >
              Sign in to save your progress securely
            </Text>
          </>
        )}
      </Animated.View>

      {/* Time estimate */}
      <Animated.View style={timeAnim}>
        <Text
          className="text-center text-xs"
          style={{ color: colors.iconColor, opacity: 0.5 }}
        >
          Takes about 2 minutes
        </Text>
      </Animated.View>
    </View>
  );
}
