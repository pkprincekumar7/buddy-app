import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { EmojiText } from '@/components/ui/EmojiText';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useFocusEntranceAnim } from '@/lib/animations';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import Svg, {
  Path as SvgPath,
  Line as SvgLine,
  Text as SvgText,
  Circle as SvgCircle,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
  Defs,
} from 'react-native-svg';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { MainTabParamList } from '@/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/Button';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { api } from '@/api/client';
import { useLifePathwayData } from '@/hooks/useLifePathwayData';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { GradientIconBox, GradientButton } from '@/components/shared/GradientView';
import {
  TrendingUp,
  Sparkles,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  X,
  Target,
  Award,
} from 'lucide-react-native';

// ---------------------------------------------------------------------------
// Static data (identical to web LifePathway.tsx)
// ---------------------------------------------------------------------------

const areaMilestoneMap: Record<string, { yearOffset: number; text: string }[]> = {
  life_ambition: [
    { yearOffset: 0, text: 'Life ambition clarified' },
    { yearOffset: 3, text: 'Career path explored' },
    { yearOffset: 7, text: 'Purpose solidified' },
  ],
  self_care: [
    { yearOffset: 0, text: 'Self-care habits formed' },
    { yearOffset: 4, text: 'Emotional resilience built' },
    { yearOffset: 8, text: 'Lifelong wellness achieved' },
  ],
  critical_thinking: [
    { yearOffset: 0, text: 'Problem-solving enhanced' },
    { yearOffset: 4, text: 'Analytical thinking mastered' },
    { yearOffset: 9, text: 'Strategic mindset developed' },
  ],
  creativity: [
    { yearOffset: 0, text: 'Creative confidence unlocked' },
    { yearOffset: 5, text: 'Artistic expression flourishing' },
    { yearOffset: 9, text: 'Innovation mindset instilled' },
  ],
  physical_wellness: [
    { yearOffset: 0, text: 'Healthy habits started' },
    { yearOffset: 3, text: 'Physical goals achieved' },
    { yearOffset: 7, text: 'Lifelong fitness culture' },
  ],
  social_skills: [
    { yearOffset: 0, text: 'Communication skills built' },
    { yearOffset: 4, text: 'Leadership emerging' },
    { yearOffset: 8, text: 'Strong social network' },
  ],
};

const areaColors: Record<string, string> = {
  life_ambition: '#8b5cf6',
  self_care: '#ec4899',
  critical_thinking: '#3b82f6',
  creativity: '#f59e0b',
  physical_wellness: '#10b981',
  social_skills: '#7c3aed',
};

const areaBgTw: Record<string, string> = {
  life_ambition: 'bg-violet-500',
  self_care: 'bg-pink-500',
  critical_thinking: 'bg-blue-500',
  creativity: 'bg-amber-400',
  physical_wellness: 'bg-emerald-500',
  social_skills: 'bg-violet-600',
};

