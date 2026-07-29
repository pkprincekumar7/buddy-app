import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmojiText } from '@/components/ui/EmojiText';
import { useFadeIn, useSlideUp } from '@/lib/animations';
import { useTheme } from '@/lib/ThemeContext';
import { PILLAR_BG_COLORS } from '@/lib/gradientColors';
import ChildCard from '@/components/shared/ChildCard';
import { useAuth } from '@/lib/AuthContext';
import { navigateTo } from '@/lib/navigationRef';
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
  const { activeChild, isLoading: isLoadingAuth } = useAuth();

  // Replace the old RootNavigator conditional — push Onboarding once for
  // new or incomplete users. The ref prevents re-triggering on re-renders.
  const onboardingGuardFiredRef = useRef(false);
  useEffect(() => {
    if (isLoadingAuth || onboardingGuardFiredRef.current) return;
    if (!activeChild?.onboarding_completed) {
      onboardingGuardFiredRef.current = true;
      navigation.navigate('Onboarding');
    }
  }, [isLoadingAuth, activeChild, navigation]);

  const handleAddChild = useCallback(async () => {
    await AsyncStorage.setItem('buddy360:forceNewOnboarding', '1').catch(
      () => {},
    );
    navigation.navigate('Onboarding');
  }, [navigation]);

  const { data: childrenRaw = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date'),
  });
  const children = Array.isArray(childrenRaw) ? childrenRaw : [];

  const heroAnim = useSlideUp(0.0, 1000);
  const childrenAnim = useSlideUp(0.15, 900);
  const pillarsAnim = useSlideUp(0.3, 900);
  const howAnim = useSlideUp(0.45, 900);
  const ctaAnim = useSlideUp(0.6, 900);

  const handleStartJourney = () => {
    navigation.navigate('Onboarding');
  };

  const handleContinueJourney = useCallback(() => {
    if (activeChild?.onboarding_completed) {
      navigateTo('Main', {
        screen: 'Personality',
        params: { screen: 'PersonalityJourney' },
      });
    } else {
      navigation.navigate('Onboarding');
    }
  }, [activeChild, navigation]);

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
      <Animated.View
        style={heroAnim}
        className="px-5 items-center pt-16 pb-10"
      >
        {/* Badge */}
        <View
          className="flex-row items-center gap-2 rounded-full border px-4 py-2 mb-8"
          style={{
            borderColor: colors.primaryMuted,
            backgroundColor: colors.primarySubtle,
          }}
        >
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

        {children.length === 0 ? (
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
        ) : (
          // "Continue Your Journey" shown because the children management section
          // below is hidden. When that section is re-enabled, remove this else-branch
          // so the hero goes back to showing no button when children exist.
          <Button
            size="xl"
            onPress={handleContinueJourney}
            className="rounded-2xl"
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '600',
                color: colors.primaryForeground,
              }}
            >
              ✨ Continue Your Journey →
            </Text>
          </Button>
        )}
      </Animated.View>

      {/* FEATURE HIDDEN: Children management section (add child, child cards, delete child).
          To re-enable: remove the `{false && ( ... )}` wrapper below, remove firstChild
          and the "Continue Your Journey" else-branch in the hero above, and restore the
          hero padding conditional. The underlying API and hooks are untouched. */}
      {false && (
        <Animated.View style={childrenAnim} className="px-5 pb-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text
              className="text-base font-semibold"
              style={{ color: colors.text }}
            >
              Your Children
            </Text>
            <View className="items-end gap-1">
              <Pressable
                onPress={() => void handleAddChild()}
                disabled={children.length >= 10}
                className="flex-row items-center gap-1 rounded-xl border px-3 py-1.5"
                style={{
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceElevated,
                  opacity: children.length >= 10 ? 0.45 : 1,
                }}
              >
                <Text
                  className="text-xs font-medium"
                  style={{ color: colors.text }}
                >
                  + Add Child
                </Text>
              </Pressable>
              {children.length >= 10 && (
                <Text
                  className="text-[10px]"
                  style={{ color: colors.textMuted }}
                >
                  Maximum of 10 children reached.
                </Text>
              )}
            </View>
          </View>

          {children.length === 0 ? (
            <Pressable
              onPress={() => void handleAddChild()}
              className="rounded-2xl border border-dashed py-6 items-center"
              style={{ borderColor: colors.border }}
            >
              <Text className="text-sm" style={{ color: colors.textMuted }}>
                No children yet. Tap to add your first child.
              </Text>
            </Pressable>
          ) : (
            <View className="gap-3">
              {children.map(child => (
                <ChildCard key={child.id} child={child} />
              ))}
            </View>
          )}
        </Animated.View>
      )}

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
                style={{ color: colors.textMuted }}
              >
                {item.description}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* CTA — only shown to first-time visitors with no children yet */}
      {children.length === 0 && (
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
              No pressure. No comparisons. Just guided, consistent growth
              towards becoming their best self.
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
      )}

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
