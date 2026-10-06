import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Defs,
  FeGaussianBlur,
  Filter,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import { stop } from '@/components/ui/svg-stop';
import { COPY, NODE_LEFT_PCT, curve, gapPath } from '@/lib/lifePathwayData';
import { css } from '@/theme';
import { LP_PALETTE } from './palette';
import {
  IS_MOBILE,
  IS_NARROW,
  em,
  fadeIn,
  orbitron,
  popNode,
  rajdhani,
} from './styles';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const GOLD_WARM = css('rgb(var(--constellation-gold-warm-rgb))');
const GAP_END = css('rgb(var(--constellation-gold-rgb) / .26)');
const ROUTINE_STROKE = css('rgb(var(--constellation-slate-navy2-rgb))');
const NODE_BORDER = css('rgb(var(--constellation-navy-deepest-rgb) / .9)');
const NODE_GLOW_ACTIVE = css(
  '0 0 0 6px rgb(var(--constellation-gold-rgb) / .20), 0 0 26px rgb(var(--constellation-gold-warm-rgb))',
);
const NODE_GLOW = css('0 0 14px rgb(var(--constellation-gold-rgb) / .7)');
const GAP_TITLE = css('rgb(var(--constellation-gold-rgb) / .75)');

const VIEW_W = 1000;
const VIEW_H = 320;
const CHART_H = IS_MOBILE ? 240 : 330;
/** CSS `drop-shadow(0 0 10px …)` — blur length 10px ≈ stdDeviation 5 on screen. */
const GLOW_STD_PX = 5;
const DASH = 1600;

/**
 * Breaks the gap caption after its pronoun clause on narrow screens — see the
 * web page's splitGapCaption for the measurements behind this.
 */
function splitGapCaption(text: string): [string, string] | null {
  const words = text.split(' ');
  if (words.length < 4) return null;
  return [words.slice(0, 3).join(' '), words.slice(3).join(' ')];
}

