import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { COPY } from '@/lib/lifePathwayData';
import type { Milestone } from '@/lib/lifePathwayData';
import { css } from '@/theme';
import DashedRule from './DashedRule';
import { LP_PALETTE } from './palette';
import {
  CYAN,
  GOLD,
  em,
  fadeIn,
  orbitron,
  rajdhani,
  shimmer,
  SPIN,
  swap,
} from './styles';

const CYAN_MID = css('rgb(var(--constellation-cyan-mid-rgb))');
const CYAN_PALE = css('rgb(var(--constellation-cyan-pale-rgb))');
const CYAN_PALER = css('rgb(var(--constellation-cyan-paler-rgb))');
const SLATE_MUTE = css('rgb(var(--constellation-slate-mute-rgb))');
const SLATE_WARM = css('rgb(var(--constellation-slate-warm-rgb))');
const SPINNER_RING = css('rgb(var(--constellation-cyan-rgb) / .25)');
const DIVIDER = css('rgb(var(--constellation-cyan-rgb) / .14)');
const DASH_SOFT = css('rgb(var(--constellation-cyan-rgb) / .16)');
const DASH_POWER = css('rgb(var(--constellation-cyan-rgb) / .22)');
const SKELETON_BAR = css(
  'linear-gradient(90deg,rgb(var(--constellation-cyan-rgb) / .13),rgb(var(--constellation-cyan-rgb) / .05))',
);

const SUPER_CARD = {
  bg: css(
    'linear-gradient(150deg,rgb(var(--constellation-navy-royal-rgb) / .9),rgb(var(--constellation-ink-navy-rgb) / .7))',
  ),
  border: css('rgb(var(--constellation-cyan-rgb) / .4)'),
  shadow: css('0 0 40px rgb(var(--constellation-cyan-rgb) / .10)'),
};
const ROUTINE_CARD = {
  bg: css('rgb(var(--constellation-void-soft-rgb) / .6)'),
  border: css('rgb(var(--constellation-ring-faint-rgb) / .16)'),
};

const LOADING_PANELS = [
  {
    label: COPY.msSuperpowerLabel,
    accent: CYAN,
    bg: css(
      'linear-gradient(150deg,rgb(var(--constellation-navy-royal-rgb) / .55),rgb(var(--constellation-ink-navy-rgb) / .5))',
    ),
    bgColor: undefined,
    border: css('rgb(var(--constellation-cyan-rgb) / .20)'),
    bars: [96, 88, 64, 0, 78],
  },
  {
    label: COPY.msRoutineLabel,
    accent: SLATE_MUTE,
    bg: undefined,
    bgColor: css('rgb(var(--constellation-void-soft-rgb) / .45)'),
    border: css('rgb(var(--constellation-ring-faint-rgb) / .12)'),
    bars: [92, 70],
  },
] as const;

const PANEL_LABEL = {
  ...rajdhani(11, 700),
  letterSpacing: em(11, 0.2),
  textTransform: 'uppercase',
} as const;

interface MilestoneDetailProps {
  isLoading: boolean;
  milestone: Milestone | undefined;
  areaName: string | null;
  childName: string;
  him: string;
  progressMessage: string;
  /** Remount key for the swap animation (area · milestone · generated). */
  contentKey: string;
  loadingKey: string;
  reducedMotion: boolean;
}

function AgeTag({ age }: { age: Milestone['age'] | undefined }) {
  return (
    <Text style={[orbitron(12), { letterSpacing: em(12, 0.22), color: GOLD }]}>
      AGE {age}
    </Text>
  );
}

