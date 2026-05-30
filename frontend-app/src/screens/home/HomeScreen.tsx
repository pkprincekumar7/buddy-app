import React from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmojiText } from '@/components/ui/EmojiText';
import { useFadeIn, useSlideUp } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';
import type { RootStackParamList } from '@/navigation';

type HomeNavProp = StackNavigationProp<RootStackParamList>;

interface PillarItem {
  emoji: string;
  label: string;
  bgColor: string;
  description: string;
}

const PILLARS: PillarItem[] = [
  { emoji: '🧠', label: 'Mind',      bgColor: 'bg-blue-700',    description: 'Cognitive growth & curiosity' },
  { emoji: '❤️', label: 'Heart',     bgColor: 'bg-rose-700',    description: 'Emotional intelligence' },
  { emoji: '💪', label: 'Body',      bgColor: 'bg-emerald-700', description: 'Physical wellbeing' },
  { emoji: '🎨', label: 'Talents',   bgColor: 'bg-purple-700',  description: 'Skill discovery' },
  { emoji: '⭐', label: 'Character', bgColor: 'bg-amber-700',   description: 'Values & integrity' },
  { emoji: '🚀', label: 'Future',    bgColor: 'bg-teal-700',    description: 'Life direction' },
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
  return (
    <Animated.View style={anim} className="w-1/2 p-2">
      <View className="rounded-2xl bg-card border border-slate-800 p-4">
        <View className={`h-10 w-10 rounded-xl ${pillar.bgColor} items-center justify-center mb-3`}>
          <EmojiText size="lg">{pillar.emoji}</EmojiText>
        </View>
        <Text className="text-base font-semibold text-white mb-1">{pillar.label}</Text>
        <Text className="text-xs text-slate-500">{pillar.description}</Text>
      </View>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();

  const { data: childrenRaw = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date'),
  });
  const children = Array.isArray(childrenRaw) ? childrenRaw : [];

  const onboardingInProgress = children.some((c) => !c.onboarding_completed);
  // Mirrors web: derive active child from the same React Query source, not a separate AuthContext read.
  const activeChild = children.find((c) => !c.onboarding_completed) ?? children[0];

  const heroAnim  = useSlideUp(0.0, 1000);
  const pillarsAnim = useSlideUp(0.2, 900);
  const howAnim = useSlideUp(0.35, 900);
  const ctaAnim = useSlideUp(0.5, 900);

  const handleStartJourney = () => {
    navigation.navigate('Onboarding');
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#14b8a6" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Hero */}
      <Animated.View style={heroAnim} className="px-5 pt-16 pb-10 items-center">
        {/* Badge */}
        <View className="flex-row items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/10 px-4 py-2 mb-8">
          <View className="h-2 w-2 rounded-full bg-teal-400" />
          <Text className="text-xs font-medium text-teal-400">A Growth Companion for Families</Text>
        </View>

        <Text className="text-3xl font-bold leading-tight tracking-tight text-white text-center mb-2">
          Nurture Self-Aware,
        </Text>
        <Text className="text-3xl font-bold leading-tight tracking-tight text-teal-400 text-center mb-2">
          Purpose-Driven
        </Text>
        <Text className="text-3xl font-bold leading-tight tracking-tight text-white text-center mb-6">
          Children
        </Text>

        <Text className="text-base leading-relaxed text-slate-400 text-center mb-8 max-w-sm">
          A 9-year guided journey helping your child discover strengths, build character, and design a
          meaningful life.
        </Text>

        {onboardingInProgress ? (
          <View className="w-full gap-3">
            <Button
              onPress={() => navigation.navigate('Onboarding')}
              className="h-12 rounded-2xl px-8"
            >
              <Text className="text-sm font-semibold text-[#0a0a0a]">✨  Continue Onboarding  →</Text>
            </Button>
            {/* Mirror the web: offer Start Over alongside Continue */}
            {activeChild?.id ? (
              <StartOverButton childId={activeChild.id} className="w-full" />
            ) : null}
          </View>
        ) : (
          <Button
            onPress={handleStartJourney}
            className="h-12 rounded-2xl px-8"
          >
            <Text className="text-sm font-semibold text-[#0a0a0a]">✨  Start Your Journey  →</Text>
          </Button>
        )}
      </Animated.View>

      {/* 6 Pillars */}
      <Animated.View style={pillarsAnim} className="px-3 pb-10">
        <View className="items-center mb-8 px-2">
          <Text className="text-2xl font-bold tracking-tight text-white text-center mb-3">
            6 Pillars of Holistic Growth
          </Text>
          <Text className="text-sm text-slate-400 text-center">
            We nurture every dimension of your child's development for balanced, sustainable growth.
          </Text>
        </View>

        <View className="flex-row flex-wrap">
          {PILLARS.map((pillar) => (
            <PillarCard key={pillar.label} pillar={pillar} />
          ))}
        </View>
      </Animated.View>

      {/* How It Works */}
      <Animated.View style={howAnim} className="bg-slate-900/50 px-5 py-10">
        <Text className="text-2xl font-bold tracking-tight text-white text-center mb-8">
          How It Works
        </Text>

        <View className="gap-8">
          {HOW_IT_WORKS.map((item) => (
            <View key={item.title} className="items-center">
              <View className="h-14 w-14 rounded-2xl bg-slate-800 border border-slate-700 items-center justify-center mb-4">
                <EmojiText size="2xl">{item.emoji}</EmojiText>
              </View>
              <Text className="text-base font-semibold text-white mb-2 text-center">{item.title}</Text>
              <Text className="text-sm leading-relaxed text-slate-500 text-center">{item.description}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* CTA */}
      <Animated.View style={ctaAnim} className="px-5 py-10">
        <View className="rounded-3xl bg-slate-900 border border-slate-800 p-8 items-center">
          <Text className="text-2xl font-bold tracking-tight text-white text-center mb-3">
            Begin Your Child's Journey Today
          </Text>
          <Text className="text-sm leading-relaxed text-slate-400 text-center mb-6 max-w-xs">
            No pressure. No comparisons. Just guided, consistent growth towards becoming their best self.
          </Text>
          <Button onPress={handleStartJourney} className="h-12 rounded-2xl px-10">
            <Text className="text-sm font-semibold text-[#0a0a0a]">Get Started Free  →</Text>
          </Button>
        </View>
      </Animated.View>

      {/* Footer */}
      <View className="items-center py-6 border-t border-slate-800">
        <View className="flex-row items-center gap-2 mb-2">
          <View className="h-5 w-5 rounded-md bg-teal-600 items-center justify-center">
            <Text className="text-[10px] font-bold text-white">B</Text>
          </View>
          <Text className="text-sm font-semibold text-white">Buddy360</Text>
        </View>
        <Text className="text-xs text-slate-600 text-center px-4">
          A Growth Companion for Raising Self-Aware, Capable, and Purpose-Driven Humans
        </Text>
      </View>
    </ScrollView>
  );
}