interface PathwayCurveProps {
  ys: readonly number[];
  /** "r,g,b" triple of the selected area. */
  hue: string;
  ages: readonly number[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  t: (text: string) => string;
  reducedMotion: boolean;
}

/**
 * Curve + nodes + gap caption + age labels. The parent keys this on the
 * selected area so the draw animation replays, exactly like the web.
 */
export default function PathwayCurve({
  ys,
  hue,
  ages,
  activeIdx,
  onSelect,
  t,
  reducedMotion,
}: PathwayCurveProps) {
  const [width, setWidth] = useState(0);

  // lpDrawLine 2.6s cubic-bezier(.35,0,.25,1) .3s both
  const dashOffset = useSharedValue(reducedMotion ? 0 : DASH);
  // lpGapIn 1.4s ease 1.6s both
  const gapOpacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) return;
    dashOffset.value = withDelay(
      300,
      withTiming(0, {
        duration: 2600,
        easing: Easing.bezier(0.35, 0, 0.25, 1),
      }),
    );
    gapOpacity.value = withDelay(
      1600,
      withTiming(1, { duration: 1400, easing: Easing.ease }),
    );
  }, [reducedMotion, dashOffset, gapOpacity]);
  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));
  const glowProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));
  const gapProps = useAnimatedProps(() => ({ opacity: gapOpacity.value }));

  // The SVG stretches (preserveAspectRatio="none"), so the blur's user-space
  // deviation is divided by each axis' scale to read as a round 10px glow.
  const sx = width > 0 ? width / VIEW_W : 1;
  const sy = CHART_H / VIEW_H;
  const blur = `${(GLOW_STD_PX / sx).toFixed(2)} ${(GLOW_STD_PX / sy).toFixed(
    2,
  )}`;

  const gapSub = t(COPY.gapSub);
  const gapLines = IS_NARROW ? splitGapCaption(gapSub) : null;
  const linePath = curve(ys);

  return (
    <View
      style={{ position: 'relative', marginTop: 20, height: CHART_H }}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          <LinearGradient id="lpLine" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0%" {...stop(`rgba(${hue},.7)`)} />
            <Stop offset="45%" {...stop(`rgb(${hue})`)} />
            <Stop offset="100%" {...stop(GOLD_WARM)} />
          </LinearGradient>
          <LinearGradient id="lpGap" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" {...stop(`rgba(${hue},0)`)} />
            <Stop offset="45%" {...stop(`rgba(${hue},.13)`)} />
            <Stop offset="100%" {...stop(GAP_END)} />
          </LinearGradient>
          <Filter id="lpGlow" x="-20%" y="-20%" width="140%" height="140%">
            <FeGaussianBlur stdDeviation={blur} />
          </Filter>
        </Defs>
        <AnimatedPath
          d={gapPath(ys)}
          fill="url(#lpGap)"
          animatedProps={gapProps}
        />
        <Path
          d="M40 300 C160 300 260 302 380 304 C520 306 700 308 940 310"
          fill="none"
          stroke={ROUTINE_STROKE}
          strokeWidth={2}
          strokeDasharray="8 8"
          vectorEffect="non-scaling-stroke"
        />
        {/* drop-shadow(0 0 10px rgba(hue,.45)) — a blurred copy under the line. */}
        <AnimatedPath
          d={linePath}
          fill="none"
          stroke={`rgba(${hue},.45)`}
          strokeWidth={3.4}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          strokeDasharray={DASH}
          filter="url(#lpGlow)"
          animatedProps={glowProps}
        />
        <AnimatedPath
          d={linePath}
          fill="none"
          stroke="url(#lpLine)"
          strokeWidth={3.4}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          strokeDasharray={DASH}
          animatedProps={lineProps}
        />
      </Svg>

      {NODE_LEFT_PCT.map((left, k) => {
        const active = k === activeIdx;
        return (
          <Animated.View
            key={`node-${String(k)}`}
            style={[
              {
                position: 'absolute',
                left: `${left}%`,
                top: `${((ys[k + 1] ?? 300) / VIEW_H) * 100}%`,
                marginLeft: -8,
                marginTop: -8,
              },
              popNode(0.95 + k * 0.25, reducedMotion),
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Age ${String(ages[k] ?? '')}`}
              accessibilityState={{ selected: active }}
              hitSlop={12}
              onPress={() => onSelect(k)}
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: LP_PALETTE.nodeFill,
                boxShadow: active ? NODE_GLOW_ACTIVE : NODE_GLOW,
                borderWidth: 2,
                borderColor: NODE_BORDER,
              }}
            />
          </Animated.View>
        );
      })}

      {/*
        Gap caption: a full-width, left-anchored box lets the inner caption keep
        its natural width (the web's `width: max-content`), then translate(-50%)
        centres it on the anchor.
      */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: IS_NARROW ? '66%' : '56%',
          top: '72%',
          width: '100%',
          alignItems: 'flex-start',
        }}
      >
        <Animated.View
          style={[
            {
              alignItems: 'center',
              transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
            },
            fadeIn(1, 2.4, reducedMotion),
          ]}
        >
          <Text
            style={[
              orbitron(13),
              {
                letterSpacing: em(13, 0.22),
                textTransform: 'uppercase',
                color: GAP_TITLE,
                textAlign: 'center',
              },
            ]}
          >
            {COPY.gapTitle}
          </Text>
          <Text
            style={[
              rajdhani(13, 600, gapLines === null ? 1.5 : 1.35),
              {
                marginTop: 5,
                color: LP_PALETTE.gapCaption,
                textAlign: 'center',
              },
            ]}
          >
            {gapLines === null ? gapSub : `${gapLines[0]}\n${gapLines[1]}`}
          </Text>
        </Animated.View>
      </View>

      {NODE_LEFT_PCT.map((left, k) => {
        const active = k === activeIdx;
        return (
          <View
            key={`label-${String(k)}`}
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: `${left}%`,
              bottom: -2,
              width: '100%',
              alignItems: 'flex-start',
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Age ${String(ages[k] ?? '')}`}
              accessibilityState={{ selected: active }}
              hitSlop={8}
              onPress={() => onSelect(k)}
              style={{ transform: [{ translateX: '-50%' }] }}
            >
              <Animated.Text
                style={[
                  orbitron(12.5, 700),
                  {
                    color: active ? GOLD_WARM : LP_PALETTE.ageLabel,
                    transitionProperty: 'color',
                    transitionDuration: '0.25s',
                    transitionTimingFunction: 'ease',
                  },
                ]}
              >
                {ages[k]}
              </Animated.Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
