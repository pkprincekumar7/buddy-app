import React, { useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { rgb } from '@/theme';

/**
 * Drifting, twinkling starfield — RN port of the web canvas Starfield, the
 * ambient backdrop for the Growth Map. Same density (one star per 7000px²),
 * radii, alphas and upward drift speed (0.14·speed px per 60fps frame); each
 * star is an Animated.View driven by Reanimated CSS animations, so nothing
 * runs on the JS thread. Honours reduced motion with a static field.
 */
export default function Starfield({ opacity = 0.55 }: { opacity?: number }) {
  const { width: w, height: h } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const stars = useMemo(
    () =>
      Array.from({ length: Math.round((w * h) / 7000) }, () => {
        const speed = Math.random() * 0.9 + 0.25;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.3 + 0.25,
          a: Math.random() * 0.7 + 0.15,
          // px/s at 60fps, as on the web
          pxPerSec: speed * 0.14 * 60,
          // the web's sin(phase += 0.02/frame) twinkle → a 2π/(0.02·60) ≈ 5.2s cycle
          twinkleDelay: -Math.random() * 5.2,
        };
      }),
    [w, h],
  );

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute inset-0"
      style={{ opacity }}
    >
      {stars.map((s, i) => {
        const travel = h + 4;
        const duration = travel / s.pxPerSec;
        // Start each star part-way through its drift so the field begins full.
        const startOffset = -((h - s.y) / travel) * duration;
        return (
          <Animated.View
            key={i}
            style={[
              {
                position: 'absolute',
                left: s.x - s.r,
                top: h + 2 - s.r,
                width: s.r * 2,
                height: s.r * 2,
                borderRadius: s.r,
                backgroundColor: rgb('starfield', s.a),
              },
              reduceMotion
                ? { transform: [{ translateY: s.y - h - 2 }] }
                : {
                    animationName: [
                      {
                        from: { transform: [{ translateY: 0 }] },
                        to: { transform: [{ translateY: -travel }] },
                      },
                      {
                        '0%': { opacity: 1 },
                        '50%': { opacity: 0.3 / 0.65 },
                        '100%': { opacity: 1 },
                      },
                    ],
                    animationDuration: [`${duration}s`, '5.2s'],
                    animationDelay: [`${startOffset}s`, `${s.twinkleDelay}s`],
                    animationIterationCount: 'infinite',
                    animationTimingFunction: ['linear', 'ease-in-out'],
                  },
            ]}
          />
        );
      })}
    </View>
  );
}
