/**
 * The full-screen "results are in!" reveal (web PersonalityProfile REVEAL PHASE):
 * dot grid, pulsing rings, falling sparks, the popping badge and the CTA.
 */
import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Mask,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { css, rgb, textGlowRoom } from '@/theme';
import { PP } from './palette';
import {
  BADGE_POP,
  BADGE_SWEEP,
  SWEEP_W,
  riseIn,
  ringOut,
  sparkFall,
} from './animations';
import { SERIF, clampVw } from './styles';

// Falling sparks for reveal
const SPARKS = [
  {
    left: '8%',
    delay: '0.1s',
    size: 9,
    color: 'constellation-blue-bright',
    glow: ['constellation-blue-sky', 0.9],
    dur: '3.4s',
  },
  {
    left: '20%',
    delay: '0.9s',
    size: 6,
    color: 'constellation-gold-light',
    glow: ['constellation-gold-light', 0.8],
    dur: '4.2s',
  },
  {
    left: '33%',
    delay: '1.6s',
    size: 8,
    color: 'constellation-gold-soft',
    glow: ['constellation-gold-light', 0.9],
    dur: '3.8s',
  },
  {
    left: '47%',
    delay: '0.4s',
    size: 5,
    color: 'constellation-blue-vivid',
    glow: ['constellation-blue-sky', 0.8],
    dur: '4.6s',
  },
  {
    left: '62%',
    delay: '1.2s',
    size: 9,
    color: 'constellation-blue-bright',
    glow: ['constellation-blue-sky', 0.9],
    dur: '3.2s',
  },
  {
    left: '74%',
    delay: '2.1s',
    size: 7,
    color: 'constellation-gold-soft',
    glow: ['constellation-gold-light', 0.85],
    dur: '4.4s',
  },
  {
    left: '86%',
    delay: '0.7s',
    size: 8,
    color: 'constellation-blue-vivid',
    glow: ['constellation-blue-sky', 0.8],
    dur: '3.6s',
  },
  {
    left: '94%',
    delay: '1.9s',
    size: 5,
    color: 'constellation-gold-light',
    glow: ['constellation-gold-light', 0.9],
    dur: '4.0s',
  },
] as const satisfies readonly {
  left: `${number}%`;
  delay: `${number}s`;
  size: number;
  color: string;
  glow: readonly [string, number];
  dur: `${number}s`;
}[];

const RING_BORDERS = [
  { width: 2, color: rgb('constellation-blue-pastel', 0.7) },
  { width: 1, color: rgb('constellation-gold-light', 0.45) },
  { width: 1, color: rgb('constellation-blue-pastel', 0.35) },
] as const;
const RING_DELAYS = [0, 0.55, 1.1] as const;

const REVEAL_BG = css(
  `radial-gradient(80% 60% at 50% 45%, ${PP.revealGlow} 0%, ${PP.revealGlowEnd} 70%), linear-gradient(180deg,rgb(var(--constellation-navy-black-rgb)),${PP.revealBottom})`,
);
const BADGE_BG = css(
  `linear-gradient(180deg, ${PP.badgeBgTop}, rgb(var(--constellation-navy-card-rgb) / .5))`,
);
const BADGE_SHADOW = css(
  `0 0 60px ${PP.badgeGlow}, 0 0 34px rgb(var(--constellation-gold-light-rgb) / .3)`,
);
const SWEEP_BG = `linear-gradient(90deg, transparent, ${PP.badgeSweep}, transparent)`;
const CTA_SHADOW = css(
  '0 0 28px rgb(var(--constellation-blue-electric-rgb) / .4)',
);

/** `radial-gradient(color 1px, transparent 1px)` on a 28px grid, masked to a centered ellipse. */
function DotGrid() {
  const dot = rgb('constellation-blue-sky', 0.4);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern
            id="ppDots"
            x="0"
            y="0"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <Circle cx="14" cy="14" r="1" fill={dot} />
          </Pattern>
          {/* mask-image: radial-gradient(50% 45% at 50% 45%, #000, transparent 80%) */}
          <RadialGradient
            id="ppDotFade"
            cx="50%"
            cy="45%"
            rx="50%"
            ry="45%"
            fx="50%"
            fy="45%"
          >
            <Stop offset="0" stopColor={rgb('white')} stopOpacity={1} />
            <Stop offset="0.8" stopColor={rgb('white')} stopOpacity={0} />
          </RadialGradient>
          <Mask id="ppDotMask">
            <Rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="url(#ppDotFade)"
            />
          </Mask>
        </Defs>
        <Rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="url(#ppDots)"
          mask="url(#ppDotMask)"
        />
      </Svg>
    </View>
  );
}

export interface RevealPhaseProps {
  childName: string;
  typeTitle: string;
  summary: string;
  onContinue: () => void;
}

