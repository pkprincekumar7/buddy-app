import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated, {
  type CSSTransitionProperties,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Text as SvgText,
  TSpan,
  Stop,
} from 'react-native-svg';
import { stop } from '@/components/ui/svg-stop';
import { COPY, MONTHS, TIMELINE } from '@/lib/lifePathwayData';
import type { GrowthArea } from '@/lib/growthAreaData';
import { css, fonts } from '@/theme';
import { LP_PALETTE } from './palette';
import {
  GOLD,
  IS_MOBILE,
  IS_NARROW,
  em,
  fadeUp,
  orbitron,
  rajdhani,
  swap,
} from './styles';

/*
 * 90-day rail label geometry — identical to the web page; see the comments on
 * LABEL_TARGET_PX et al. in frontend/src/pages/LifePathway.tsx for why the
 * label size is derived from the measured rail width.
 */
const LABEL_TARGET_PX = 15;
const LABEL_TARGET_PX_WIDE = 18;
const LABEL_WIDE_RAIL_MIN = 900;
const LABEL_ONE_LINE_MAX_UNITS = 20;
const LABEL_MAX_UNITS = 34;

const CYAN_PALER = css('rgb(var(--constellation-cyan-paler-rgb))');
const CYAN_PALE = css('rgb(var(--constellation-cyan-pale-rgb))');
const CYAN_BRIGHT2 = css('rgb(var(--constellation-cyan-bright2-rgb))');
const SLATE_WARM = css('rgb(var(--constellation-slate-warm-rgb))');
const SLATE = css('rgb(var(--constellation-slate-rgb))');
const GOLD_PALE = css('rgb(var(--constellation-gold-pale-rgb))');
const RAIL_START = css('rgb(var(--constellation-cyan-rgb) / .55)');
const TAB_BORDER_ON = css('rgb(var(--constellation-gold-rgb) / .6)');
const TAB_BORDER_OFF = css('rgb(var(--constellation-cyan-rgb) / .2)');
const TAB_BG_ON = css('rgb(var(--constellation-gold-rgb) / .12)');
const TAB_BG_OFF = css('rgb(var(--constellation-overlay-rgb) / .7)');
const CARD_BG = css(
  'linear-gradient(160deg,rgb(var(--constellation-navy-panel3-rgb) / .75),rgb(var(--constellation-ink-navy-rgb) / .75))',
);
const CARD_BORDER = css('rgb(var(--constellation-gold-rgb) / .24)');
const DIVIDER = css('rgb(var(--constellation-cyan-rgb) / .14)');

const TAB_FS = IS_NARROW ? 9.5 : 11.5;
const TAB_TRANSITION: CSSTransitionProperties = {
  transitionProperty: ['backgroundColor', 'borderColor'],
  transitionDuration: '0.25s',
  transitionTimingFunction: 'ease',
};
const TEXT_TRANSITION: CSSTransitionProperties = {
  transitionProperty: 'color',
  transitionDuration: '0.25s',
  transitionTimingFunction: 'ease',
};

export interface MonthMove {
  area: GrowthArea;
  text: string;
  color: string;
}

interface NinetyDaySectionProps {
  childName: string;
  currentAge: number;
  archetype: string | null;
  monthIdx: number;
  onSelectMonth: (idx: number) => void;
  monthMoves: MonthMove[];
  quality: string;
  t: (text: string) => string;
  reducedMotion: boolean;
}

