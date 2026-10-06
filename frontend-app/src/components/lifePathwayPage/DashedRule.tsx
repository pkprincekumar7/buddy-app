import React, { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';

/**
 * A 1px dashed horizontal rule — the web's `border-top: 1px dashed …`. RN's
 * `borderStyle: 'dashed'` cannot be applied to a single side reliably on iOS,
 * so the dash is drawn with an SVG line across the measured width instead.
 */
export default function DashedRule({
  color,
  style,
}: {
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [width, setWidth] = useState(0);
  return (
    <View
      style={[{ height: 1 }, style]}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {width > 0 ? (
        <Svg width={width} height={1}>
          <Line
            x1={0}
            y1={0.5}
            x2={width}
            y2={0.5}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </Svg>
      ) : null}
    </View>
  );
}
