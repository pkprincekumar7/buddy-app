import Animated from 'react-native-reanimated';
import { View, Text, Pressable } from 'react-native';
import { EmojiText } from '@/components/ui/EmojiText';
import { Button } from '@/components/ui/Button';
import { api } from '@/api/client';
import { useFadeIn, useSlideUp } from '@/lib/animations';
import { useTheme } from '@/lib/ThemeContext';

const WELCOME_FEATURES = [
  { emoji: '❤️', text: 'Understanding your child deeply' },
  { emoji: '🧭', text: 'Creating a personalized growth pathway' },
  { emoji: '✨', text: 'Getting life-changing recommendations' },
];

interface WelcomePhaseProps {
  onContinue: () => void;
  isAuthenticated?: boolean;
  user?: { full_name?: string; email?: string } | null;
}

// Each feature item gets its own animated wrapper so hooks are called at component level.
function FeatureItem({
  emoji,
  text,
  delay,
}: {
  emoji: string;
  text: string;
  delay: number;
}) {
  const { colors } = useTheme();
  const anim = useFadeIn(delay, 700);
  return (
    <Animated.View style={anim} className="flex-row items-center gap-3">
      <View
        className="h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: colors.primary + '1A' }}
      >
        <EmojiText size="base">{emoji}</EmojiText>
      </View>
      <Text className="text-sm" style={{ color: colors.textMuted }}>
        {text}
      </Text>
    </Animated.View>
  );
}

export default function WelcomePhase({
  onContinue,
  isAuthenticated,
  user,
}: WelcomePhaseProps) {
  const { colors } = useTheme();
  const handleGoogleLogin = () => {
    void api.auth.redirectToLogin();
  };

  const logoAnim = useFadeIn(100, 700);
  const titleAnim = useSlideUp(0.55, 800);
  const subtitleAnim = useSlideUp(0.85, 800);
  const featuresAnim = useSlideUp(1.15, 800);
  const ctaAnim = useSlideUp(2.15, 800);
  const timeAnim = useFadeIn(2500, 800);

  return (
    <View className="pb-8">
      {/* Hero */}
      <View className="items-center mb-8">
        <Animated.View
          style={[logoAnim, { backgroundColor: colors.primary }]}
          className="mb-6 h-20 w-20 items-center justify-center rounded-2xl"
        >
          <Text
            className="text-2xl font-bold"
            style={{ color: colors.primaryForeground }}
          >
            B
          </Text>
        </Animated.View>

        <Animated.View style={titleAnim} className="items-center">
          <Text
            className="mb-3 text-center text-3xl font-bold tracking-tight"
            style={{ color: colors.text }}
          >
            Welcome to Buddy360
          </Text>
        </Animated.View>

        <Animated.View style={subtitleAnim} className="items-center px-4">
          <Text
            className="text-center text-base leading-relaxed"
            style={{ color: colors.textMuted }}
          >
            A guided journey to help your child discover their strengths and
            design a meaningful life
          </Text>
        </Animated.View>
      </View>

      {/* Features */}
      <Animated.View
        style={[
          featuresAnim,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.border,
          },
        ]}
        className="mx-4 mb-8 rounded-2xl p-6 border"
      >
        <Text
          className="mb-5 text-xs font-semibold uppercase tracking-widest"
          style={{ color: colors.iconColor }}
        >
          Let's Start By
        </Text>
        <View className="space-y-4">
          {WELCOME_FEATURES.map((feature, index) => (
            <FeatureItem
              key={feature.text}
              emoji={feature.emoji}
              text={feature.text}
              delay={1400 + index * 250}
            />
          ))}
        </View>
      </Animated.View>

      {/* Login/Continue */}
      <Animated.View
        style={ctaAnim}
        className="mx-4 mb-8 items-center space-y-4"
      >
        {isAuthenticated ? (
          <>
            <View
              className="w-full flex-row items-center gap-3 rounded-2xl p-4 border"
              style={{
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
              }}
            >
              <View
                className="h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: colors.primary }}
              >
                <Text
                  className="text-sm font-bold"
                  style={{ color: colors.primaryForeground }}
                >
                  {user?.full_name?.[0] ?? user?.email?.[0] ?? '?'}
                </Text>
              </View>
              <View>
                <Text
                  className="text-sm font-medium"
                  style={{ color: colors.text }}
                >
                  {user?.full_name ?? 'Welcome!'}
                </Text>
                <Text className="text-xs" style={{ color: colors.iconColor }}>
                  {user?.email}
                </Text>
              </View>
            </View>

            <Button
              onPress={onContinue}
              className="w-full rounded-2xl h-14 items-center justify-center"
              style={{ backgroundColor: colors.primaryAction }}
            >
              <Text
                className="text-base font-semibold"
                style={{ color: colors.primaryForeground }}
              >
                ✨ Let's Begin
              </Text>
            </Button>
          </>
        ) : (
          <>
            <View
              className="w-full rounded-2xl p-5 border"
              style={{
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
              }}
            >
              <View className="mb-4 flex-row items-center justify-center gap-2">
                <Text className="text-xs" style={{ color: colors.iconColor }}>
                  🛡 Sign in to save your progress securely
                </Text>
              </View>

              <Pressable
                onPress={handleGoogleLogin}
                style={{
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                }}
                className="h-12 w-full flex-row items-center justify-center rounded-xl border"
                android_ripple={{ color: colors.pressedBackground }}
              >
                <Text
                  className="text-sm font-medium"
                  style={{ color: colors.text }}
                >
                  Continue with Google
                </Text>
              </Pressable>
            </View>

            <Text
              className="text-xs text-center"
              style={{ color: colors.iconColor }}
            >
              By continuing, you agree to our Terms of Service and Privacy
              Policy
            </Text>
          </>
        )}
      </Animated.View>

      {/* Time estimate */}
      <Animated.View style={timeAnim}>
        <Text
          className="text-center text-xs"
          style={{ color: colors.iconColor }}
        >
          This will take about 5–7 minutes
        </Text>
      </Animated.View>
    </View>
  );
}
