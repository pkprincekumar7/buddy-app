import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
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
  Easing,
} from 'react-native-reanimated';
import Svg, { LinearGradient as SvgLinearGradient, Rect, Stop, Defs } from 'react-native-svg';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { areaByUrlName, AREA_QUESTIONS } from '@/lib/growthAreaData';
import type { Question } from '@/lib/growthAreaData';
import { useSlideUpWhenReady } from '@/lib/animations';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import { GradientIconBox, GradientButton, areaGrad } from '@/components/shared/GradientView';
import type { GrowthStackParamList } from '@/navigation';

type GrowthNavProp = StackNavigationProp<GrowthStackParamList, 'GrowthAreasActivity'>;
type GrowthRouteProp = RouteProp<GrowthStackParamList, 'GrowthAreasActivity'>;

export default function GrowthAreasActivityScreen() {
  const navigation = useNavigation<GrowthNavProp>();
  const route = useRoute<GrowthRouteProp>();
  const { activityId, fromReview } = route.params as { activityId: string; fromReview?: boolean };
  const { activeChildId, isAuthenticated, isLoading: isLoadingAuth } = useAuth();

  const area = areaByUrlName(activityId ?? '');
  const questions: Question[] = useMemo(
    () => (area ? (AREA_QUESTIONS[area.id] ?? []) : []),
    [area],
  );

  const [qIndex, setQIndex] = useState(0);
  const [childName, setChildName] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const answersRef = useRef<Record<string, unknown>>(answers);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [hydrated, setHydrated] = useState(false);
  // Track width for the gradient progress bar fill
  const [progressTrackW, setProgressTrackW] = useState(0);

  const contentStyle = useSlideUpWhenReady(!isLoadingAuth && hydrated);

  // Question transition animation — mirrors web AnimatePresence x: 40→0 (0.3s)
  const questionOpacity = useSharedValue(0);
  const questionTranslateX = useSharedValue(40);

  useEffect(() => {
    questionOpacity.value = 0;
    questionTranslateX.value = 40;
    questionOpacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    questionTranslateX.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.ease) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex]);

  const questionStyle = useAnimatedStyle(() => ({
    opacity: questionOpacity.value,
    transform: [{ translateX: questionTranslateX.value }],
  }));

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) return;
    if (!activeChildId) return;
    if (!area) {
      navigation.goBack();
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(activeChildId);
        if (cancelled) return;
        if (!child) return;

        setChildName(child.name ?? '');

        const completedData = await api.completedGrowthAreas.list(child.id);
        if (cancelled) return;
        const allDocs = completedData.areas ?? [];
        const areaDoc =
          allDocs.find((a) => a.area_id === area.id && a.status === 'in_progress') ??
          allDocs.find((a) => a.area_id === area.id);

        const savedAnswers = areaDoc?.interactive_answers ?? {};
        setAnswers(savedAnswers);

        // fromReview=true means the user tapped an area card directly (mirrors web's ?q=1).
        // When set, skip the auto-redirect and start from Q1 with pre-filled answers so the
        // user can review/edit all responses — exactly like the web's ?q param behaviour.
        if (fromReview) {
          setQIndex(0);
          const firstQ = questions[0];
          if (firstQ && savedAnswers[firstQ.id]) {
            setCurrentAnswer(String(savedAnswers[firstQ.id]));
          }
        } else {
          // No explicit navigation — jump to the first unanswered question (or Game if all done)
          const firstUnanswered = questions.findIndex(
            (q) => !savedAnswers[q.id] || String(savedAnswers[q.id]).trim() === '',
          );
          const startIndex = firstUnanswered === -1 ? questions.length : firstUnanswered;

          if (startIndex >= questions.length) {
            // All answered — go straight to Game
            navigation.replace('GrowthAreasActivityGame', { activityId });
            return;
          }

          setQIndex(startIndex);

          const cq = questions[startIndex];
          if (cq && savedAnswers[cq.id]) {
            setCurrentAnswer(String(savedAnswers[cq.id]));
          }
        }
      } catch (err) {
        console.warn('[GrowthAreasActivityScreen] Load failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, activeChildId, area, activityId, navigation, questions, fromReview]);

  // Keep ref in sync so the qIndex effect can read latest answers without depending on them.
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Reset current answer when question index changes.
  useEffect(() => {
    const cq = questions[qIndex];
    if (cq) {
      setCurrentAnswer(answersRef.current[cq.id] ? String(answersRef.current[cq.id]) : '');
    }
  }, [qIndex, questions]);

  const saveProgress = useCallback(
    async (updatedAnswers: Record<string, unknown>, nextStep: string) => {
      if (!activeChildId || !area) return;
      try {
        await api.completedGrowthAreas.append(activeChildId, {
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          answers: updatedAnswers,
          status: 'in_progress',
          step: nextStep,
          interactive_step: qIndex,
          interactive_answers: updatedAnswers,
          interactive_draft: null,
        });
      } catch (err) {
        console.warn('[GrowthAreasActivityScreen] Save failed:', err);
      }
    },
    [activeChildId, area, qIndex],
  );

  const handleAnswer = useCallback(
    (answer: string) => {
      if (!area) return;
      const cq = questions[qIndex];
      if (!cq) return;

      const updatedAnswers = { ...answers, [cq.id]: answer };
      setAnswers(updatedAnswers);

      const isLast = qIndex >= questions.length - 1;
      const nextStep = isLast ? 'activity_summary' : 'interactive_activity';

      if (isLast) {
        navigation.navigate('GrowthAreasActivityGame', { activityId });
      } else {
        setQIndex(qIndex + 1);
      }

      void saveProgress(updatedAnswers, nextStep);
    },
    [area, questions, qIndex, answers, saveProgress, navigation, activityId],
  );

  const handleBack = useCallback(() => {
    if (qIndex === 0) {
      navigation.goBack();
    } else {
      setQIndex(qIndex - 1);
    }
  }, [qIndex, navigation]);

  if (isLoadingAuth || !hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#14b8a6" />
      </View>
    );
  }

  if (!area || questions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-4">
        <Text className="text-slate-400">Area not found.</Text>
        <Button
          onPress={() => navigation.goBack()}
          className="rounded-2xl px-8"
        >
          <Text className="text-white">Back</Text>
        </Button>
      </View>
    );
  }

  const currentQuestion = questions[qIndex];
  if (!currentQuestion) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-4">
        <Text className="text-slate-400">Question not found.</Text>
      </View>
    );
  }

  const Icon = area.icon;
  const questionText = currentQuestion.question.replace(/\{name\}/g, childName || 'your child');
  const progress = ((qIndex + 1) / questions.length) * 100;
  const { from: gradFrom, to: gradTo } = areaGrad(area.color);
  const progressFillW = progressTrackW > 0 ? (progressTrackW * progress) / 100 : 0;

  return (
    <Animated.View style={contentStyle} className="flex-1 bg-background">
      {/* Area header — gradient icon + area name + gradient progress bar */}
      <View className="border-b border-white/10 bg-slate-900/90 px-4 py-3">
        <View className="flex-row items-center gap-3">
          <GradientIconBox from={gradFrom} to={gradTo} size={36} radius={12} diagonal>
            <Icon size={20} color="white" />
          </GradientIconBox>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-white">{area.name}</Text>
            {/* Gradient progress bar */}
            <View
              className="mt-1 overflow-hidden rounded-full bg-slate-800"
              style={{ height: 6 }}
              onLayout={(e) => setProgressTrackW(e.nativeEvent.layout.width)}
            >
              {progressTrackW > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: progressFillW,
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  <Svg
                    width={progressTrackW}
                    height={6}
                    style={{ position: 'absolute', top: 0, left: 0 }}
                  >
                    <Defs>
                      <SvgLinearGradient id="pgGrad" x1="0" y1="0" x2="1" y2="0">
                        <Stop offset="0%" stopColor={gradFrom} />
                        <Stop offset="100%" stopColor={gradTo} />
                      </SvgLinearGradient>
                    </Defs>
                    <Rect width={progressTrackW} height={6} fill="url(#pgGrad)" rx={3} />
                  </Svg>
                </View>
              )}
            </View>
          </View>
          <Text className="text-xs text-slate-500">
            {qIndex + 1} / {questions.length}
          </Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 32, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Question + answer — animated slide-in on qIndex change */}
        <Animated.View style={[questionStyle, { gap: 24 }]}>
          {/* Question card */}
          <View
            className="rounded-2xl bg-card p-6"
            style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
          >
            <Text className="text-lg font-semibold leading-relaxed text-white">
              {questionText}
            </Text>
          </View>

          {/* Answer input — choices or free text */}
          {currentQuestion.type === 'choice' ? (
            <View className="gap-3">
              {(currentQuestion.options ?? []).map((option) => {
                const isSelected = currentAnswer === option;
                return (
                  <ChoiceOption
                    key={option}
                    option={option}
                    isSelected={isSelected}
                    gradFrom={gradFrom}
                    gradTo={gradTo}
                    onPress={() => setCurrentAnswer(option)}
                  />
                );
              })}
            </View>
          ) : (
            <TextareaWithVoice
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder={currentQuestion.placeholder ?? ''}
              className="border-white/10 bg-card text-white"
            />
          )}
        </Animated.View>

        {/* Navigation */}
        <PageActions
          className="mt-10"
          left={
            <Button
              variant="outline"
              onPress={handleBack}
              className="h-12 w-full rounded-2xl px-6"
            >
              <View className="flex-row items-center gap-1.5">
                <ChevronLeft size={16} color="#cbd5e1" />
                <Text className="text-sm font-medium text-slate-300">Back</Text>
              </View>
            </Button>
          }
          center={<StartOverButton childId={activeChildId ?? undefined} className="w-full" />}
          right={
            <GradientButton
              from={gradFrom}
              to={gradTo}
              height={48}
              borderRadius={16}
              disabled={!currentAnswer.trim()}
              onPress={() => handleAnswer(currentAnswer)}
              style={{ width: '100%' }}
            >
              <View className="flex-row items-center gap-1.5">
                <Text className="font-semibold text-[#0a0a0a]">
                  {qIndex >= questions.length - 1 ? 'Finish' : 'Next'}
                </Text>
                <ChevronRight size={16} color="#0a0a0a" />
              </View>
            </GradientButton>
          }
        />
      </ScrollView>
    </Animated.View>
  );
}

// ── ChoiceOption ──────────────────────────────────────────────────────────────

function ChoiceOption({
  option,
  isSelected,
  gradFrom,
  gradTo,
  onPress,
}: {
  option: string;
  isSelected: boolean;
  gradFrom: string;
  gradTo: string;
  onPress: () => void;
}) {
  const [dims, setDims] = useState({ w: 0, h: 0 });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      onLayout={(e) =>
        setDims({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: isSelected ? 'transparent' : 'rgba(255,255,255,0.10)',
      }}
      className={!isSelected ? 'bg-card' : undefined}
    >
      {/* Gradient fill when selected */}
      {isSelected && dims.w > 0 && dims.h > 0 && (
        <Svg width={dims.w} height={dims.h} style={{ position: 'absolute', top: 0, left: 0 }}>
          <Defs>
            <SvgLinearGradient id="optGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={gradFrom} />
              <Stop offset="100%" stopColor={gradTo} />
            </SvgLinearGradient>
          </Defs>
          <Rect width={dims.w} height={dims.h} fill="url(#optGrad)" />
        </Svg>
      )}
      <View style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
        <Text
          className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-slate-300'}`}
        >
          {option}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
