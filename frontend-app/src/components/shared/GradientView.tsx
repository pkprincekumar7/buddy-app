/**
 * Shared SVG-based gradient utilities for React Native.
 *
 * NativeWind v4 does NOT support CSS gradient utilities (bg-gradient-to-*, from-*, to-*)
 * in React Native. These helpers provide gradient backgrounds using react-native-svg,
 * matching the web's Tailwind gradient visuals exactly.
 */
import React, { useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator } from 'react-native';
import type { ViewStyle, TouchableOpacityProps } from 'react-native';
import Svg, {
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
  Defs,
} from 'react-native-svg';

// ── Tailwind area.color → hex gradient pairs ──────────────────────────────────

/** Maps Tailwind growth-area `.color` strings to actual hex gradient pairs. */
export const AREA_GRADIENT_COLORS: Record<
  string,
  { from: string; to: string }
> = {
  'from-purple-500 to-indigo-600': { from: '#a855f7', to: '#4f46e5' },
  'from-rose-500 to-pink-600': { from: '#f43f5e', to: '#db2777' },
  'from-blue-500 to-cyan-600': { from: '#3b82f6', to: '#0891b2' },
  'from-amber-500 to-orange-600': { from: '#f59e0b', to: '#ea580c' },
  'from-emerald-500 to-teal-600': { from: '#10b981', to: '#0d9488' },
  'from-violet-500 to-purple-600': { from: '#8b5cf6', to: '#9333ea' },
};

/** Lighter tile palette used in GrowthAreasActivityGame. */
export const TILE_GRADIENT_COLORS: Record<
  string,
  { from: string; to: string }
> = {
  'from-purple-400 to-indigo-500': { from: '#c084fc', to: '#6366f1' },
  'from-rose-400 to-pink-500': { from: '#fb7185', to: '#ec4899' },
  'from-amber-400 to-orange-500': { from: '#fbbf24', to: '#f97316' },
  'from-emerald-400 to-teal-500': { from: '#34d399', to: '#14b8a6' },
  'from-blue-400 to-cyan-500': { from: '#60a5fa', to: '#06b6d4' },
  'from-violet-400 to-purple-500': { from: '#a78bfa', to: '#a855f7' },
};

const FALLBACK = { from: '#14b8a6', to: '#0d9488' };

export function areaGrad(colorClass: string): { from: string; to: string } {
  return AREA_GRADIENT_COLORS[colorClass] ?? FALLBACK;
}

export function tileGrad(colorClass: string): { from: string; to: string } {
  return TILE_GRADIENT_COLORS[colorClass] ?? FALLBACK;
}

// ── GradientIconBox ───────────────────────────────────────────────────────────

interface GradientIconBoxProps {
  /** Tailwind area.color class, e.g. 'from-purple-500 to-indigo-600'. */
  color?: string;
  /** Direct hex overrides (take priority over `color`). */
  from?: string;
  to?: string;
  size?: number;
  radius?: number;
  /** true = top-left → bottom-right diagonal (default); false = left → right */
  diagonal?: boolean;
  children: React.ReactNode;
}

export function GradientIconBox({
  color,
  from: fromOverride,
  to: toOverride,
  size = 44,
  radius = 12,
  diagonal = true,
  children,
}: GradientIconBoxProps) {
  const base = color ? areaGrad(color) : FALLBACK;
  const gradFrom = fromOverride ?? base.from;
  const gradTo = toOverride ?? base.to;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Defs>
          <SvgLinearGradient
            id="iconGrad"
            x1="0"
            y1="0"
            x2="1"
            y2={diagonal ? '1' : '0'}
          >
            <Stop offset="0%" stopColor={gradFrom} />
            <Stop offset="100%" stopColor={gradTo} />
          </SvgLinearGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#iconGrad)" rx={radius} />
      </Svg>
      {children}
    </View>
  );
}

// ── GradientButton ────────────────────────────────────────────────────────────

interface GradientButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  color?: string;
  from?: string;
  to?: string;
  height?: number;
  borderRadius?: number;
  loading?: boolean;
  style?: ViewStyle;
  children?: React.ReactNode;
}

// ── GradientSurface ───────────────────────────────────────────────────────────
// Full-bleed SVG gradient background for headers and cards.
// NativeWind v4 does not support CSS gradient utilities in React Native,
// so this component replicates web `bg-gradient-to-r/br` visually.

interface GradientSurfaceProps {
  from: string;
  to: string;
  /** false = left→right (to-r); true = top-left→bottom-right (to-br) */
  diagonal?: boolean;
  className?: string;
  style?: ViewStyle;
  children: React.ReactNode;
}

export function GradientSurface({
  from: fromColor,
  to: toColor,
  diagonal = false,
  className,
  style,
  children,
}: GradientSurfaceProps) {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  return (
    <View
      className={className}
      style={[{ overflow: 'hidden' }, style]}
      onLayout={e =>
        setDims({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      {dims.w > 0 && dims.h > 0 && (
        <Svg
          width={dims.w}
          height={dims.h}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <Defs>
            <SvgLinearGradient
              id="gsGrad"
              x1="0"
              y1="0"
              x2="1"
              y2={diagonal ? '1' : '0'}
            >
              <Stop offset="0%" stopColor={fromColor} />
              <Stop offset="100%" stopColor={toColor} />
            </SvgLinearGradient>
          </Defs>
          <Rect width={dims.w} height={dims.h} fill="url(#gsGrad)" />
        </Svg>
      )}
      {children}
    </View>
  );
}

export function GradientButton({
  color,
  from: fromOverride,
  to: toOverride,
  height = 48,
  borderRadius = 16,
  loading,
  disabled,
  style,
  children,
  onPress,
  ...rest
}: GradientButtonProps) {
  const base = color ? areaGrad(color) : FALLBACK;
  const gradFrom = fromOverride ?? base.from;
  const gradTo = toOverride ?? base.to;
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={isDisabled ? 1 : 0.8}
      disabled={isDisabled}
      onPress={onPress}
      onLayout={e =>
        setDims({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
      style={[
        {
          height,
          borderRadius,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isDisabled ? 0.5 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {dims.w > 0 && dims.h > 0 && (
        <Svg
          width={dims.w}
          height={dims.h}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <Defs>
            <SvgLinearGradient id="btnGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={gradFrom} />
              <Stop offset="100%" stopColor={gradTo} />
            </SvgLinearGradient>
          </Defs>
          <Rect
            width={dims.w}
            height={dims.h}
            fill="url(#btnGrad)"
            rx={borderRadius}
          />
        </Svg>
      )}
      {loading ? <ActivityIndicator color="#0a0a0a" /> : children}
    </TouchableOpacity>
  );
}