export default function RevealPhase({
  childName,
  typeTitle,
  summary,
  onContinue,
}: RevealPhaseProps) {
  const { width: vw } = useWindowDimensions();
  const ctaFont = clampVw(13, 3.5, 16, vw);

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { overflow: 'hidden', experimental_backgroundImage: REVEAL_BG },
      ]}
    >
      <DotGrid />

      {/* Pulsing rings */}
      {RING_DELAYS.map((delay, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: '50%',
              top: '44%',
              width: 320,
              height: 320,
              marginTop: -160,
              marginLeft: -160,
              borderRadius: 160,
              borderWidth: RING_BORDERS[i]?.width ?? 1,
              borderColor: RING_BORDERS[i]?.color,
            },
            ringOut(delay),
          ]}
        />
      ))}

      {/* Falling sparks */}
      {SPARKS.map((s, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: s.left,
              top: 0,
              width: s.size,
              height: s.size,
              backgroundColor: rgb(s.color),
              boxShadow: `0 0 ${s.size + 5}px ${Math.ceil(
                s.size * 0.4,
              )}px ${rgb(s.glow[0], s.glow[1])}`,
            },
            sparkFall(s.dur, s.delay),
          ]}
        />
      ))}

      {/* Center content */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            alignItems: 'center',
            justifyContent: 'center',
            gap: clampVw(14, 3.5, 22, vw),
            paddingVertical: 40,
            paddingHorizontal: 20,
          },
        ]}
      >
        <Animated.Text
          style={[
            {
              fontSize: 13,
              letterSpacing: 13 * 0.5,
              textTransform: 'uppercase',
              textAlign: 'center',
              color: rgb('constellation-blue-strong'),
            },
            riseIn(0.8),
          ]}
        >
          Personality Analysis
        </Animated.Text>
        <Animated.Text
          accessibilityRole="header"
          style={[
            {
              fontSize: clampVw(16, 5, 22, vw),
              letterSpacing: clampVw(16, 5, 22, vw) * 0.06,
              textAlign: 'center',
              color: rgb('constellation-gold-light'),
              textShadowColor: rgb('constellation-gold-light', 0.5),
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 24,
              ...textGlowRoom(24),
            },
            riseIn(0.9, 0.25),
          ]}
        >
          {childName}'s results are in!
        </Animated.Text>

        {/* Badge */}
        <Animated.View
          style={[
            {
              paddingVertical: clampVw(16, 4, 26, vw),
              paddingHorizontal: clampVw(20, 6, 54, vw),
              borderWidth: 1,
              borderColor: rgb('constellation-gold-light', 0.55),
              borderRadius: 18,
              overflow: 'hidden',
              experimental_backgroundImage: BADGE_BG,
              boxShadow: BADGE_SHADOW,
            },
            BADGE_POP,
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: SWEEP_W,
                experimental_backgroundImage: SWEEP_BG,
              },
              BADGE_SWEEP,
            ]}
          />
          <Text
            style={[
              SERIF,
              {
                fontSize: clampVw(26, 7, 64, vw),
                lineHeight: clampVw(26, 7, 64, vw) * 1.05,
                textAlign: 'center',
                color: rgb('constellation-blue-pale'),
                textShadowColor: PP.badgeTitleGlow,
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 34,
                ...textGlowRoom(34),
              },
            ]}
          >
            {childName} is a{'\n'}
            <Text
              style={{
                fontStyle: 'italic',
                color: rgb('constellation-blue-deep'),
              }}
            >
              {typeTitle}
            </Text>
          </Text>
        </Animated.View>

        <Animated.Text
          style={[
            {
              fontSize: clampVw(14, 4, 17, vw),
              lineHeight: clampVw(14, 4, 17, vw) * 1.55,
              maxWidth: 420,
              textAlign: 'center',
              color: rgb('constellation-blue-mid'),
            },
            riseIn(0.9, 1.2),
          ]}
        >
          {summary ||
            `Curious and full of ideas — here's what the answers reveal about how ${childName} thinks.`}
        </Animated.Text>

        <Animated.View style={[{ marginTop: 6 }, riseIn(0.8, 1.6)]}>
          <Pressable
            onPress={onContinue}
            accessibilityRole="button"
            accessibilityLabel={`See ${childName}'s results`}
            style={{
              paddingVertical: clampVw(10, 3, 14, vw),
              paddingHorizontal: clampVw(20, 6, 30, vw),
              borderRadius: 999,
              borderWidth: 1,
              borderColor: rgb('constellation-gold-light', 0.7),
              backgroundColor: rgb('constellation-blue-royal', 0.55),
              boxShadow: CTA_SHADOW,
            }}
          >
            <Text
              style={{
                fontSize: ctaFont,
                letterSpacing: ctaFont * 0.12,
                textTransform: 'uppercase',
                textAlign: 'center',
                color: rgb('constellation-gold-hazy'),
              }}
            >
              See {childName}'s results
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