/** The selected milestone below the chart — a skeleton while its copy is being generated. */
export default function MilestoneDetail({
  isLoading,
  milestone,
  areaName,
  childName,
  him,
  progressMessage,
  contentKey,
  loadingKey,
  reducedMotion,
}: MilestoneDetailProps) {
  return (
    <View
      style={{
        marginTop: 14,
        borderTopWidth: 1,
        borderTopColor: DIVIDER,
        paddingTop: 22,
      }}
    >
      {isLoading ? (
        /*
         * Deliberately no templated copy while a job is pending (see the web
         * page): the age heading stays because it is derived from the child's
         * own age, not from the model.
         */
        <Animated.View
          key={loadingKey}
          style={swap(reducedMotion)}
          accessibilityState={{ busy: true }}
          accessibilityLiveRegion="polite"
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <AgeTag age={milestone?.age} />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                flexShrink: 1,
              }}
            >
              <Animated.View
                style={[
                  {
                    width: 13,
                    height: 13,
                    borderRadius: 7,
                    borderWidth: 2,
                    borderColor: SPINNER_RING,
                    borderTopColor: CYAN,
                  },
                  SPIN,
                ]}
              />
              <Text
                style={[
                  rajdhani(14, 700),
                  {
                    flexShrink: 1,
                    letterSpacing: em(14, 0.02),
                    color: CYAN_MID,
                  },
                ]}
              >
                Personalising {areaName ?? 'this area'} for {childName || him}…
              </Text>
            </View>
          </View>
          <View style={{ gap: 18, marginTop: 18 }}>
            {LOADING_PANELS.map(panel => (
              <View
                key={panel.label}
                style={{
                  borderRadius: 16,
                  paddingVertical: 20,
                  paddingHorizontal: 22,
                  experimental_backgroundImage: panel.bg,
                  backgroundColor: panel.bgColor,
                  borderWidth: 1,
                  borderColor: panel.border,
                }}
              >
                <Text
                  style={[PANEL_LABEL, { color: panel.accent, opacity: 0.7 }]}
                >
                  {panel.label}
                </Text>
                <View style={{ marginTop: 14 }}>
                  {panel.bars.map((w, i) =>
                    w === 0 ? (
                      <DashedRule
                        key={`gap-${String(i)}`}
                        color={DASH_SOFT}
                        style={{ marginVertical: 14 }}
                      />
                    ) : (
                      <Animated.View
                        key={`bar-${String(i)}`}
                        style={[
                          {
                            height: 11,
                            width: `${w}%`,
                            marginBottom: 9,
                            borderRadius: 6,
                            experimental_backgroundImage: SKELETON_BAR,
                          },
                          shimmer(i * 0.12),
                        ]}
                      />
                    ),
                  )}
                </View>
              </View>
            ))}
          </View>
          {progressMessage ? (
            <Animated.Text
              style={[
                rajdhani(13.5, 600),
                { marginTop: 16, color: SLATE_WARM },
                fadeIn(0.5, 0, reducedMotion),
              ]}
            >
              {progressMessage}
            </Animated.Text>
          ) : null}
        </Animated.View>
      ) : (
        <Animated.View key={contentKey} style={swap(reducedMotion)}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <AgeTag age={milestone?.age} />
            <Text
              accessibilityRole="header"
              style={[orbitron(19, 700), { flexShrink: 1, color: CYAN_PALER }]}
            >
              {milestone?.title}
            </Text>
          </View>
          <View style={{ gap: 18, marginTop: 18 }}>
            <View
              style={{
                borderRadius: 16,
                paddingVertical: 20,
                paddingHorizontal: 22,
                experimental_backgroundImage: SUPER_CARD.bg,
                borderWidth: 1,
                borderColor: SUPER_CARD.border,
                boxShadow: SUPER_CARD.shadow,
              }}
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <Svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={CYAN}
                  strokeWidth={2}
                >
                  <Path d="M13 2 5 13h6l-1 9 8-11h-6z" />
                </Svg>
                <Text style={[PANEL_LABEL, { color: CYAN }]}>
                  {COPY.msSuperpowerLabel}
                </Text>
              </View>
              <Text
                style={[
                  rajdhani(15, 600, 1.5),
                  { marginTop: 10, color: CYAN_PALE },
                ]}
              >
                {milestone?.guided}
              </Text>
              {milestone?.power ? (
                <View style={{ marginTop: 14 }}>
                  <DashedRule color={DASH_POWER} />
                  <Text
                    style={[
                      rajdhani(13.5, 700),
                      {
                        paddingTop: 12,
                        letterSpacing: em(13.5, 0.02),
                        color: CYAN_MID,
                      },
                    ]}
                  >
                    {milestone.power}
                  </Text>
                </View>
              ) : null}
            </View>
            <View
              style={{
                borderRadius: 16,
                paddingVertical: 20,
                paddingHorizontal: 22,
                backgroundColor: ROUTINE_CARD.bg,
                borderWidth: 1,
                borderColor: ROUTINE_CARD.border,
              }}
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <Svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={SLATE_MUTE}
                  strokeWidth={2}
                >
                  <Path d="M4 12h16" />
                </Svg>
                <Text style={[PANEL_LABEL, { color: SLATE_MUTE }]}>
                  {COPY.msRoutineLabel}
                </Text>
              </View>
              <Text
                style={[
                  rajdhani(15, 600, 1.5),
                  { marginTop: 10, color: LP_PALETTE.routineBody },
                ]}
              >
                {milestone?.drift}
              </Text>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}
