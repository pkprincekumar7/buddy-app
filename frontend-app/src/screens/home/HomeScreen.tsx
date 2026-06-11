import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmojiText } from '@/components/ui/EmojiText';
import { useFadeIn, useSlideUp } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';
import { useTheme } from '@/lib/ThemeContext';
import { PILLAR_BG_COLORS } from '@/lib/gradientColors';
import type { RootStackParamList } from '@/navigation';

type HomeNavProp = StackNavigationProp<RootStackParamList>;

interface PillarItem {
  emoji: string;
  label: string;
  bgColor: string;
  description: string;
}

const PILLARS: PillarItem[] = [
  {
    emoji: '🧠',
    label: 'Mind',
    bgColor: PILLAR_BG_COLORS[0]!,
    description: 'Cognitive growth & curiosity',
  },
  {
    emoji: '❤️',
    label: 'Heart',
    bgColor: PILLAR_BG_COLORS[1]!,
    description: 'Emotional intelligence',
  },
  {
    emoji: '💪',
    label: 'Body',
    bgColor: PILLAR_BG_COLORS[2]!,
    description: 'Physical wellbeing',
  },
  {
    emoji: '🎨',
    label: 'Talents',
    bgColor: PILLAR_BG_COLORS[3]!,
    description: 'Skill discovery',
  },
  {
    emoji: '⭐',
    label: 'Character',
    bgColor: PILLAR_BG_COLORS[4]!,
    description: 'Values & integrity',
  },
  {
    emoji: '🚀',
    label: 'Future',
    bgColor: PILLAR_BG_COLORS[5]!,
    description: 'Life direction',
  },
];

interface HowItWorksItem {
  emoji: string;
  title: string;
  description: string;
}

const HOW_IT_WORKS: HowItWorksItem[] = [
  {
    emoji: '👥',
    title: 'Parent Onboarding',
    description:
      "Share insights about your child's personality, interests, and your family values to create their unique baseline profile.",
  },
  {
    emoji: '✨',
    title: 'Weekly Missions',
    description:
      'Balanced activities across all 6 pillars keep growth consistent, fun, and achievable without overwhelm.',
  },
  {
    emoji: '🛡️',
    title: 'Growth Insights',
    description:
      'Receive observations about emerging strengths, patterns, and conversation prompts to deepen connection.',
  },
];

