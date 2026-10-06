import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import Svg, { G } from 'react-native-svg';
import { css, font, rgb } from '@/theme';
import {
  LOCKED_ICON_STROKE,
  LOCKED_SPHERE_HIGHLIGHT,
  LOCKED_SPHERE_SHADOW,
} from './palette';
import { fadeInOut, fadeOutIn, nodeIn, nodePulse, tagBob } from './animations';

const NODE = 92;
const INNER = 54;

const ACTIVE_BG = css(
  'radial-gradient(circle at 38% 32%,rgb(var(--constellation-cyan-pale-rgb)),rgb(var(--constellation-cyan-rgb)) 42%,rgb(var(--constellation-cyan-deep-rgb)) 100%)',
);
const INACTIVE_BG = css(
  `radial-gradient(circle at 38% 32%,${LOCKED_SPHERE_HIGHLIGHT},rgb(var(--constellation-slate-deep-rgb)) 55%,${LOCKED_SPHERE_SHADOW} 100%)`,
);
const INACTIVE_SHADOW = css(
  '0 0 10px rgb(var(--constellation-slate-deep-rgb) / .4)',
);
const ACTIVE_SHADOW = css('0 0 20px rgb(var(--constellation-cyan-rgb) / .5)');
// `ctaGlow 1.7s ease-in-out infinite` — box-shadow between these two; cross-faded on RN.
const CTA_GLOW_REST = css(
  '0 0 22px rgb(var(--constellation-cyan-rgb) / .9),0 0 46px rgb(var(--constellation-cyan-bright-rgb) / .55)',
);
const CTA_GLOW_PEAK = css(
  '0 0 36px rgb(var(--constellation-cyan-rgb) / 1),0 0 74px rgb(var(--constellation-cyan-bright-rgb) / .9)',
);
const CTA_REST_ANIM = fadeOutIn(1.7);
const CTA_PEAK_ANIM = fadeInOut(1.7);

const PULSE_FAST = nodePulse(1.7);
const PULSE_FAST_LATE = nodePulse(1.7, 0.85);
const PULSE_SLOW = nodePulse(2.6);

const BADGE_BG = css(
  'linear-gradient(135deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-cyan-bright-rgb)))',
);
const BADGE_SHADOW = css('0 0 14px rgb(var(--constellation-cyan-rgb) / .6)');
// tagBob holds the pill at translate(-50%, -118%): 18% of its ~23px height above the `top: -14` anchor.
const BADGE_BOB = tagBob(4);

const RING = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  borderRadius: NODE / 2,
} as const;
const GLOW_DISC = {
  position: 'absolute',
  left: (NODE - INNER) / 2,
  top: (NODE - INNER) / 2,
  width: INNER,
  height: INNER,
  borderRadius: INNER / 2,
  backgroundColor: rgb('constellation-cyan'),
} as const;

const FROST = rgb('constellation-text-frost');
const SLATE_DARK = rgb('constellation-slate-dark');

export interface DimensionNodeProps {
  /** Node center in the 700px ring box. */
  center: { x: number; y: number };
  /** nodeIn animation delay (seconds). */
  delay: number;
  onPress: () => void;
  /** Locked circles render dim slate with a static ring and ignore taps. */
  locked?: boolean;
  /** True for the frontier circle the hub's spoke/dots point to — faster
   *  double-ring pulse + animated glow instead of the standard single ring. */
  highlighted: boolean;
  /** SVG children for the 24×24 icon (stroked; the stroke color is applied by the node). */
  icon: React.ReactNode;
  label: string;
  /** Overrides the label color (Discover uses cyan-paler). */
  labelColor?: string;
  /** Discover's bobbing "Start here" pill. */
  startHereBadge?: boolean;
}

/**
 * A dimension circle that is either fully active (cyan, pulsing ring,
 * clickable) or locked (dim slate, static ring, non-interactive) — the web
 * DimensionNode, and also the Discover / Start Again circles (always unlocked).
 */
export default function DimensionNode({
  center,
  delay,
  onPress,
  locked = false,
  highlighted,
  icon,
  label,
  labelColor,
  startHereBadge = false,
}: DimensionNodeProps) {
  const glowing = !locked && highlighted;
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: center.x - NODE / 2,
          top: center.y - NODE / 2,
          width: NODE,
          height: NODE,
          zIndex: 2,
        },
        nodeIn(delay),
      ]}
    >
      <Pressable
        onPress={locked ? undefined : onPress}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: locked }}
        style={{
          width: NODE,
          height: NODE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {startHereBadge && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: -60,
              right: -60,
              bottom: NODE + 14,
              alignItems: 'center',
            }}
          >
            <Animated.View
              style={[
                {
                  experimental_backgroundImage: BADGE_BG,
                  boxShadow: BADGE_SHADOW,
                  paddingVertical: 5,
                  paddingHorizontal: 11,
                  borderRadius: 999,
                },
                BADGE_BOB,
              ]}
            >
              <Text
                numberOfLines={1}
                className="font-bold uppercase text-constellation-navy-deep"
                style={{ fontSize: 10.5, letterSpacing: 10.5 * 0.1 }}
              >
                Start here
              </Text>
            </Animated.View>
          </View>
        )}

        <View
          pointerEvents="none"
          style={[
            RING,
            {
              borderWidth: 1.5,
              borderColor: locked
                ? rgb('constellation-slate-deep')
                : rgb('constellation-cyan-bright'),
              opacity: locked ? 0.4 : 0.5,
            },
          ]}
        />
        {glowing && (
          <Animated.View
            pointerEvents="none"
            style={[
              RING,
              { borderWidth: 2, borderColor: rgb('constellation-cyan-paler') },
              PULSE_FAST,
            ]}
          />
        )}
        {!locked && (
          <Animated.View
            pointerEvents="none"
            style={[
              RING,
              { borderWidth: 1.5, borderColor: rgb('constellation-cyan') },
              highlighted ? PULSE_FAST_LATE : PULSE_SLOW,
            ]}
          />
        )}

        {glowing && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[GLOW_DISC, { boxShadow: CTA_GLOW_REST }, CTA_REST_ANIM]}
            />
            <Animated.View
              pointerEvents="none"
              style={[GLOW_DISC, { boxShadow: CTA_GLOW_PEAK }, CTA_PEAK_ANIM]}
            />
          </>
        )}
        <View
          pointerEvents="none"
          style={{
            width: INNER,
            height: INNER,
            borderRadius: INNER / 2,
            alignItems: 'center',
            justifyContent: 'center',
            experimental_backgroundImage: locked ? INACTIVE_BG : ACTIVE_BG,
            boxShadow: locked
              ? INACTIVE_SHADOW
              : glowing
              ? undefined
              : ACTIVE_SHADOW,
          }}
        >
          <Svg width={23} height={23} viewBox="0 0 24 24">
            <G
              stroke={locked ? LOCKED_ICON_STROKE : rgb('constellation-navy')}
              fill="none"
              strokeWidth={2.2}
            >
              {icon}
            </G>
          </Svg>
        </View>

        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: NODE + 10,
            left: -60,
            right: -60,
            alignItems: 'center',
          }}
        >
          <Text
            numberOfLines={1}
            style={[
              font('rajdhani', 700),
              {
                fontSize: 14,
                color: labelColor ?? (locked ? SLATE_DARK : FROST),
              },
            ]}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
