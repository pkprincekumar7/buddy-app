import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  Text,
  ActivityIndicator,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSlideUpWhenReady } from '@/lib/animations';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import { ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';
import { areaByUrlName } from '@/lib/growthAreaData';
import ChildActivityGame, {
  normalizeChildGameRecommendations,
} from '@/components/onboarding/ChildActivityGame';
import { useJob } from '@/hooks/useJob';
import {
  GradientIconBox,
  areaGrad,
} from '@/components/shared/GradientView';
import type { GrowthStackParamList } from '@/navigation';

type GrowthNavProp = StackNavigationProp<
  GrowthStackParamList,
  'GrowthAreasActivityGame'
>;
type GrowthRouteProp = RouteProp<
  GrowthStackParamList,
  'GrowthAreasActivityGame'
>;

export default function GrowthAreasActivityGameScreen() {
  const navigation = useNavigation<GrowthNavProp>();
  const { colors } = useTheme();
  const route = useRoute<GrowthRouteProp>();
  const { activityId } = route.params as { activityId: string };
  const {
    activeChildId,
    isAuthenticated,
    isLoading: isLoadingAuth,
  } = useAuth();

  const area = areaByUrlName(activityId ?? '');

  const [childName, setChildName] = useState('');
  const [childData, setChildData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savedAnswers, setSavedAnswers] = useState<Record<string, unknown>>({});
  const [hydrated, setHydrated] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const pendingSelectionsRef = useRef<string[]>([]);
  const handleGameCompleteRef = useRef<
    (result: Record<string, unknown>) => Promise<void>
  >(async () => {});

  const contentStyle = useSlideUpWhenReady(!isLoadingAuth && hydrated);

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
        setChildData(child as Record<string, unknown>);

        const completedData = await api.completedGrowthAreas.list(child.id);
        if (cancelled) return;
        const allDocs = completedData.areas ?? [];
        const areaDoc = allDocs.find(a => a.area_id === area.id);
        const childActivity = areaDoc?.child_activity;
        const saved =
          (childActivity?.selections as string[] | undefined) ??
          areaDoc?.child_activity_selections ??
          [];
        if (Array.isArray(saved) && saved.length > 0) setSelectedIds(saved);
        const ia = areaDoc?.interactive_answers;
        if (ia) setSavedAnswers(ia);
      } catch (err) {
        console.warn('[GrowthAreasActivityGameScreen] Load failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isLoadingAuth,
    isAuthenticated,
    activeChildId,
    activityId,
    area,
    navigation,
  ]);

  const handleSelectedIdsChange = useCallback(
    async (ids: string[]) => {
      if (!activeChildId || !area) return;
      try {
        await api.completedGrowthAreas.append(activeChildId, {
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          answers: savedAnswers,
          status: 'in_progress',
          step: 'activity_summary',
          child_activity_selections: ids,
        });
      } catch {
        /* non-fatal */
      }
    },
    [activeChildId, area, savedAnswers],
  );

  const finalizeActivity = useCallback(async () => {
    if (!activeChildId || !area) return;
    setIsFinalizing(true);
    try {
      const completedData = await api.completedGrowthAreas.list(activeChildId);
      const areaDoc = (completedData.areas ?? []).find(
        a => a.area_id === area.id,
      );
      const pendingResult = areaDoc?.pending_child_activity as
        | Record<string, unknown>
        | undefined;
      if (pendingResult) {
        const recommendations =
          normalizeChildGameRecommendations(pendingResult);
        await handleGameCompleteRef.current({
          selections: pendingSelectionsRef.current,
          recommendations,
        });
      }
    } catch (err) {
      console.error(
        '[GrowthAreasActivityGameScreen] finalizeActivity failed:',
        err,
      );
      toast.error('Could not finalise game results. Please try again.');
    }
  }, [activeChildId, area]);

  const job = useJob({
    activeJobs: childData?.active_jobs as Record<string, string> | undefined,
    jobType: 'generate_activity',
    onCompleted: finalizeActivity,
  });
  const { enqueue: jobEnqueue } = job;

  const handleSubmitIds = useCallback(
    async (ids: string[], prompt: string, schema: Record<string, unknown>) => {
      if (!activeChildId || !area) return;
      pendingSelectionsRef.current = ids;
      try {
        await api.completedGrowthAreas.append(activeChildId, {
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          answers: savedAnswers,
          status: 'in_progress',
          step: 'activity_summary',
          child_activity_selections: ids,
        });
        await jobEnqueue({
          type: 'generate_activity',
          child_id: activeChildId,
          payload: { prompt, response_json_schema: schema },
          write_back: {
            collection: 'growth_areas',
            filter: { area_id: area.id },
            field: 'pending_child_activity',
          },
        });
      } catch (err) {
        console.error(
          '[GrowthAreasActivityGameScreen] handleSubmitIds failed:',
          err,
        );
        toast.error('Could not start recommendations. Please try again.');
        throw err;
      }
    },
    [activeChildId, area, savedAnswers, jobEnqueue],
  );

  const handleGameComplete = useCallback(
    async (result: Record<string, unknown>) => {
      if (!activeChildId || !area) return;
      try {
        await api.completedGrowthAreas.append(activeChildId, {
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          answers: savedAnswers,
          status: 'in_progress',
          step: 'activity_summary',
          child_activity: {
            selections: result.selections ?? [],
            results: result.recommendations ?? null,
          },
          child_activity_selections: result.selections ?? [],
        });
      } catch (err) {
        console.error('[GrowthAreasActivityGameScreen] Save failed:', err);
        toast.error(
          'Could not save game results. Try again or check your connection.',
        );
        return;
      }
      navigation.navigate('GrowthAreasGreatInsights', { activityId });
    },
    [activeChildId, area, activityId, navigation, savedAnswers],
  );
  handleGameCompleteRef.current = handleGameComplete;

  // Derive child personalisation fields from the loaded child document.
  const childAge = useMemo(
    () => (childData?.age as string | number | null | undefined) ?? null,
    [childData],
  );
  const childGender = useMemo(
    () => (childData?.gender as string | null | undefined) ?? null,
    [childData],
  );

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

  if (!area) {
    return null;
  }

  const Icon = area.icon;

  return (
    <Animated.View
      style={[contentStyle, { backgroundColor: colors.background }]}
      className="flex-1"
    >
      {/* Area header */}
      <View
        className="border-b px-4 py-3"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <View className="flex-row items-center gap-3">
          <GradientIconBox
            from={areaGrad(area.color).from}
            to={areaGrad(area.color).to}
            size={36}
            radius={12}
            diagonal
          >
            <Icon size={20} color={colors.primaryForeground} />
          </GradientIconBox>
          <Text
            className="text-sm font-semibold"
            style={{ color: colors.text }}
          >
            {area.name} — Activity
          </Text>
        </View>
      </View>

      <ChildActivityGame
        areaId={area.id}
        activeChildId={activeChildId ?? undefined}
        childName={childName}
        childAge={childAge}
        childGender={childGender}
        selectedIds={selectedIds}
        onSelectedIdsChange={(newIds) => {
          setSelectedIds(newIds);
          void handleSelectedIdsChange(newIds);
        }}
        onSubmitIds={handleSubmitIds}
        onComplete={handleGameComplete}
        isExternallyLoading={job.isLoading || isFinalizing}
        footerExtra={
          <Button
            variant="outline"
            onPress={() => navigation.goBack()}
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
      />
    </Animated.View>
  );
}