function PillarCard({ pillar }: { pillar: PillarItem }) {
  const anim = useFadeIn(200);
  const { colors } = useTheme();
  return (
    <Animated.View style={anim} className="w-1/2 p-2">
      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <View
          className="h-10 w-10 rounded-xl items-center justify-center mb-3"
          style={{ backgroundColor: pillar.bgColor }}
        >
          <EmojiText size="lg">{pillar.emoji}</EmojiText>
        </View>
        <Text
          className="text-base font-semibold mb-1"
          style={{ color: colors.text }}
        >
          {pillar.label}
        </Text>
        <Text className="text-xs" style={{ color: colors.iconColor }}>
          {pillar.description}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();
  const { colors } = useTheme();

  const { data: childrenRaw = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date'),
  });
  const children = Array.isArray(childrenRaw) ? childrenRaw : [];

  const onboardingInProgress = children.some(c => !c.onboarding_completed);
  // Mirrors web: derive active child from the same React Query source, not a separate AuthContext read.
  const activeChild =
    children.find(c => !c.onboarding_completed) ?? children[0];

  const heroAnim = useSlideUp(0.0, 1000);
  const pillarsAnim = useSlideUp(0.2, 900);
  const howAnim = useSlideUp(0.35, 900);
  const ctaAnim = useSlideUp(0.5, 900);

  const handleStartJourney = () => {
    navigation.navigate('Onboarding');
  };

  if (isLoading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.background }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      {/* Hero */}
      <Animated.View style={heroAnim} className="px-5 pt-16 pb-10 items-center">
        {/* Badge */}
        <View
          className="flex-row items-center gap-2 rounded-full border px-4 py-2 mb-8"
          style={{
            borderColor: colors.primary + '33',
            backgroundColor: colors.primary + '1A',
          }}
        >
          <View
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: colors.primaryLight }}
          />
          <Text
            className="text-xs font-medium"
            style={{ color: colors.primaryLight }}
          >
            A Transformational Journey for Your Child
          </Text>
        </View>

        <Text
          className="text-3xl font-bold leading-tight tracking-tight text-center mb-2"
          style={{ color: colors.text }}
        >
          Preparing Children to
        </Text>
        <Text
          className="text-3xl font-bold leading-tight tracking-tight text-center mb-6"
          style={{ color: colors.primary }}
        >
          Unlock Their Super Powers
        </Text>

        <Text
          className="text-base leading-relaxed text-center mb-8 max-w-sm"
          style={{ color: colors.textMuted }}
        >
          A guided journey to uncover strengths, build confidence, and grow into
          a thoughtful, capable individual.
        </Text>

        {onboardingInProgress ? (
          <View className="w-full gap-3">
            <Button
              size="xl"
              onPress={() => navigation.navigate('Onboarding')}
              className="rounded-2xl"
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: colors.primaryForeground,
                }}
              >
                ✨ Continue Journey →
              </Text>
            </Button>
            {/* Mirror the web: offer Start Over alongside Continue */}
            {activeChild?.id ? (
              <StartOverButton childId={activeChild.id} className="w-full" />
            ) : null}
          </View>
        ) : (
          <Button
            size="xl"
            onPress={handleStartJourney}
            className="rounded-2xl"
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '600',
                color: colors.primaryForeground,
              }}
            >
              ✨ Start Your Journey →
            </Text>
          </Button>
        )}
      </Animated.View>

      {/* 6 Pillars */}
      <Animated.View style={pillarsAnim} className="px-3 pb-10">
        <View className="items-center mb-8 px-2">
          <Text
            className="text-2xl font-bold tracking-tight text-center mb-3"
            style={{ color: colors.text }}
          >
            6 Pillars of Holistic Growth
          </Text>
          <Text
            className="text-sm text-center"
            style={{ color: colors.textMuted }}
          >
            We nurture every dimension of your child's development for balanced,
            sustainable growth.
          </Text>
        </View>

        <View className="flex-row flex-wrap">
          {PILLARS.map(pillar => (
            <PillarCard key={pillar.label} pillar={pillar} />
          ))}
        </View>
      </Animated.View>

      {/* How It Works */}
      <Animated.View
        style={[howAnim, { backgroundColor: colors.surfaceElevated }]}
        className="px-5 py-10"
      >
        <Text
          className="text-2xl font-bold tracking-tight text-center mb-8"
          style={{ color: colors.text }}
        >
          How It Works
        </Text>

        <View className="gap-8">
          {HOW_IT_WORKS.map(item => (
            <View key={item.title} className="items-center">
              <View
                className="h-14 w-14 rounded-2xl border items-center justify-center mb-4"
                style={{
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                }}
              >
                <EmojiText size="2xl">{item.emoji}</EmojiText>
              </View>
              <Text
                className="text-base font-semibold mb-2 text-center"
                style={{ color: colors.text }}
              >
                {item.title}
              </Text>
              <Text
                className="text-sm leading-relaxed text-center"
                style={{ color: colors.iconColor }}
              >
                {item.description}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* CTA */}
      <Animated.View style={ctaAnim} className="px-5 py-10">
        <View
          className="rounded-3xl border p-8 items-center"
          style={{
            backgroundColor: colors.background,
            borderColor: colors.border,
          }}
        >
          <Text
            className="text-2xl font-bold tracking-tight text-center mb-3"
            style={{ color: colors.text }}
          >
            Begin Your Child's Journey Today
          </Text>
          <Text
            className="text-sm leading-relaxed text-center mb-6 max-w-xs"
            style={{ color: colors.textMuted }}
          >
            No pressure. No comparisons. Just guided, consistent growth towards
            becoming their best self.
          </Text>
          <Button
            size="xl"
            onPress={handleStartJourney}
            className="rounded-2xl"
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '600',
                color: colors.primaryForeground,
              }}
            >
              Get Started Free →
            </Text>
          </Button>
        </View>
      </Animated.View>

      {/* Footer */}
      <View
        className="items-center py-6 border-t"
        style={{ borderColor: colors.border }}
      >
        <View className="flex-row items-center gap-2 mb-2">
          <View
            className="h-5 w-5 rounded-md items-center justify-center"
            style={{ backgroundColor: colors.primaryDark }}
          >
            <Text
              className="text-[10px] font-bold"
              style={{ color: colors.primaryForeground }}
            >
              B
            </Text>
          </View>
          <Text
            className="text-sm font-semibold"
            style={{ color: colors.text }}
          >
            Buddy360
          </Text>
        </View>
        <Text
          className="text-xs text-center px-4"
          style={{ color: colors.iconColor }}
        >
          A Growth Companion for Raising Self-Aware, Capable, and Purpose-Driven
          Humans
        </Text>
      </View>
    </ScrollView>
  );
}
