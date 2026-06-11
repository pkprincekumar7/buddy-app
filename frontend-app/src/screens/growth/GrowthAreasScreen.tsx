import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { CheckCircle2, ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import { GROWTH_AREAS } from '@/lib/growthAreaData';
import { useFocusEntranceAnim, useFadeIn } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import {
  GradientIconBox,
  GradientButton,
  areaGrad,
} from '@/components/shared/GradientView';
import type { GrowthStackParamList } from '@/navigation';

type GrowthNavProp = StackNavigationProp<GrowthStackParamList, 'GrowthAreas'>;

// Staggered entrance card — mirrors web: opacity+y with delay 200+i*100ms
function AnimatedAreaCard({
  area,
  index,
  done,
  onPress,
}: {
  area: (typeof GROWTH_AREAS)[number];
  index: number;
  done: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    const delay = 200 + index * 100;
    const cfg = { duration: 800, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    translateY.value = withDelay(delay, withTiming(0, cfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const Icon = area.icon;
  const { from, to } = areaGrad(area.color);

  return (
    <Animated.View style={[cardStyle, { width: '47.5%' }]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        style={{
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: done ? `${colors.success}4d` : colors.border,
          backgroundColor: done ? `${colors.success}1a` : colors.card,
          position: 'relative',
        }}
      >
        {/* Gradient icon box */}
        <View style={{ marginBottom: 12 }}>
          <GradientIconBox from={from} to={to} size={44} radius={12} diagonal>
            <Icon size={24} color={colors.primaryForeground} />
          </GradientIconBox>
        </View>

        <Text className="text-sm font-semibold" style={{ color: colors.text }}>
          {area.name}
        </Text>
        <Text className="mt-0.5 text-xs" style={{ color: colors.iconColor }}>
          {area.description}
        </Text>

        {done && (
          <View style={{ position: 'absolute', top: 12, right: 12 }}>
            <CheckCircle2 size={20} color={colors.success} />
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function GrowthAreasScreen() {
  const navigation = useNavigation<GrowthNavProp>();
  const { colors } = useTheme();
  const {
    activeChildId,
    isAuthenticated,
    isLoading: isLoadingAuth,
  } = useAuth();

  const [completedAreaIds, setCompletedAreaIds] = useState<
    Set<string | undefined>
  >(new Set());
  const [hydrated, setHydrated] = useState(false);

  const [showSplash, startTimer] = useStageSplash();

  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );

  const contentStyle = useFocusEntranceAnim(
    !isLoadingAuth && hydrated && !showSplash,
  );
  // Life Pathway button fades in when it becomes visible (mirrors web motion.div opacity 0→1)
  const pathwayFadeStyle = useFadeIn(0, 600);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) return;
    if (!activeChildId) return;

    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(activeChildId);
        if (cancelled) return;
        if (!child) return;

        const areas = await api.completedGrowthAreas.list(activeChildId);
        if (cancelled) return;
        const allDocs = areas.areas ?? [];
        const done = new Set(
          allDocs
            .filter(
              a =>
                a.status === 'completed' ||
                !a.status ||
                (Array.isArray(a.ai_three_month_recommendations) &&
                  a.ai_three_month_recommendations.length > 0),
            )
            .map(a => a.area_id),
        );
        setCompletedAreaIds(done);
      } catch (err) {
        console.warn('[GrowthAreasScreen] Load failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, activeChildId]);

  const anyDone = completedAreaIds.size >= 1;

  if (isLoadingAuth || !hydrated) {
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
    <View style={{ flex: 1 }}>
      <Animated.View
        style={[contentStyle, { backgroundColor: colors.background }]}
        className="flex-1"
      >
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 32,
            paddingBottom: 40,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="mb-8 items-center">
            <Text
              className="mb-2 text-2xl font-bold"
              style={{ color: colors.text }}
            >
              Growth Areas
            </Text>
            <Text style={{ color: colors.textMuted }}>
              Choose an area to explore
            </Text>
          </View>

          {/* Grid — 2-column, staggered entrance */}
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            {GROWTH_AREAS.map((area, index) => (
              <AnimatedAreaCard
                key={area.id}
                area={area}
                index={index}
                done={completedAreaIds.has(area.id)}
                onPress={() =>
                  navigation.navigate('GrowthAreasActivity', {
                    activityId: area.urlName,
                    fromReview: true,
                  })
                }
              />
            ))}
          </View>

          {/* Actions */}
          <PageActions
            className="mt-8"
            left={
              <Button
                variant="outline"
                onPress={() =>
                  (
                    navigation.getParent() as unknown as {
                      navigate: (name: string, params?: unknown) => void;
                    }
                  )?.navigate('Personality', {
                    screen: 'PersonalityJourney',
                    params: activeChildId
                      ? { childId: activeChildId, fromBack: true }
                      : { fromBack: true },
                  })
                }
                className="w-full rounded-2xl"
              >
                <View className="flex-row items-center gap-1.5">
                  <ChevronLeft size={16} color={colors.textMuted} />
                  <Text
                    className="text-base font-medium"
                    style={{ color: colors.textMuted }}
                  >
                    Back
                  </Text>
                </View>
              </Button>
            }
            center={
              <StartOverButton
                childId={activeChildId ?? undefined}
                className="w-full"
              />
            }
            right={
              anyDone ? (
                <Animated.View style={pathwayFadeStyle} className="w-full">
                  <GradientButton
                    from={colors.primary}
                    to={colors.success}
                    height={48}
                    borderRadius={16}
                    onPress={() => {
                      navigation.getParent()?.navigate('LifePathway' as never);
                    }}
                    style={{ width: '100%' }}
                  >
                    <Text
                      style={{
                        fontWeight: '600',
                        color: colors.primaryForeground,
                      }}
                    >
                      View Your Life Pathway
                    </Text>
                  </GradientButton>
                </Animated.View>
              ) : undefined
            }
          />
        </ScrollView>
      </Animated.View>

      {showSplash && <StageSplash stage={7} onReady={startTimer} />}
    </View>
  );
}
