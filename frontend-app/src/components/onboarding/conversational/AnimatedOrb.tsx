import React from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { css, gradient, recipe, rgb } from '@/theme';

/**
 * Web `AnimatedOrb`. `--orb-size` is the single knob (120px at phone width):
 * the ring inset and the crescent geometry are fractions of it, exactly as in
 * the web's index.css `.orb-ring` / `.orb-crescent`.
 */
const ORB_SIZE = 120;

// .orb-crescent — an (size·2/3 × size/3) ellipse box with only a bottom
// border of size/24, rotated −25°, at left size/6, top size·0.4.
const CRESCENT_W = (ORB_SIZE * 2) / 3;
const CRESCENT_H = ORB_SIZE / 3;
const CRESCENT_STROKE = ORB_SIZE / 24;
// The bottom border of a 50%-radius box: outer edge is the lower half of the
// (w/2 × h/2) ellipse; the inner (padding) edge is the lower half of the
// (w/2 × (h/2 − stroke)) ellipse sharing the same centre — a tapered arc.
const RX = CRESCENT_W / 2;
const RY_OUTER = CRESCENT_H / 2;
const RY_INNER = RY_OUTER - CRESCENT_STROKE;
const CRESCENT_PATH = `M0,${RY_OUTER} A${RX},${RY_OUTER} 0 0 0 ${CRESCENT_W},${RY_OUTER} A${RX},${RY_INNER} 0 0 1 0,${RY_OUTER} Z`;

const ORB_MAIN_SHADOW = css('0 0 45px rgb(var(--chatbar-glow-rgb) / 0.5)');

// framer: animate={{ scale: [1, 1.3, 1], opacity: [0.35, 0.65, 0.35] }}, 4s, easeInOut, infinite.
const AMBIENT_PULSE = {
  '0%': { transform: [{ scale: 1 }], opacity: 0.35 },
  '50%': { transform: [{ scale: 1.3 }], opacity: 0.65 },
  '100%': { transform: [{ scale: 1 }], opacity: 0.35 },
};

export default function AnimatedOrb() {
  return (
    <View
      pointerEvents="none"
      className="relative"
      style={{ width: ORB_SIZE, height: ORB_SIZE }}
    >
      {/* Pulsing ambient glow (web also blurs it 10px — RN has no cross-platform blur; the radial falloff carries it). */}
      <Animated.View
        className="absolute -bottom-4 -left-4 -right-4 -top-4 rounded-full"
        style={{
          experimental_backgroundImage: gradient.orbAmbient,
          animationName: AMBIENT_PULSE,
          animationDuration: '4s',
          animationIterationCount: 'infinite',
          animationTimingFunction: 'ease-in-out',
        }}
      />
      {/* Main orb — multi-radial gradient */}
      <View
        className="relative rounded-full"
        style={{
          width: ORB_SIZE,
          height: ORB_SIZE,
          experimental_backgroundImage: gradient.orbMain,
          boxShadow: ORB_MAIN_SHADOW,
        }}
      >
        {/* Inner ring — inset size/24 */}
        <View
          className="absolute"
          style={[
            recipe.orbRing,
            {
              top: ORB_SIZE / 24,
              left: ORB_SIZE / 24,
              right: ORB_SIZE / 24,
              bottom: ORB_SIZE / 24,
            },
          ]}
        />
        {/* Crescent arc */}
        <Svg
          width={CRESCENT_W}
          height={CRESCENT_H}
          viewBox={`0 0 ${CRESCENT_W} ${CRESCENT_H}`}
          style={{
            position: 'absolute',
            left: ORB_SIZE / 6,
            top: ORB_SIZE * 0.4,
            transform: [{ rotate: '-25deg' }],
          }}
        >
          <Path d={CRESCENT_PATH} fill={rgb('orb-crescent')} />
        </Svg>
      </View>
    </View>
  );
}
