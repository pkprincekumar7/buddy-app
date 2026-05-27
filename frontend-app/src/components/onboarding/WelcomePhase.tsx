import Animated from 'react-native-reanimated';
import { View, Text, Pressable } from 'react-native';
import { Button } from '@/components/ui/Button';
import { api } from '@/api/client';
import { useFadeIn, useSlideUp } from '@/lib/animations';

const WELCOME_FEATURES = [
  { emoji: '❤️', text: 'Understand your child deeply' },
  { emoji: '🧭', text: 'Create a personalized growth pathway' },
  { emoji: '✨', text: 'Get life changing recommendations' },
];

interface WelcomePhaseProps {
  onContinue: () => void;
  isAuthenticated?: boolean;
  user?: { full_name?: string; email?: string } | null;
}

// Each feature item gets its own animated wrapper so hooks are called at component level.
function FeatureItem({ emoji, text, delay }: { emoji: string; text: string; delay: number }) {
  const anim = useFadeIn(delay, 700);
  return (
    <Animated.View style={anim} className="flex-row items-center gap-3">
      <View className="h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/10">
        <Text className="text-base">{emoji}</Text>
      </View>
      <Text className="text-sm text-slate-300">{text}</Text>
    </Animated.View>
  );
}

export default function WelcomePhase({ onContinue, isAuthenticated, user }: WelcomePhaseProps) {
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
          style={logoAnim}
          className="mb-6 h-20 w-20 items-center justify-center rounded-2xl bg-teal-500"
        >
          <Text className="text-2xl font-bold text-white">B</Text>
        </Animated.View>

        <Animated.View style={titleAnim} className="items-center">
          <Text className="mb-3 text-center text-3xl font-bold tracking-tight text-white">
            Welcome to Buddy360
          </Text>
        </Animated.View>

        <Animated.View style={subtitleAnim} className="items-center px-4">
          <Text className="text-center text-base leading-relaxed text-slate-400">
            A guided journey to help your child discover their strengths and design a meaningful life
          </Text>
        </Animated.View>
      </View>

      {/* Features */}
      <Animated.View
        style={featuresAnim}
        className="mx-4 mb-8 rounded-2xl bg-surface-elevated p-6 border border-white/10"
      >
        <Text className="mb-5 text-xs font-semibold uppercase tracking-widest text-slate-500">
          What you'll do today
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
      <Animated.View style={ctaAnim} className="mx-4 mb-8 items-center space-y-4">
        {isAuthenticated ? (
          <>
            <View className="w-full flex-row items-center gap-3 rounded-2xl bg-surface-elevated p-4 border border-white/10">
              <View className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-500">
                <Text className="text-sm font-bold text-white">
                  {user?.full_name?.[0] ?? user?.email?.[0] ?? '?'}
                </Text>
              </View>
              <View>
                <Text className="text-sm font-medium text-white">{user?.full_name ?? 'Welcome!'}</Text>
                <Text className="text-xs text-slate-500">{user?.email}</Text>
              </View>
            </View>

            <Button
              onPress={onContinue}
              className="w-full rounded-2xl h-14 bg-teal-500 items-center justify-center"
            >
              <Text className="text-base font-semibold text-[#0a0a0a]">✨ Let's Begin</Text>
            </Button>
          </>
        ) : (
          <>
            <View className="w-full rounded-2xl bg-surface-elevated p-5 border border-white/10">
              <View className="mb-4 flex-row items-center justify-center gap-2">
                <Text className="text-xs text-slate-500">🛡 Sign in to save your progress securely</Text>
              </View>

              <Pressable
                onPress={handleGoogleLogin}
                className="h-12 w-full flex-row items-center justify-center rounded-xl bg-[#242424] border border-white/10"
                android_ripple={{ color: '#2a2a2a' }}
              >
                <Text className="text-sm font-medium text-white">Continue with Google</Text>
              </Pressable>
            </View>

            <Text className="text-xs text-slate-600 text-center">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </Text>
          </>
        )}
      </Animated.View>

      {/* Time estimate */}
      <Animated.View style={timeAnim}>
        <Text className="text-center text-xs text-slate-600">
          This will take about 5–7 minutes
        </Text>
      </Animated.View>
    </View>
  );
}
