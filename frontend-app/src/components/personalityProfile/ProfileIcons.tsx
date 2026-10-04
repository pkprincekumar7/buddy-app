/**
 * Geometric trait/strength icons and the inline share/arrow SVGs from the web
 * PersonalityProfile page.
 */
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { css, rgb } from '@/theme';
import { PP } from './palette';

const BLUE = rgb('constellation-blue');
const GOLD = rgb('constellation-gold-light');

// 6 geometric trait shapes. Each entry is the base shape + its own rotation
// (the web composes `scale(innerScale) <shape transform>`).
const TRAIT_SHAPES: { style: ViewStyle; rotate?: string }[] = [
  {
    style: {
      width: 16,
      height: 16,
      borderWidth: 2,
      borderColor: BLUE,
      borderRadius: 8,
    },
  },
  { style: { width: 14, height: 14, backgroundColor: BLUE }, rotate: '45deg' },
  {
    style: {
      width: 18,
      height: 2,
      backgroundColor: BLUE,
      boxShadow: css(
        '0 6px 0 rgb(var(--constellation-blue-rgb)), 0 -6px 0 rgb(var(--constellation-blue-rgb) / .5)',
      ),
    },
  },
  {
    style: {
      width: 16,
      height: 16,
      borderWidth: 2,
      borderColor: BLUE,
      borderRadius: 3,
    },
  },
  {
    style: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: BLUE,
      boxShadow: css(
        '-10px 0 0 rgb(var(--constellation-blue-rgb) / .45), 10px 0 0 rgb(var(--constellation-blue-rgb) / .45)',
      ),
    },
  },
  {
    style: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: BLUE,
      borderRightColor: 'transparent',
      borderBottomColor: 'transparent',
    },
    rotate: '45deg',
  },
];

export function TraitIcon({
  index,
  containerSize = 46,
}: {
  index: number;
  containerSize?: number;
}) {
  const innerScale = containerSize / 46;
  const shape = TRAIT_SHAPES[index % 6] ?? TRAIT_SHAPES[0];
  const transform: ViewStyle['transform'] = shape?.rotate
    ? [{ scale: innerScale }, { rotate: shape.rotate }]
    : [{ scale: innerScale }];
  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        borderRadius: containerSize / 2,
        borderWidth: 1,
        borderColor: PP.traitIconBorder,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PP.traitIconBg,
        flexShrink: 0,
      }}
    >
      <View style={[shape?.style, { transform }]} />
    </View>
  );
}

// 4 strength icons
export function StrengthIcon({ index }: { index: number }) {
  if (index === 0)
    return (
      <View
        style={{
          width: 34,
          height: 34,
          borderWidth: 2,
          borderColor: GOLD,
          borderRadius: 4,
          transform: [{ rotate: '45deg' }],
        }}
      />
    );
  if (index === 1)
    return (
      <View
        style={{
          width: 34,
          height: 34,
          borderWidth: 2,
          borderColor: BLUE,
          borderRadius: 17,
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 9,
            left: 9,
            right: 9,
            bottom: 9,
            borderRadius: 999,
            backgroundColor: GOLD,
          }}
        />
      </View>
    );
  if (index === 2)
    return (
      <View
        style={{ width: 34, height: 34, borderWidth: 2, borderColor: BLUE }}
      />
    );
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 2,
        borderColor: BLUE,
        borderTopColor: GOLD,
        borderRightColor: GOLD,
      }}
    />
  );
}

export function InstagramIcon({ color }: { color: string }) {
  return (
    <Svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <Path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <Line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </Svg>
  );
}

export function WhatsAppIcon({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill={color}>
      <Path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <Path d="M11.99 1C5.925 1 1 5.925 1 11.99c0 2.096.541 4.063 1.485 5.775L1 23l5.39-1.455A10.93 10.93 0 0 0 11.99 23C18.055 23 23 18.075 23 12.01 23 5.945 18.055 1 11.99 1zm0 19.956a8.927 8.927 0 0 1-4.556-1.243l-.326-.194-3.199.863.864-3.112-.213-.338A8.955 8.955 0 0 1 3.044 12.01C3.044 7.05 7.04 3.044 11.99 3.044c4.95 0 8.956 3.996 8.956 8.956s-3.996 8.956-8.956 8.956z" />
    </Svg>
  );
}

export function ArrowRightIcon({ color }: { color: string }) {
  return (
    <Svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
    >
      <Path d="M5 12h13M12 6l6 6-6 6" />
    </Svg>
  );
}
