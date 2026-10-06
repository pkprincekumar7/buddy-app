import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type CSSAnimationProperties } from 'react-native-reanimated';
import Svg from 'react-native-svg';

interface SvgLayerProps {
  /** Rendered size in px (the layer is square). */
  size: number;
  /** viewBox side length — every layer of one graphic shares it, so geometry is identical to the web SVG. */
  viewBox: number;
  /** CSS-animation style (rotation / scale / opacity) for this layer. The pivot is the
   *  layer's center, which is the web `transform-origin: {c}px {c}px` of a centered ring. */
  animation?: CSSAnimationProperties;
  children: React.ReactNode;
}

/**
 * One animated slice of a web SVG. The web animates individual `<g>`/`<circle>`
 * elements with CSS transforms around the SVG center; on RN each animated
 * group becomes its own full-size Svg stacked in an Animated.View, so the
 * rotation/scale runs natively while the geometry stays in the same viewBox.
 */
export default function SvgLayer({
  size,
  viewBox,
  animation,
  children,
}: SvgLayerProps) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { width: size, height: size },
        animation,
      ]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${viewBox} ${viewBox}`}>
        {children}
      </Svg>
    </Animated.View>
  );
}
