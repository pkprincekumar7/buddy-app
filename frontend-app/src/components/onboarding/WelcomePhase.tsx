import React from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, Keyframe, ZoomIn } from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';
import { MessageSquare, Sparkles, Target } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';
import { color, glow, raw } from '@/theme';

const FEATURES = [
  { icon: MessageSquare, text: 'Quick chat' },
  { icon: Sparkles, text: 'Personalized' },
  { icon: Target, text: 'Actionable' },
];

const easeOut = Easing.out(Easing.ease);

/** framer `initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }}` with delay/duration in seconds. */
function rise(delay: number, duration: number, y: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: y }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: easeOut },
  })
    .duration(duration * 1000)
    .delay(delay * 1000);
}

function fade(delay: number, duration: number) {
  return new Keyframe({ 0: { opacity: 0 }, 100: { opacity: 1 } })
    .duration(duration * 1000)
    .delay(delay * 1000);
}

function chipIn(delay: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ scale: 0.88 }] },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: easeOut },
  })
    .duration(350)
    .delay(delay * 1000);
}

const LOGO_ENTER = ZoomIn.delay(100).springify().stiffness(70).damping(12);
const EYEBROW_STYLE = { letterSpacing: 11 * 0.16 };
const CTA_STYLE = { boxShadow: glow.tealMd };
const LOGO_STYLE = { boxShadow: glow.tealIcon };
const leaf = raw['logo-leaf'];

interface WelcomePhaseProps {
  onContinue: () => void;
  isAuthenticated?: boolean;
  user?: { full_name?: string | null; email?: string | null } | null;
}

export default function WelcomePhase({
  onContinue,
  isAuthenticated,
  user,
}: WelcomePhaseProps) {
  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  const handleGoogleLogin = () => {
    void api.auth.redirectToLogin();
  };

  return (
    <Animated.View
      entering={rise(0, 0.55, 24)}
      className="w-full max-w-lg self-center"
    >
      <View className="items-center gap-6 rounded-2xl border border-edge bg-card p-8">
        {/* Buddy logo — solid teal filled circle with white sprout */}
        <Animated.View
          entering={LOGO_ENTER}
          className="h-20 w-20 items-center justify-center rounded-full bg-primary"
          style={LOGO_STYLE}
        >
          <Svg viewBox="0 0 20 22" width={40} height={40}>
            <Line
              x1="10"
              y1="21"
              x2="10"
              y2="14"
              stroke={leaf}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
            <Path
              d="M10 15 C9 12 4 10 4 6.5 C4 3.5 6.5 2.5 8.5 3.5 C9.5 4 10 9 10 15 Z"
              fill={leaf}
            />
            <Path
              d="M10 15 C11 12 16 10 16 6.5 C16 3.5 13.5 2.5 11.5 3.5 C10.5 4 10 9 10 15 Z"
              fill={leaf}
            />
          </Svg>
        </Animated.View>

        {/* Headline */}
        <View className="w-full gap-2">
          <Animated.Text
            entering={fade(0.35, 0.5)}
            className="text-center text-[11px] font-semibold uppercase text-primary"
            style={EYEBROW_STYLE}
          >
            Welcome to your growth journey
          </Animated.Text>
          <Animated.Text
            entering={rise(0.5, 0.55, 14)}
            accessibilityRole="header"
            className="text-center text-3xl font-bold leading-tight text-foreground"
          >
            Hey {firstName}! 👋{'\n'}I'm{' '}
            <Text className="text-primary">Buddy</Text>, your child's
            {'\n'}growth companion.
          </Animated.Text>
        </View>

        {/* Subtitle */}
        <Animated.Text
          entering={fade(0.75, 0.5)}
          className="max-w-sm text-center text-sm leading-relaxed text-muted-foreground"
        >
          In a few light, friendly questions I'll learn about your child — one
          thing at a time. No long forms, no pressure. Promise.
        </Animated.Text>

        {/* Feature chips */}
        <Animated.View
          entering={rise(0.95, 0.5, 10)}
          className="w-full flex-row items-center justify-center gap-3"
        >
          {FEATURES.map((f, i) => (
            <Animated.View
              key={f.text}
              entering={chipIn(1.0 + i * 0.1)}
              className="flex-1 items-center gap-2 rounded-xl border border-edge bg-surface-elevated py-4"
            >
              <f.icon size={20} color={color.primary} />
              <Text className="text-xs font-medium text-foreground">
                {f.text}
              </Text>
            </Animated.View>
          ))}
        </Animated.View>

        {/* CTA */}
        <Animated.View
          entering={rise(1.3, 0.45, 10)}
          className="w-full items-center gap-2 pt-1"
        >
          {isAuthenticated ? (
            <Button
              onPress={onContinue}
              accessibilityLabel="Let's start"
              className="h-12 rounded-full bg-primary px-12 text-base font-semibold text-primary-foreground"
              style={CTA_STYLE}
            >
              {"Let's start →"}
            </Button>
          ) : (
            <>
              <Button
                onPress={handleGoogleLogin}
                accessibilityLabel="Get started"
                className="h-12 rounded-full bg-primary px-12 text-base font-semibold text-primary-foreground"
                style={CTA_STYLE}
              >
                {'Get started →'}
              </Button>
              <Text className="text-center text-xs text-muted-foreground/60">
                Sign in to save your progress securely
              </Text>
            </>
          )}
          <Text className="text-center text-xs text-muted-foreground/50">
            Takes about 2 minutes
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
