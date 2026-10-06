import React from 'react';
import { Text } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { font, rgb } from '@/theme';
import { em } from './styles';

/**
 * The page's outlined pill ("Try again" / "Go to Grow" / "Done"): cyan hairline
 * on navy-dusk, uppercase Rajdhani with wide tracking.
 */
export default function PillButton({
  label,
  onPress,
  marginTop,
  paddingVertical = 11,
  paddingHorizontal = 26,
}: {
  label: string;
  onPress: () => void;
  marginTop: number;
  paddingVertical?: number;
  paddingHorizontal?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: 'center',
        marginTop,
        paddingVertical,
        paddingHorizontal,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: rgb('constellation-cyan', 0.45),
        backgroundColor: rgb('constellation-navy-dusk', 0.8),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          ...font('rajdhani', 700),
          fontSize: 12.5,
          letterSpacing: em(12.5, 0.16),
          textTransform: 'uppercase',
          color: rgb('constellation-cyan-soft'),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
