import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Portal } from '@/components/ui/portal';
import Animated from 'react-native-reanimated';
import { css, rgb } from '@/theme';
import WarpStreaks from './WarpStreaks';
import { NEBULA_DRIFT, VOID_VEIL } from './animations';

const NEBULA = 520;
const NEBULA_BG = css(
  'radial-gradient(circle, rgb(var(--constellation-teal-deep-rgb) / 0.9) 0%, rgb(var(--constellation-cyan-bright-rgb) / 0.35) 38%, transparent 70%)',
);

/**
 * The warp-enter overlays (web: three `position: fixed` layers at z 50–52 that
 * cover the header too): the nebula bloom, the navy void veil and the
 * hyperspace-streak canvas. A Portal keeps them above the header
 * and above the DimensionCircles screen that is pushed mid-warp, exactly like
 * the web where they outlive the route change. Mount it only while warping.
 */
export default function WarpOverlay() {
  const { width, height } = useWindowDimensions();
  return (
    <Portal>
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: width / 2 - NEBULA / 2,
              top: height / 2 - NEBULA / 2,
              width: NEBULA,
              height: NEBULA,
              borderRadius: NEBULA / 2,
              experimental_backgroundImage: NEBULA_BG,
            },
            NEBULA_DRIFT,
          ]}
        />
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: rgb('constellation-navy-deep') },
            VOID_VEIL,
          ]}
        />
        <WarpStreaks width={width} height={height} />
      </View>
    </Portal>
  );
}