/** "The first 90 days": Day 0–90 rail, month tabs and the month's moves. */
export default function NinetyDaySection({
  childName,
  currentAge,
  archetype,
  monthIdx,
  onSelectMonth,
  monthMoves,
  quality,
  t,
  reducedMotion,
}: NinetyDaySectionProps) {
  // Measured width of the rail (the web's ResizeObserver).
  const [railWidth, setRailWidth] = useState(0);

  const railLabel = useMemo(() => {
    const target =
      railWidth >= LABEL_WIDE_RAIL_MIN ? LABEL_TARGET_PX_WIDE : LABEL_TARGET_PX;
    const units =
      railWidth > 0
        ? Math.min(LABEL_MAX_UNITS, Math.round((target * 1000) / railWidth))
        : 16;
    const split = units > LABEL_ONE_LINE_MAX_UNITS;
    return {
      units,
      split,
      y: Math.round(units * (split ? 1 : 1.25)),
      dy: Math.round(units * 1.19),
      railY: Math.round(units * (split ? 3 : 2.375)),
      viewBoxHeight: Math.round(units * (split ? 3.31 : 3.25)),
    };
  }, [railWidth]);

  const month = MONTHS[monthIdx];
  const builtFor = [
    childName,
    `age ${String(currentAge)}`,
    archetype ? `The ${archetype}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Animated.View
      style={[{ marginTop: IS_MOBILE ? 48 : 76 }, fadeUp(0.35, reducedMotion)]}
    >
      <View>
        <Text
          accessibilityRole="header"
          style={[orbitron(17), { color: CYAN_PALER }]}
        >
          {COPY.ninetyTitle}
        </Text>
        <Text
          style={[rajdhani(13.5, 600), { marginTop: 6, color: SLATE_WARM }]}
        >
          Built for {builtFor} · one move per growth area, per month
        </Text>
      </View>

      <View
        style={{ marginTop: 18 }}
        onLayout={e => {
          const w = e.nativeEvent.layout.width;
          if (w > 0) setRailWidth(w);
        }}
        accessible
        accessibilityLabel={TIMELINE.map(m => t(m.label)).join(', ')}
      >
        {railWidth > 0 ? (
          <Svg
            width={railWidth}
            height={(railWidth * railLabel.viewBoxHeight) / 1000}
            viewBox={`0 0 1000 ${String(railLabel.viewBoxHeight)}`}
          >
            <Defs>
              <LinearGradient id="lpP90" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0%" {...stop(RAIL_START)} />
                <Stop offset="100%" {...stop(GOLD)} />
              </LinearGradient>
            </Defs>
            <Path
              d={`M40 ${String(railLabel.railY)} L960 ${String(
                railLabel.railY,
              )}`}
              fill="none"
              stroke="url(#lpP90)"
              strokeWidth={3}
              strokeLinecap="round"
            />
            {TIMELINE.map(m => (
              <Circle
                key={`dot-${String(m.x)}`}
                cx={m.x}
                cy={railLabel.railY}
                r={m.r}
                fill={m.fill}
              />
            ))}
            {TIMELINE.map(m => {
              const label = t(m.label);
              // Split on the first separator only (see the web page).
              const sep = railLabel.split ? label.indexOf(' · ') : -1;
              const head = sep === -1 ? label : label.slice(0, sep);
              const tail = sep === -1 ? null : label.slice(sep + 3);
              return (
                <SvgText
                  key={`txt-${String(m.x)}`}
                  x={m.x}
                  y={railLabel.y}
                  textAnchor={m.anchor}
                  fill={m.color}
                  fontSize={railLabel.units}
                  fontFamily={fonts.rajdhaniBold}
                >
                  {tail === null ? (
                    head
                  ) : (
                    <>
                      <TSpan x={m.x}>{head}</TSpan>
                      <TSpan x={m.x} dy={railLabel.dy}>
                        {tail}
                      </TSpan>
                    </>
                  )}
                </SvgText>
              );
            })}
          </Svg>
        ) : null}
      </View>

      {/* Compact pills on narrow phones keep all three tabs on one line (see the web page). */}
      <View
        style={{
          flexDirection: 'row',
          gap: IS_NARROW ? 6 : 10,
          marginTop: 24,
          flexWrap: 'wrap',
        }}
      >
        {MONTHS.map((m, i) => {
          const on = i === monthIdx;
          return (
            <Pressable
              key={m.tab}
              accessibilityRole="tab"
              accessibilityLabel={m.tab}
              accessibilityState={{ selected: on }}
              onPress={() => onSelectMonth(i)}
            >
              <Animated.View
                style={[
                  {
                    paddingVertical: IS_NARROW ? 6 : 10,
                    paddingHorizontal: IS_NARROW ? 8 : 20,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: on ? TAB_BORDER_ON : TAB_BORDER_OFF,
                    backgroundColor: on ? TAB_BG_ON : TAB_BG_OFF,
                  },
                  TAB_TRANSITION,
                ]}
              >
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    rajdhani(TAB_FS, 700),
                    {
                      letterSpacing: em(TAB_FS, IS_NARROW ? 0.06 : 0.14),
                      textTransform: 'uppercase',
                      color: on ? GOLD_PALE : SLATE_WARM,
                    },
                    TEXT_TRANSITION,
                  ]}
                >
                  {m.tab}
                </Animated.Text>
              </Animated.View>
            </Pressable>
          );
        })}
      </View>

      <Animated.View
        key={`month-${String(monthIdx)}`}
        style={[
          {
            marginTop: 18,
            borderRadius: 20,
            paddingVertical: IS_MOBILE ? 22 : 26,
            paddingHorizontal: IS_MOBILE ? 20 : 28,
            experimental_backgroundImage: CARD_BG,
            borderWidth: 1,
            borderColor: CARD_BORDER,
          },
          swap(reducedMotion),
        ]}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <Text
            accessibilityRole="header"
            style={[orbitron(18, 700), { color: CYAN_PALE }]}
          >
            {month?.title}
          </Text>
          <Text
            style={[
              rajdhani(11, 700),
              {
                letterSpacing: em(11, 0.16),
                textTransform: 'uppercase',
                color: SLATE,
              },
            ]}
          >
            {month?.days}
          </Text>
        </View>
        <Text
          style={[rajdhani(14, 600, 1.45), { marginTop: 8, color: SLATE_WARM }]}
        >
          {t((month?.sub ?? '').replace('{quality}', quality))}
        </Text>
        <View style={{ marginTop: 22, gap: 14 }}>
          {monthMoves.map(({ area, text, color }) => (
            <View
              key={area.id}
              style={{
                flexDirection: 'row',
                gap: 11,
                alignItems: 'flex-start',
              }}
            >
              <View
                style={{
                  width: 7,
                  height: 7,
                  marginTop: 7,
                  flexShrink: 0,
                  borderRadius: 4,
                  backgroundColor: color,
                }}
              />
              <Text
                style={[
                  rajdhani(14, 600, 1.45),
                  { flex: 1, color: LP_PALETTE.moveText },
                ]}
              >
                <Text style={{ color }}>{area.name}</Text> · {text}
              </Text>
            </View>
          ))}
        </View>
        <View
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: DIVIDER,
          }}
        >
          <Text style={[rajdhani(14, 700), { color: CYAN_BRIGHT2 }]}>
            {t(month?.end ?? '')}
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
