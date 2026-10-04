import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { COPY } from '@/lib/lifePathwayData';
import type { Milestone } from '@/lib/lifePathwayData';
import type { GrowthArea } from '@/lib/growthAreaData';
import { css } from '@/theme';
import AreaSelect from './AreaSelect';
import MilestoneDetail from './MilestoneDetail';
import PathwayCurve from './PathwayCurve';
import {
  CYAN,
  GOLD,
  IS_MOBILE,
  em,
  fadeUp,
  orbitron,
  rajdhani,
} from './styles';

const SECTION_BG = css(
  'linear-gradient(165deg,rgb(var(--constellation-navy-panel3-rgb) / .7),rgb(var(--constellation-ink-navy-rgb) / .72))',
);
const SECTION_BORDER = css('rgb(var(--constellation-cyan-rgb) / .18)');
const SECTION_SHADOW = css(
  '0 30px 90px rgb(var(--constellation-void-deep-rgb) / .7)',
);
const CYAN_PALER = css('rgb(var(--constellation-cyan-paler-rgb))');
const SLATE_WARM = css('rgb(var(--constellation-slate-warm-rgb))');
const SLATE = css('rgb(var(--constellation-slate-rgb))');
const SLATE_NAVY2 = css('rgb(var(--constellation-slate-navy2-rgb))');
const SLATE_MUTE = css('rgb(var(--constellation-slate-mute-rgb))');
const LEGEND_SUPER = `linear-gradient(90deg,${CYAN},${GOLD})`;

const LEGEND_TEXT = {
  ...rajdhani(11, 700),
  letterSpacing: em(11, 0.14),
  textTransform: 'uppercase',
} as const;

interface ChartSectionProps {
  areaOptions: { area: GrowthArea }[];
  selectedIdx: number;
  onSelectArea: (idx: number) => void;
  selectedArea: GrowthArea | null;
  ys: readonly number[];
  hue: string;
  ages: readonly number[];
  activeMilestoneIdx: number;
  onSelectMilestone: (idx: number) => void;
  milestone: Milestone | undefined;
  milestoneIdx: number;
  hasGenerated: boolean;
  isAreaLoading: boolean;
  progressMessage: string;
  childName: string;
  him: string;
  t: (text: string) => string;
  reducedMotion: boolean;
}

/** "The Superpower life" chart card: header, area picker, legend, curve and milestone. */
export default function ChartSection({
  areaOptions,
  selectedIdx,
  onSelectArea,
  selectedArea,
  ys,
  hue,
  ages,
  activeMilestoneIdx,
  onSelectMilestone,
  milestone,
  milestoneIdx,
  hasGenerated,
  isAreaLoading,
  progressMessage,
  childName,
  him,
  t,
  reducedMotion,
}: ChartSectionProps) {
  const areaKey = selectedArea?.id ?? 'core';
  return (
    <Animated.View
      style={[
        {
          marginTop: IS_MOBILE ? 40 : 56,
          borderRadius: 24,
          paddingTop: 22,
          paddingHorizontal: 18,
          paddingBottom: 20,
          experimental_backgroundImage: SECTION_BG,
          borderWidth: 1,
          borderColor: SECTION_BORDER,
          boxShadow: SECTION_SHADOW,
        },
        fadeUp(0.2, reducedMotion),
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Text
            accessibilityRole="header"
            style={[
              orbitron(17),
              { letterSpacing: em(17, 0.02), color: CYAN_PALER },
            ]}
          >
            {COPY.chartTitle}
          </Text>
          <Text
            style={[rajdhani(13.5, 600), { marginTop: 6, color: SLATE_WARM }]}
          >
            {COPY.chartSub}
          </Text>

          {areaOptions.length > 0 && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                marginTop: 16,
                flexWrap: 'wrap',
              }}
            >
              <Text
                style={[
                  rajdhani(10.5, 700),
                  {
                    letterSpacing: em(10.5, 0.2),
                    textTransform: 'uppercase',
                    color: SLATE,
                  },
                ]}
              >
                {COPY.growthAreaLabel}
              </Text>
              <AreaSelect
                label={COPY.growthAreaLabel}
                options={areaOptions}
                selectedIdx={selectedIdx}
                onSelect={onSelectArea}
              />
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={{
                width: 22,
                height: 3,
                borderRadius: 2,
                experimental_backgroundImage: LEGEND_SUPER,
              }}
            />
            <Text style={[LEGEND_TEXT, { color: GOLD }]}>
              {COPY.legendSuperpower}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={{ width: 22, height: 2, backgroundColor: SLATE_NAVY2 }}
            />
            <Text style={[LEGEND_TEXT, { color: SLATE_MUTE }]}>
              {COPY.legendRoutine}
            </Text>
          </View>
        </View>
      </View>

      {/* Keyed on the area so the draw animation replays. */}
      <PathwayCurve
        key={areaKey}
        ys={ys}
        hue={hue}
        ages={ages}
        activeIdx={activeMilestoneIdx}
        onSelect={onSelectMilestone}
        t={t}
        reducedMotion={reducedMotion}
      />

      <MilestoneDetail
        isLoading={isAreaLoading}
        milestone={milestone}
        areaName={selectedArea?.name ?? null}
        childName={childName}
        him={him}
        progressMessage={progressMessage}
        loadingKey={`loading-${areaKey}`}
        contentKey={`${areaKey}-${String(milestoneIdx)}-${
          hasGenerated ? 'ai' : 'base'
        }`}
        reducedMotion={reducedMotion}
      />
    </Animated.View>
  );
}
