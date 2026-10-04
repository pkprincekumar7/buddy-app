import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import PageScroll from '@/components/layout/PageScroll';
import StageSplash from '@/components/shared/StageSplash';
import Spinner from '@/components/shared/Spinner';
import StartJourneyModal from '@/components/lifepathway/StartJourneyModal';
import ChartSection from '@/components/lifePathwayPage/ChartSection';
import CompareSection from '@/components/lifePathwayPage/CompareSection';
import CtaSection from '@/components/lifePathwayPage/CtaSection';
import HeroSection from '@/components/lifePathwayPage/HeroSection';
import NinetyDaySection from '@/components/lifePathwayPage/NinetyDaySection';
import SuperpowerSection from '@/components/lifePathwayPage/SuperpowerSection';
import { LP_PALETTE } from '@/components/lifePathwayPage/palette';
import { CYAN, IS_MOBILE } from '@/components/lifePathwayPage/styles';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useLifePathwayData } from '@/hooks/useLifePathwayData';
import { useLifePathwayArea } from '@/hooks/useLifePathwayArea';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import { useParams } from '@/lib/router';
import {
  GROWTH_AREAS,
  copyTokensFor,
  fillTemplate,
  normalizeRecommendations,
} from '@/lib/growthAreaData';
import type { GrowthArea } from '@/lib/growthAreaData';
import {
  AGE_OFFSETS,
  AREA_HEX,
  ARCHETYPE_SUPERPOWER,
  CORE_MILESTONES,
  DEFAULT_SUPERPOWER,
  FALLBACK_MILESTONES,
  FALLBACK_MONTH_MOVES,
  NEUTRAL_HUE,
  NEUTRAL_YS,
  deriveAreaYs,
  mergeMilestones,
} from '@/lib/lifePathwayData';
import type { Milestone } from '@/lib/lifePathwayData';
import { css } from '@/theme';
import type { CompletedArea } from '@/types/api';

/** Root background (radial layers; the final solid layer is the background color). */
const ROOT_BG_IMAGE = css(
  `radial-gradient(ellipse at 70% -10%,rgb(var(--constellation-gold-rgb) / .13),rgb(var(--constellation-navy-deepest-rgb) / 0) 52%),radial-gradient(ellipse at 12% 30%,rgb(var(--constellation-cyan-bright-rgb) / .14),rgb(var(--constellation-navy-deepest-rgb) / 0) 50%),radial-gradient(ellipse at 20% 95%,${LP_PALETTE.violetGlow},rgb(var(--constellation-navy-deepest-rgb) / 0) 45%)`,
);
const ROOT_BG_COLOR = css('rgb(var(--constellation-navy-deepest-rgb))');

/**
 * Ensures a fragment can be followed by another sentence (see the web page:
 * the superpower card joins the profile description to a second sentence).
 */
function asSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export default function LifePathway() {
  const { childId } = useParams();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  const { childData, profile, isLoading, completedAreas } =
    useLifePathwayData(childId);
  const [showSplash, startTimer] = useStageSplash(0);
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();

  // The journey's shared ambient bed plays through this page automatically —
  // just keep it silent while the splash video's own unmuted audio plays.
  useEffect(() => {
    setAmbientSuppressed(showSplash);
    return () => setAmbientSuppressed(false);
  }, [showSplash, setAmbientSuppressed]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [milestoneIdx, setMilestoneIdx] = useState(0);
  const [monthIdx, setMonthIdx] = useState(0);

  const [showStartJourneyModal, setShowStartJourneyModal] = useState(false);

  // ── Derived child facts ────────────────────────────────────────────────────

  const childName = typeof childData?.name === 'string' ? childData.name : '';
  const gender =
    typeof childData?.gender === 'string' ? childData.gender : null;
  const currentAge = useMemo(
    () => Number.parseInt(String(childData?.age ?? ''), 10) || 10,
    [childData],
  );
  const ages = useMemo(
    () => AGE_OFFSETS.map(o => currentAge + o),
    [currentAge],
  );
  const journeyEndAge = ages[ages.length - 1] ?? currentAge;
  const archetype = profile?.personality_type ?? null;
  const strengths = useMemo(
    () => (profile?.top_strengths ?? []).map(s => String(s)).filter(Boolean),
    [profile],
  );
  const traits = useMemo(() => {
    const rawTraits = childData?.personality?.view_model?.profile?.traits;
    if (!Array.isArray(rawTraits)) return [];
    return rawTraits
      .map(v => String(v))
      .filter(Boolean)
      .slice(0, 3);
  }, [childData]);

  /** Voice tokens for this child, for the few places that need one pronoun alone. */
  const voice = useMemo(() => copyTokensFor(gender), [gender]);

  /** Resolve {name}/{he}/{his}/{s} tokens in design copy. */
  const t = useCallback(
    (text: string) => fillTemplate(text, childName, gender),
    [childName, gender],
  );

  const superpower = useMemo(
    () =>
      archetype
        ? ARCHETYPE_SUPERPOWER[archetype] ?? DEFAULT_SUPERPOWER
        : DEFAULT_SUPERPOWER,
    [archetype],
  );

  // The generated personality description wins over the archetype's stock lead
  // where present; an empty string falls through to the lead.
  const summaryText = profile?.summary?.trim() ?? '';
  const superpowerLead =
    summaryText.length > 0 ? asSentence(summaryText) : t(superpower.lead);

  // ── Growth areas offered in the dropdown (completed only) ──────────────────

  const areaOptions = useMemo(() => {
    const byId = new Map(completedAreas.map(a => [a.area_id, a]));
    return GROWTH_AREAS.flatMap(g => {
      const completed = byId.get(g.id);
      return completed ? [{ area: g, completed }] : [];
    });
  }, [completedAreas]);

  const selected =
    areaOptions[Math.min(selectedIdx, Math.max(0, areaOptions.length - 1))] ??
    null;
  const selectedArea: GrowthArea | null = selected?.area ?? null;

  // ── Milestone content: generated where available, templated otherwise ──────

  const {
    generated,
    status: areaStatus,
    progressMessage,
  } = useLifePathwayArea({
    childId,
    child: childData,
    area: selectedArea,
    completedArea: selected?.completed ?? null,
    areas: completedAreas,
    archetype,
    personalityNarrative: profile?.summary ?? null,
    strengths,
    ages,
    enabled: !isLoading && !showSplash,
  });

  const isAreaLoading = areaStatus === 'loading';

  const milestones: Milestone[] = useMemo(() => {
    const fallback = selectedArea
      ? FALLBACK_MILESTONES[selectedArea.id] ?? CORE_MILESTONES
      : CORE_MILESTONES;
    // Ages come from the child's real age, never from the model.
    return mergeMilestones(generated, fallback, ages).map(m => ({
      ...m,
      title: t(m.title),
      guided: t(m.guided),
      power: t(m.power),
      drift: t(m.drift),
    }));
  }, [generated, selectedArea, ages, t]);

  const activeIdx = Math.min(milestoneIdx, milestones.length - 1);
  const activeMilestone = milestones[activeIdx];

  // ── Chart geometry ────────────────────────────────────────────────────────

  const ys = useMemo(
    () => (selected ? deriveAreaYs(selected.completed) : NEUTRAL_YS),
    [selected],
  );
  const hue = selectedArea?.hue ?? NEUTRAL_HUE;

  // ── 90-day moves, one row per completed area, from stored recommendations ──

  const monthMoves = useMemo(() => {
    const source = areaOptions.length
      ? areaOptions
      : GROWTH_AREAS.map(g => ({
          area: g,
          completed: null as CompletedArea | null,
        }));
    return source
      .map(({ area, completed }) => {
        const recs = normalizeRecommendations(
          Array.isArray(completed?.ai_three_month_recommendations) &&
            completed.ai_three_month_recommendations.length > 0
            ? completed.ai_three_month_recommendations
            : completed?.recommendations ?? [],
        );
        const rec = recs[monthIdx];
        const fallback = FALLBACK_MONTH_MOVES[area.id]?.[monthIdx];
        const text = rec
          ? rec.detail
            ? `${rec.title} — ${rec.detail}`
            : rec.title
          : fallback
          ? t(fallback)
          : '';
        return { area, text, color: AREA_HEX[area.id] ?? CYAN };
      })
      .filter(r => r.text);
  }, [areaOptions, monthIdx, t]);

  // ── Start-journey modal ───────────────────────────────────────────────────

  const closeStartJourneyModal = useCallback(() => {
    setShowStartJourneyModal(false);
  }, []);

  // Web: the modal closes on unmount and on bfcache restore. A stack screen
  // stays mounted underneath the next one (and an RN Modal would float above
  // it), so close it whenever this screen loses focus instead.
  useFocusEffect(
    useCallback(() => closeStartJourneyModal, [closeStartJourneyModal]),
  );

  const handleStartJourney = useCallback(() => {
    setShowStartJourneyModal(true);
  }, []);

  // ── Page fade (web motion.div: opacity 0 → showSplash ? 0 : 1, 0.8s easeOut) ──

  const pageOpacity = useSharedValue(0);
  useEffect(() => {
    pageOpacity.value = withTiming(showSplash ? 0 : 1, {
      duration: 800,
      easing: Easing.out(Easing.ease),
    });
  }, [showSplash, pageOpacity]);
  const pageStyle = useAnimatedStyle(() => ({ opacity: pageOpacity.value }));

  return (
    <View className="flex-1 bg-background">
      <Animated.View style={[{ flex: 1 }, pageStyle]}>
        {isLoading ? (
          <View className="flex-1 items-center justify-center bg-background">
            <Spinner className="h-12 w-12 border-4" />
          </View>
        ) : (
          <PageScroll contentContainerStyle={{ flexGrow: 1, paddingBottom: 0 }}>
            <View
              key={showSplash ? 'splash' : 'content'}
              style={{
                flexGrow: 1,
                backgroundColor: ROOT_BG_COLOR,
                experimental_backgroundImage: ROOT_BG_IMAGE,
              }}
            >
              {/*
                The design's own sticky header is deliberately not reproduced:
                the app header already renders the brand mark and the section
                label ("Transform") — see the web page.
              */}
              <View
                style={{
                  paddingTop: IS_MOBILE ? 36 : 52,
                  paddingHorizontal: IS_MOBILE ? 20 : 40,
                  paddingBottom: (IS_MOBILE ? 72 : 96) + insets.bottom,
                }}
              >
                <HeroSection
                  childName={childName}
                  currentAge={currentAge}
                  journeyEndAge={journeyEndAge}
                  archetype={archetype}
                  t={t}
                  reducedMotion={reducedMotion}
                />
                <SuperpowerSection
                  t={t}
                  superpowerTitle={superpower.title}
                  superpowerLead={superpowerLead}
                  traits={traits}
                  him={voice.him}
                  currentAge={currentAge}
                  journeyEndAge={journeyEndAge}
                  reducedMotion={reducedMotion}
                />
                <ChartSection
                  areaOptions={areaOptions}
                  selectedIdx={selectedIdx}
                  onSelectArea={i => {
                    setSelectedIdx(i);
                    setMilestoneIdx(0);
                  }}
                  selectedArea={selectedArea}
                  ys={ys}
                  hue={hue}
                  ages={ages}
                  activeMilestoneIdx={activeIdx}
                  onSelectMilestone={setMilestoneIdx}
                  milestone={activeMilestone}
                  milestoneIdx={milestoneIdx}
                  hasGenerated={Boolean(generated)}
                  isAreaLoading={isAreaLoading}
                  progressMessage={progressMessage}
                  childName={childName}
                  him={voice.him}
                  t={t}
                  reducedMotion={reducedMotion}
                />
                <CompareSection t={t} reducedMotion={reducedMotion} />
                <NinetyDaySection
                  childName={childName}
                  currentAge={currentAge}
                  archetype={archetype}
                  monthIdx={monthIdx}
                  onSelectMonth={setMonthIdx}
                  monthMoves={monthMoves}
                  quality={superpower.quality}
                  t={t}
                  reducedMotion={reducedMotion}
                />
                <CtaSection
                  childName={childName}
                  t={t}
                  onStart={handleStartJourney}
                  reducedMotion={reducedMotion}
                />
              </View>
            </View>
          </PageScroll>
        )}
      </Animated.View>

      {!isLoading && (
        <StartJourneyModal
          open={showStartJourneyModal}
          onClose={closeStartJourneyModal}
          childName={childName}
          childGender={gender}
          childId={childId}
          childData={childData}
          profile={profile}
        />
      )}

      {showSplash && <StageSplash stage={4} onReady={startTimer} />}
    </View>
  );
}