function getAreaBoost(area: Record<string, unknown>) {
  const answers = (area['answers'] as Record<string, unknown> | undefined) ?? {};
  const answerCount = Object.values(answers).filter(Boolean).length;
  const aiRecs = area['ai_three_month_recommendations'];
  const recs: unknown[] =
    Array.isArray(aiRecs) && aiRecs.length > 0
      ? aiRecs
      : Array.isArray(area['recommendations'])
      ? (area['recommendations'] as unknown[])
      : [];
  return 5 + answerCount * 0.8 + (recs.length > 0 ? 2 : 0);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Staggered fade-in + slide-up for growth-area insight cards */
function AnimatedInsightCard({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    const delay = 2000 + index * 300;
    const cfg = { duration: 800, easing: Easing.out(Easing.ease) };
    opacity.value = withDelay(delay, withTiming(1, cfg));
    translateY.value = withDelay(delay, withTiming(0, cfg));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

/** Fade + slide-up entrance — wraps modal form & success views */
function AnimatedFadeSlide({ children }: { children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    const cfg = { duration: 500, easing: Easing.out(Easing.ease) };
    opacity.value = withTiming(1, cfg);
    translateY.value = withTiming(0, cfg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

// ---------------------------------------------------------------------------
// Pure-SVG line chart with touch tooltip
// Mirrors web: recharts LineChart + Tooltip (contentStyle dark panel) + Legend
// ---------------------------------------------------------------------------

const TOOLTIP_W = 168; // fixed tooltip width; used for horizontal flip logic

function GrowthLineChart({
  data,
  yKeys,
  colors,
  chartWidth,
  milestoneAgeColorMap,
  seriesNames,
}: {
  data: Array<Record<string, number>>;
  yKeys: string[];
  colors: Record<string, string>;
  chartWidth: number;
  milestoneAgeColorMap: Record<number, string>;
  /** Maps each yKey → display name shown in the tooltip (mirrors recharts Line name prop) */
  seriesNames: Record<string, string>;
}) {
  const PAD = { top: 12, right: 12, bottom: 28, left: 42 };
  const CHART_HEIGHT = 280;
  const innerW = chartWidth - PAD.left - PAD.right;
  const innerH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const Y_MIN = 28;
  const Y_MAX = 108;

  const ages = data.map((d) => d['age'] ?? 0);
  const xMin = Math.min(...ages);
  const xMax = Math.max(...ages);

  const sx = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin)) * innerW;
  const sy = (v: number) => PAD.top + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * innerH;

  const makePath = (key: string) =>
    data
      .map(
        (d, i) =>
          `${i === 0 ? 'M' : 'L'}${sx(d['age'] ?? 0).toFixed(1)},${sy(d[key] ?? 0).toFixed(1)}`,
      )
      .join(' ');

  // ── Touch / tooltip state ────────────────────────────────────────────────
  const [activeAge, setActiveAge] = useState<number | null>(null);

  /** Snap a raw touch X to the nearest data age */
  const snapToAge = useCallback(
    (touchX: number) => {
      const rawAge = xMin + ((touchX - PAD.left) / innerW) * (xMax - xMin);
      return ages.reduce((prev, curr) =>
        Math.abs(curr - rawAge) < Math.abs(prev - rawAge) ? curr : prev,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [xMin, xMax, innerW, ages.join(',')],
  );

  const handleTouchMove = useCallback(
    (x: number) => {
      if (x < PAD.left - 8 || x > PAD.left + innerW + 8) {
        setActiveAge(null);
      } else {
        setActiveAge(snapToAge(x));
      }
    },
    // PAD is a constant-literal object — its values never change, safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapToAge, innerW],
  );

  // Derived tooltip values
  const activePoint = activeAge !== null ? data.find((d) => d['age'] === activeAge) : null;
  const cursorX = activeAge !== null ? sx(activeAge) : 0;
  // Flip tooltip to the left when near the right edge
  const tooltipLeft =
    cursorX + 14 + TOOLTIP_W > chartWidth - PAD.right
      ? cursorX - TOOLTIP_W - 8
      : cursorX + 14;
  const tooltipTop = PAD.top + 4;

  const yTicks = [40, 60, 80, 100];
  const xTicks = data.filter((_, i) => i % 2 === 0);
  const buddy360Keys = yKeys.filter((k) => k !== 'standard');

  return (
    // Outer View must NOT clip overflow so the tooltip can escape the SVG bounds
    <View style={{ width: chartWidth, height: CHART_HEIGHT }}>
      <Svg width={chartWidth} height={CHART_HEIGHT}>
        {/* Grid lines */}
        {yTicks.map((tick) => (
          <SvgLine
            key={`yg${tick}`}
            x1={PAD.left} y1={sy(tick)}
            x2={PAD.left + innerW} y2={sy(tick)}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        ))}
        {/* Frame */}
        <SvgLine
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={PAD.top + innerH}
          stroke="#475569" strokeWidth={1}
        />
        <SvgLine
          x1={PAD.left} y1={PAD.top + innerH}
          x2={PAD.left + innerW} y2={PAD.top + innerH}
          stroke="#475569" strokeWidth={1}
        />
        {/* Y labels */}
        {yTicks.map((tick) => (
          <SvgText
            key={`yl${tick}`}
            x={PAD.left - 5} y={sy(tick) + 3.5}
            fill="#475569" fontSize={9} textAnchor="end"
          >
            {`${tick}%`}
          </SvgText>
        ))}
        {/* X labels */}
        {xTicks.map((d) => (
          <SvgText
            key={`xl${d['age']}`}
            x={sx(d['age'] ?? 0)} y={PAD.top + innerH + 16}
            fill="#475569" fontSize={9} textAnchor="middle"
          >
            {String(d['age'])}
          </SvgText>
        ))}
        {/* Lines */}
        {yKeys.map((key) => (
          <SvgPath
            key={key}
            d={makePath(key)}
            stroke={colors[key] ?? '#10b981'}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {/* Small dots on all data points */}
        {yKeys.map((key) =>
          data.map((d) => {
            const age = d['age'] ?? 0;
            const yVal = d[key];
            if (yVal === undefined) return null;
            return (
              <SvgCircle
                key={`rdot-${key}-${age}`}
                cx={sx(age)} cy={sy(yVal)}
                r={4}
                fill={colors[key] ?? '#10b981'}
              />
            );
          }),
        )}
        {/* Milestone dots (larger, colored, white stroke) */}
        {buddy360Keys.map((key) =>
          data.map((d) => {
            const age = d['age'] ?? 0;
            const dotColor = milestoneAgeColorMap[age];
            const yVal = d[key];
            if (!dotColor || yVal === undefined) return null;
            return (
              <SvgCircle
                key={`mdot-${key}-${age}`}
                cx={sx(age)} cy={sy(yVal)}
                r={7}
                fill={dotColor}
                stroke="white"
                strokeWidth={2}
              />
            );
          }),
        )}
        {/* Active cursor line — vertical dashed line at the touched age */}
        {activeAge !== null && (
          <SvgLine
            x1={cursorX} y1={PAD.top}
            x2={cursorX} y2={PAD.top + innerH}
            stroke="rgba(255,255,255,0.30)"
            strokeWidth={1.5}
            strokeDasharray="4,4"
          />
        )}
        {/* Highlight dots at cursor age — larger ring to call attention */}
        {activePoint &&
          yKeys.map((key) => {
            const yVal = activePoint[key];
            if (yVal === undefined) return null;
            return (
              <SvgCircle
                key={`hi-${key}`}
                cx={cursorX} cy={sy(yVal)}
                r={6}
                fill={colors[key] ?? '#10b981'}
                stroke="white"
                strokeWidth={2}
              />
            );
          })}
      </Svg>

      {/* ── Touch capture overlay — transparent, sits on top of SVG ── */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, width: chartWidth, height: CHART_HEIGHT }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => handleTouchMove(e.nativeEvent.locationX)}
        onResponderMove={(e) => handleTouchMove(e.nativeEvent.locationX)}
        onResponderRelease={() => setActiveAge(null)}
        onResponderTerminate={() => setActiveAge(null)}
      />

      {/* ── Tooltip — mirrors web recharts Tooltip contentStyle ── */}
      {activePoint && activeAge !== null && (
        <View
          style={{
            position: 'absolute',
            top: tooltipTop,
            left: tooltipLeft,
            width: TOOLTIP_W,
            backgroundColor: '#1a1a1a',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 12,
            zIndex: 20,
            // Subtle shadow to lift above chart
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 8,
            elevation: 8,
          }}
        >
          {/* Title — "Age X" */}
          <Text
            style={{
              color: '#e2e8f0',
              fontSize: 11,
              fontWeight: '600',
              marginBottom: 6,
            }}
          >
            Age {activeAge}
          </Text>
          {/* One row per series — color swatch · name · value% */}
          {yKeys.map((key) => {
            const val = activePoint[key];
            if (val === undefined) return null;
            return (
              <View
                key={key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colors[key] ?? '#10b981',
                    flexShrink: 0,
                  }}
                />
                <Text
                  style={{ color: '#94a3b8', fontSize: 10, flex: 1 }}
                  numberOfLines={1}
                >
                  {seriesNames[key] ?? key}
                </Text>
                <Text style={{ color: '#e2e8f0', fontSize: 11, fontWeight: '600' }}>
                  {val}%
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type LifePathwayNavigationProp = StackNavigationProp<MainTabParamList>;

export default function LifePathwayScreen() {
  const navigation = useNavigation<LifePathwayNavigationProp>();

  const { activeChildId: childId } = useAuth();
  const { user } = useAuth();
  const { childData, profile, isLoading, completedAreas, savedConcern, setSavedConcern } =
    useLifePathwayData(childId);
  const childName = (childData?.['name'] as string | undefined) ?? '';

  const [showConcernModal, setShowConcernModal] = useState(false);
  const [concernInput, setConcernInput] = useState('');
  const [concernSubmitted, setConcernSubmitted] = useState(false);

  const closeConcernModal = useCallback(() => {
    setShowConcernModal(false);
    setConcernSubmitted(false);
    setConcernInput('');
  }, []);

  const handleStartJourney = () => {
    if (savedConcern) {
      navigation.navigate('Goals');
      return;
    }
    setShowConcernModal(true);
  };

  const handleConcernSubmit = useCallback(async () => {
    const activeChildId = childData?.['id'] as string | undefined;
    if (!concernInput.trim() || !activeChildId) return;
    try {
      await api.goals.patch(activeChildId, { parent_concern: concernInput.trim() });
      setSavedConcern(concernInput.trim());
    } catch (err) {
      console.warn('[LifePathway] Could not persist concern, proceeding anyway:', err);
    }
    setConcernSubmitted(true);
  }, [childData, concernInput, setSavedConcern]);

  const handleProceedToDashboard = () => {
    closeConcernModal();
    navigation.navigate('Goals');
  };

  const handleBack = () =>
    (navigation as unknown as { navigate: (name: string, params?: unknown) => void }).navigate(
      'Growth',
      { screen: 'GrowthAreas', params: { fromBack: true } },
    );

  const strengths = useMemo(
    () =>
      (profile?.top_strengths as string[] | undefined) ?? [
        'Creative problem solver',
        'Strong leadership qualities',
        'Excellent communication skills',
      ],
    [profile],
  );

  const currentAge = useMemo(
    () =>
      parseInt(String((childData?.['age'] as string | number | null | undefined) ?? '')) || 10,
    [childData],
  );

  const journeyData = useMemo(
    () =>
      Array.from({ length: 11 }, (_, i) => {
        const age = currentAge + i;
        const point: Record<string, number | string> = {
          age,
          year: `Age ${age}`,
          standard: Math.min(40 + i * 4, 100),
        };
        if (completedAreas.length > 0) {
          completedAreas.forEach((area) => {
            const boost = getAreaBoost(area);
            const areaId = area['area_id'];
            if (areaId)
              point[areaId] = Math.min(Math.round(40 + i * boost + i * i * 0.25), 100);
          });
        } else {
          point['buddy360'] = Math.min(Math.round(40 + i * 6.5 + i * i * 0.3), 100);
        }
        return point;
      }),
    [completedAreas, currentAge],
  );

  const standardMilestones = useMemo(
    () => [
      { age: currentAge, text: 'Basic education foundation' },
      { age: currentAge + 3, text: 'Intermediate skills developed' },
      { age: currentAge + 6, text: 'Advanced academic progress' },
      { age: currentAge + 10, text: 'College preparation' },
    ],
    [currentAge],
  );

  const buddy360Milestones = useMemo(
    () =>
      completedAreas.length > 0
        ? completedAreas
            .flatMap((area) => {
              const areaId = area.area_id as string | undefined;
              const areaName = area.area_name as string | undefined;
              const milestones = (areaId ? areaMilestoneMap[areaId] : undefined) ?? [];
              return milestones.map((m) => ({
                age: currentAge + m.yearOffset,
                text: m.text,
                area: areaName ?? '',
                color: (areaId ? areaColors[areaId] : undefined) ?? '#10b981',
              }));
            })
            .sort((a, b) => a.age - b.age)
        : [
            { age: currentAge, text: 'Personalized profile created', area: 'Core', color: '#10b981' },
            { age: currentAge + 1, text: 'Core strengths identified & enhanced', area: 'Core', color: '#10b981' },
            { age: currentAge + 2, text: 'Weekly missions mastered', area: 'Core', color: '#10b981' },
            { age: currentAge + 5, text: 'Multiple talents developed', area: 'Core', color: '#10b981' },
            { age: currentAge + 7, text: 'Character strengths solidified', area: 'Core', color: '#10b981' },
            { age: currentAge + 10, text: 'Ready for exceptional future', area: 'Core', color: '#10b981' },
          ],
    [completedAreas, currentAge],
  );

  // Maps age → first milestone color — used for chart dots (mirrors web milestoneAgeColorMap)
  const milestoneAgeColorMap = useMemo(
    () =>
      buddy360Milestones.reduce<Record<number, string>>((acc, m) => {
        acc[m.age] ??= m.color;
        return acc;
      }, {}),
    [buddy360Milestones],
  );

  const [showSplash, startTimer] = useStageSplash();

  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );

  // Section entrance animations — mirrors web slideUp(0.1 / 0.8 / 1.6 / 1.8)
  const ready = !isLoading && !showSplash;
  const contentStyle  = useFocusEntranceAnim(ready, 0,    800);
  const headerAnim    = useFocusEntranceAnim(ready, 100,  800);
  const chartAnim     = useFocusEntranceAnim(ready, 800,  800);
  const insightsAnim  = useFocusEntranceAnim(ready, 1600, 800);
  const ctaAnim       = useFocusEntranceAnim(ready, 1800, 800);

  const { width: screenWidth } = useWindowDimensions();
  // card has 16px page padding + 24px card padding on each side → subtract 80
  const chartWidth = Math.max(screenWidth - 80, 200);

  const chartColors = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = { standard: '#94a3b8', buddy360: '#10b981' };
    completedAreas.forEach((a) => {
      const id = a.area_id as string | undefined;
      if (id) m[id] = areaColors[id] ?? '#10b981';
    });
    return m;
  }, [completedAreas]);

  const chartYKeys = useMemo<string[]>(() => {
    if (completedAreas.length === 0) return ['standard', 'buddy360'];
    return ['standard', ...completedAreas.map((a) => String(a.area_id ?? '')).filter(Boolean)];
  }, [completedAreas]);

  // Series display names — mirrors web recharts Line name props exactly
  const seriesNames = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {
      standard: 'Standard Journey',
      buddy360: 'Buddy360 Journey',
    };
    completedAreas.forEach((a) => {
      const id = a.area_id as string | undefined;
      if (id) m[id] = `${String(a.area_name ?? '')} (Buddy360)`;
    });
    return m;
  }, [completedAreas]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#14b8a6" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={contentStyle} className="flex-1 bg-background">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 48, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <Animated.View style={headerAnim} className="mb-8 items-center gap-4">
            {/* Gradient icon box — mirrors web glow-teal-sm bg-gradient-to-br from-teal-400 to-teal-600 */}
            <View style={{ marginBottom: 8 }}>
              <GradientIconBox from="#2dd4bf" to="#0d9488" size={64} radius={16} diagonal>
                <TrendingUp size={32} color="white" />
              </GradientIconBox>
            </View>
            <Text className="text-3xl font-bold tracking-tight text-white text-center">
              Take a look at {childName}'s life journey planned and powered by Buddy360
            </Text>
            {completedAreas.length > 0 && (
              <View className="flex-row flex-wrap justify-center gap-2 pt-2">
                {completedAreas.map((area) => {
                  const areaId = area.area_id as string | undefined;
                  const bgTw = (areaId ? areaBgTw[areaId] : undefined) ?? 'bg-emerald-500';
                  return (
                    <View
                      key={(area.area_id ?? area.area_name) as string}
                      className={`flex-row items-center gap-1.5 rounded-full px-3 py-1 ${bgTw}`}
                    >
                      {/* CheckCircle mirrors web <CheckCircle className="h-3.5 w-3.5"> */}
                      <CheckCircle size={14} color="white" />
                      <Text className="text-sm font-medium text-white">
                        {area.area_name as string}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </Animated.View>

          {/* ── 10-Year Growth Journey Chart Card ──────────────────────────── */}
          <Animated.View
            style={[chartAnim, { borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }]}
            className="rounded-2xl bg-card p-6 mb-6"
          >
            <View className="mb-6 items-center">
              <Text className="mb-2 text-2xl font-bold tracking-tight text-white text-center">
                10-Year Growth Journey Comparison
              </Text>
              <Text className="text-slate-400 text-center">
                See how {childName}'s development accelerates with Buddy360
                {completedAreas.length > 0 &&
                  ` across ${completedAreas.length} growth area${completedAreas.length > 1 ? 's' : ''}`}
              </Text>
            </View>

            {/* SVG line chart with touch tooltip */}
            <View className="mb-4">
              <GrowthLineChart
                data={journeyData as Array<Record<string, number>>}
                yKeys={chartYKeys}
                colors={chartColors}
                chartWidth={chartWidth}
                milestoneAgeColorMap={milestoneAgeColorMap}
                seriesNames={seriesNames}
              />
            </View>

            {/* Chart legend — mirrors web recharts <Legend> */}
            <View className="mb-6 flex-row flex-wrap gap-x-4 gap-y-2">
              <View className="flex-row items-center gap-2">
                <View className="h-0.5 w-6 bg-slate-400" />
                <Text className="text-xs text-slate-500">Standard Journey</Text>
              </View>
              {completedAreas.length > 0
                ? completedAreas.map((area) => {
                    const areaId = area.area_id as string | undefined;
                    const lineColor = (areaId ? areaColors[areaId] : undefined) ?? '#10b981';
                    return (
                      <View key={String(areaId)} className="flex-row items-center gap-2">
                        <View className="h-0.5 w-6" style={{ backgroundColor: lineColor }} />
                        <Text className="text-xs text-slate-500">
                          {String(area.area_name ?? '')} (Buddy360)
                        </Text>
                      </View>
                    );
                  })
                : (
                  <View className="flex-row items-center gap-2">
                    <View className="h-0.5 w-6 bg-teal-400" />
                    <Text className="text-xs text-slate-500">Buddy360 Journey</Text>
                  </View>
                )}
            </View>

            {/* Milestone Legend — mirrors web border-edge-faint bg-surface-elevated, 2-col grid */}
            {buddy360Milestones.length > 0 && (
              <View
                style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}
                className="rounded-xl bg-surface-elevated p-4 mb-6"
              >
                <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
                  ● Milestone markers on the Buddy360 line
                </Text>
                {/* 2-column flex-wrap layout mirrors web grid-cols-2 */}
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {buddy360Milestones.map((m) => (
                    <View
                      key={`${m.age}-${m.text}`}
                      className="flex-row items-center gap-2"
                      style={{ width: '47%' }}
                    >
                      <View
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: m.color }}
                      />
                      <Text className="w-14 flex-shrink-0 text-xs font-medium text-slate-300">
                        Age {m.age}
                      </Text>
                      <Text className="flex-1 text-xs text-slate-400" numberOfLines={2}>
                        {m.text}
                      </Text>
                      {m.area !== 'Core' && (
                        <View
                          className="flex-shrink-0 rounded-full px-1.5 py-0.5"
                          style={{ backgroundColor: m.color }}
                        >
                          <Text className="text-xs text-white">{m.area}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Journey Details — mirrors web grid md:grid-cols-2 (stacked on mobile) */}
            <View className="gap-6">
              {/* ── Standard Life Journey ── */}
              <View className="gap-4">
                <View className="mb-4 flex-row items-center gap-2">
                  {/* bg-ghost-strong equivalent: translucent white */}
                  <View
                    className="h-8 w-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                  >
                    <Text className="text-sm font-bold text-slate-300">1</Text>
                  </View>
                  <Text className="text-lg font-bold text-white">Standard Life Journey</Text>
                </View>

                {/* Analysis card */}
                <View
                  style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}
                  className="rounded-xl bg-surface-elevated p-4"
                >
                  <View className="flex-row items-center gap-2 mb-2">
                    <Sparkles size={16} color="#94a3b8" />
                    <Text className="text-sm font-semibold text-white">The Analysis</Text>
                  </View>
                  <Text className="text-sm text-slate-400">
                    {(profile?.summary as string | undefined) ??
                      `${childName} shows natural growth through standard educational pathways with typical developmental milestones.`}
                  </Text>
                </View>

                {/* Key Milestones card */}
                <View
                  style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}
                  className="rounded-xl bg-surface-elevated p-4"
                >
                  <View className="flex-row items-center gap-2 mb-3">
                    <Target size={16} color="#94a3b8" />
                    <Text className="text-sm font-semibold text-white">Key Milestones</Text>
                  </View>
                  <View className="gap-2.5">
                    {standardMilestones.map((milestone) => (
                      <View key={milestone.text} className="flex-row items-start gap-3">
                        <Text className="w-14 flex-shrink-0 text-xs font-medium text-slate-500">
                          Age {milestone.age}
                        </Text>
                        <Text className="flex-1 text-xs text-slate-400">{milestone.text}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>

              {/* ── Buddy360 Journey ── */}
              <View className="gap-4">
                <View className="mb-4 flex-row items-center gap-2">
                  {/* Gradient badge — mirrors web bg-gradient-to-br from-teal-500 to-teal-700 */}
                  <GradientIconBox from="#14b8a6" to="#0f766e" size={32} radius={16} diagonal>
                    <Text className="text-sm font-bold text-white">2</Text>
                  </GradientIconBox>
                  <Text className="text-lg font-bold text-white">
                    {childName}'s Journey with Buddy360
                  </Text>
                </View>

                {/* Analysis teal card */}
                <View className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-4">
                  <View className="flex-row items-center gap-2 mb-2">
                    <Sparkles size={16} color="#2dd4bf" />
                    <Text className="text-sm font-semibold text-teal-400">Analysis</Text>
                  </View>
                  <Text className="text-sm text-slate-400">
                    {(profile?.summary as string | undefined) ??
                      `${childName} experiences accelerated holistic growth through personalized guidance, targeted skill development, and continuous support.`}
                    {completedAreas.length > 0 &&
                      ` Development is boosted across ${completedAreas.map((a) => a.area_name).join(', ')}.`}
                  </Text>
                </View>

                {/* Strengths teal card */}
                <View className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-4">
                  <Text className="mb-2 text-sm font-semibold text-teal-400">
                    Strengths Improvised by Buddy360
                  </Text>
                  <View className="gap-1.5">
                    {strengths.map((strength) => (
                      <View key={strength} className="flex-row items-start gap-2">
                        <Text className="mt-0.5 text-teal-400">✓</Text>
                        <Text className="flex-1 text-sm text-slate-400">{strength}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Accomplishments teal card */}
                <View className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-4">
                  <View className="flex-row items-center gap-2 mb-3">
                    <Award size={16} color="#2dd4bf" />
                    <Text className="text-sm font-semibold text-teal-400">
                      Accomplishments & Milestones
                    </Text>
                  </View>
                  <View className="gap-2.5">
                    {buddy360Milestones.map((milestone) => (
                      <View
                        key={`${milestone.age}-${milestone.text}`}
                        className="flex-row items-start gap-3"
                      >
                        <Text className="w-14 flex-shrink-0 text-xs font-medium text-teal-500">
                          Age {milestone.age}
                        </Text>
                        <Text className="flex-1 text-xs font-medium text-slate-300">
                          {milestone.text}
                        </Text>
                        {milestone.area !== 'Core' && (
                          <View
                            className="flex-shrink-0 self-start rounded-full px-1.5 py-0.5"
                            style={{ backgroundColor: milestone.color }}
                          >
                            <Text className="text-xs text-white">{milestone.area}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          </Animated.View>

          {/* ── Per-Growth-Area Detail Sections ───────────────────────────── */}
          {completedAreas.length > 0 && (
            <Animated.View style={insightsAnim} className="gap-4 mb-6">
              <Text className="text-2xl font-bold tracking-tight text-white">
                Growth Area Insights
              </Text>
              <Text className="text-slate-400">
                Recommendations for each area for {childName}
              </Text>

              {completedAreas.map((area, idx) => {
                const areaId = area.area_id as string | undefined;
                const bgTw = (areaId ? areaBgTw[areaId] : undefined) ?? 'bg-emerald-500';
                const recs: unknown[] =
                  Array.isArray(area.ai_three_month_recommendations) &&
                  (area.ai_three_month_recommendations as unknown[]).length > 0
                    ? (area.ai_three_month_recommendations as unknown[])
                    : Array.isArray(area.recommendations)
                    ? (area.recommendations as unknown[])
                    : [];
                return (
                  <AnimatedInsightCard
                    key={(area.area_id ?? idx) as string | number}
                    index={idx}
                  >
                    <View
                      style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
                      className="rounded-2xl bg-card p-6"
                    >
                      <View className="mb-4 flex-row items-center gap-3">
                        <View
                          className={`h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${bgTw}`}
                        >
                          <Text className="font-bold text-white">{idx + 1}</Text>
                        </View>
                        <Text className="flex-1 text-lg font-bold text-white">
                          {area.area_name as string}
                        </Text>
                        <View className={`rounded-full px-2 py-0.5 ${bgTw}`}>
                          <Text className="text-xs font-medium text-white">Completed</Text>
                        </View>
                      </View>

                      {recs.length > 0 ? (
                        <View>
                          <Text className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                            3-Month Recommendations
                          </Text>
                          <View className="gap-2">
                            {recs.map((rec, i) => (
                              <View
                                key={`${(area.area_id ?? idx) as string | number}-${i}`}
                                className="flex-row items-start gap-2"
                              >
                                <View
                                  className={`mt-0.5 h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${bgTw}`}
                                >
                                  <Text className="text-xs font-bold text-white">{i + 1}</Text>
                                </View>
                                <Text className="flex-1 text-sm text-slate-400">{String(rec)}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ) : (
                        <Text className="text-sm italic text-slate-600">
                          No recommendations generated for this area yet.
                        </Text>
                      )}
                    </View>
                  </AnimatedInsightCard>
                );
              })}
            </Animated.View>
          )}

          {/* ── Welcome CTA ────────────────────────────────────────────────── */}
          <Animated.View style={ctaAnim} className="items-center gap-6">
            {childName ? (
              <View
                style={{ borderWidth: 1, borderColor: 'rgba(251,191,36,0.20)' }}
                className="w-full rounded-2xl bg-card p-8 items-center"
              >
                {/* Sparkles icons flank the 🎉 — mirrors web Sparkles + 🎉 + Sparkles */}
                <View className="flex-row items-center justify-center gap-3 mb-4">
                  <Sparkles size={24} color="#fbbf24" />
                  <EmojiText size="3xl">🎉</EmojiText>
                  <Sparkles size={24} color="#fbbf24" />
                </View>
                <Text className="text-xl font-bold leading-relaxed text-white text-center">
                  Welcome{' '}
                  <Text className="text-teal-400">
                    {(user?.full_name as string | undefined)?.split(' ')[0] ?? 'Parent'}
                  </Text>{' '}
                  and <Text className="text-emerald-400">{childName}</Text> to Buddy360. We look
                  forward to powering up your life in all possible dimensions.
                </Text>
              </View>
            ) : null}

            <Text className="mt-2 text-sm text-slate-500 text-center">
              Click below to continue this interesting journey with Buddy360.
            </Text>

            {/* Page Actions — mirrors web PageActions left/center/right */}
            <PageActions
              className="pt-4 pb-8"
              left={
                <Button
                  variant="outline"
                  onPress={handleBack}
                  className="h-11 w-full rounded-2xl px-6"
                >
                  <View className="flex-row items-center gap-1.5">
                    <ChevronLeft size={16} color="#cbd5e1" />
                    <Text className="text-sm font-medium text-slate-300">Back</Text>
                  </View>
                </Button>
              }
              center={<StartOverButton childId={childId ?? undefined} className="w-full" />}
              right={
                <GradientButton
                  from="#14b8a6"
                  to="#059669"
                  height={44}
                  borderRadius={16}
                  onPress={handleStartJourney}
                  style={{ width: '100%' }}
                >
                  <View className="flex-row items-center gap-2">
                    <Text className="font-semibold text-[#0a0a0a]">Continue Journey</Text>
                    <ChevronRight size={16} color="#0a0a0a" />
                  </View>
                </GradientButton>
              }
            />
          </Animated.View>
        </ScrollView>

        {/* ── Concern Modal ─────────────────────────────────────────────────── */}
        <Modal
          visible={showConcernModal}
          animationType="fade"
          transparent
          onRequestClose={closeConcernModal}
        >
          <Pressable
            className="flex-1 items-center justify-center bg-black/70 p-4"
            onPress={closeConcernModal}
          >
            <Pressable
              className="relative w-full max-w-lg rounded-2xl bg-surface-elevated p-8 pt-12"
              style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}
              onPress={(e) => e.stopPropagation()}
            >
              {/* Close button — mirrors web <X className="h-5 w-5"> */}
              <Pressable
                onPress={closeConcernModal}
                accessibilityLabel="Close dialog"
                className="absolute right-4 top-4 rounded-xl p-2"
              >
                <X size={20} color="#64748b" />
              </Pressable>

              {!concernSubmitted ? (
                <AnimatedFadeSlide key="form">
                  <View className="gap-5">
                    <View className="mb-2 flex-row items-center gap-3">
                      {/* Gradient icon — mirrors web glow-teal-sm from-teal-400 to-teal-600 */}
                      <GradientIconBox from="#2dd4bf" to="#0d9488" size={44} radius={12} diagonal>
                        <Sparkles size={20} color="white" />
                      </GradientIconBox>
                      <View>
                        <Text className="text-lg font-bold text-white">One last thing!</Text>
                        <Text className="text-sm text-slate-500">Buddy360 wants to know</Text>
                      </View>
                    </View>
                    <Text className="text-base leading-relaxed text-slate-300">
                      Hey{' '}
                      <Text className="font-semibold text-teal-400">
                        {(user?.full_name as string | undefined)?.split(' ')[0] ?? 'there'}
                      </Text>
                      , is there anything that you want Buddy360 to work on currently with respect
                      to{' '}
                      <Text className="font-semibold text-emerald-400">{childName}</Text>?
                    </Text>
                    <TextareaWithVoice
                      value={concernInput}
                      onChange={(e) => setConcernInput(e.target.value)}
                      placeholder={`e.g., I want to improve English speaking skills for ${childName}.`}
                      className="min-h-[120px] w-full rounded-xl"
                    />
                    <View className="flex-row gap-3">
                      <Button
                        variant="outline"
                        onPress={handleProceedToDashboard}
                        className="flex-1 h-11 rounded-xl"
                      >
                        <Text className="text-slate-300">Skip for now</Text>
                      </Button>
                      {/* Gradient submit — mirrors web btn-primary */}
                      <GradientButton
                        from="#14b8a6"
                        to="#059669"
                        height={44}
                        borderRadius={12}
                        disabled={!concernInput.trim()}
                        onPress={() => { void handleConcernSubmit(); }}
                        style={{ flex: 1 }}
                      >
                        <View className="flex-row items-center gap-1.5">
                          <Text className="font-semibold text-[#0a0a0a]">Submit</Text>
                          <ChevronRight size={16} color="#0a0a0a" />
                        </View>
                      </GradientButton>
                    </View>
                  </View>
                </AnimatedFadeSlide>
              ) : (
                <AnimatedFadeSlide key="success">
                  <View className="items-center gap-6">
                    {/* Gradient success circle — mirrors web from-emerald-400 to-teal-500 */}
                    <View
                      style={{
                        width: 56, height: 56, borderRadius: 28,
                        overflow: 'hidden', alignSelf: 'center',
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Svg width={56} height={56} style={{ position: 'absolute' }}>
                        <Defs>
                          <SvgLinearGradient id="successGrad" x1="0" y1="0" x2="1" y2="1">
                            <Stop offset="0%" stopColor="#34d399" />
                            <Stop offset="100%" stopColor="#14b8a6" />
                          </SvgLinearGradient>
                        </Defs>
                        <Rect width={56} height={56} fill="url(#successGrad)" />
                      </Svg>
                      <Text style={{ fontSize: 24, zIndex: 1 }}>✅</Text>
                    </View>
                    <View className="items-center">
                      <Text className="mb-2 text-lg font-bold text-white">Got it!</Text>
                      <Text className="text-center leading-relaxed text-slate-400">
                        I got that. We will work with{' '}
                        <Text className="font-semibold text-emerald-400">{childName}</Text> on the
                        same.
                      </Text>
                    </View>
                    {/* Gradient go-to-dashboard — mirrors web btn-primary */}
                    <GradientButton
                      from="#14b8a6"
                      to="#059669"
                      height={44}
                      borderRadius={12}
                      onPress={handleProceedToDashboard}
                      style={{ width: '100%' }}
                    >
                      <View className="flex-row items-center gap-2">
                        <Text className="font-semibold text-[#0a0a0a]">Go to Dashboard</Text>
                        <ChevronRight size={16} color="#0a0a0a" />
                      </View>
                    </GradientButton>
                  </View>
                </AnimatedFadeSlide>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      </Animated.View>

      {showSplash && <StageSplash stage={4} onReady={startTimer} />}
    </View>
  );
}
