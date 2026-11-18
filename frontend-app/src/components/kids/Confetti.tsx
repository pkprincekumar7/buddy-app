import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  cubicBezier,
  useReducedMotion,
  type CSSAnimationKeyframes,
} from 'react-native-reanimated';
import { rgb } from '@/theme';

/** The pieces' colours (web Confetti, the prototype's): cyan, gold, ice, cyan-bright, gold. */
const COLORS = [
  'kids-discover',
  'kids-gold',
  'kids-world-name',
  'kids-orb-sky',
  'kids-gold',
] as const;
const PIECES = 46;
const FLING = cubicBezier(0.15, 0.7, 0.4, 1);

/** web kids-ring: a ring that grows from .3 to 3.2 times its size as it fades. */
const RING: CSSAnimationKeyframes = {
  from: { opacity: 0.9, transform: [{ scale: 0.3 }] },
  to: { opacity: 0, transform: [{ scale: 3.2 }] },
};

interface Piece {
  color: string;
  fly: CSSAnimationKeyframes;
  width: number;
  round: boolean;
  delay: number;
  duration: number;
}

/** 46 pieces flung out from the middle, each its own way, pace and spin (web makePieces). */
function makePieces(rand: () => number = Math.random): Piece[] {
  return Array.from({ length: PIECES }, (_, i) => {
    const angle = rand() * Math.PI * 2;
    const reach = 120 + rand() * 260;
    const turn = rand() * 720 - 360;
    return {
      color: rgb(COLORS[i % COLORS.length] ?? 'kids-gold'),
      fly: {
        from: {
          opacity: 1,
          transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }],
        },
        to: {
          opacity: 0,
          transform: [
            { translateX: Math.cos(angle) * reach },
            { translateY: Math.sin(angle) * reach + 120 },
            { rotate: `${turn}deg` },
          ],
        },
      },
      width: 6 + rand() * 6,
      round: i % 3 === 0,
      delay: 0.5 + rand() * 1.6,
      duration: 1.4 + rand() * 1,
    };
  });
}

/**
 * Confetti (web components/kids/Confetti, the prototype's): a cyan and a gold ring that grow
 * and fade, and 46 pieces flung out from the middle, once, when it mounts (Discover on
 * opening, a Grow world's report). Fills its parent; none when the device asks for reduced
 * motion.
 */
export default function Confetti() {
  const reduced = useReducedMotion();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const pieces = useMemo(() => makePieces(), []);
  if (reduced) return null;
  // The rings: min(34%, 220px) of the box, centred.
  const ring = Math.min(0.34 * box.width, 220);
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 4,
      }}
      onLayout={e =>
        setBox({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })
      }
    >
      {box.width > 0
        ? [0, 1].map(k => (
            <Animated.View
              key={`ring-${k}`}
              style={{
                position: 'absolute',
                width: ring,
                height: ring,
                left: (box.width - ring) / 2,
                top: (box.height - ring) / 2,
                borderRadius: ring / 2,
                borderWidth: 2,
                borderColor: rgb(k ? 'kids-gold' : 'kids-discover'),
                opacity: 0,
                animationName: RING,
                animationDuration: '1.4s',
                animationDelay: `${0.35 + k * 0.5}s`,
                animationTimingFunction: 'ease-out',
                // Back at its hidden start once done (web `backwards`).
                animationFillMode: 'backwards',
              }}
            />
          ))
        : null}
      {box.width > 0
        ? pieces.map((p, i) => (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                left: box.width / 2,
                top: box.height * 0.46,
                width: p.width,
                height: p.round ? p.width : p.width * 0.45,
                borderRadius: p.round ? p.width / 2 : 2,
                backgroundColor: p.color,
                boxShadow: `0 0 6px ${p.color}`,
                opacity: 0,
                animationName: p.fly,
                animationDuration: `${p.duration}s`,
                animationDelay: `${p.delay}s`,
                animationTimingFunction: FLING,
                // Back at its hidden start once done (web `backwards`).
                animationFillMode: 'backwards',
              }}
            />
          ))
        : null}
    </View>
  );
}
