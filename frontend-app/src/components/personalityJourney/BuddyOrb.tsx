import React from 'react';
import { View } from 'react-native';
import {
  Circle,
  Defs,
  FeDropShadow,
  Filter,
  G,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { stop } from '@/components/ui/svg-stop';
import { rgb } from '@/theme';
import SvgLayer from './SvgLayer';
import { ORB_BREATHE, ORB_HALO_PULSE, spin } from './animations';

const VB = 350;

const SPIN_18 = spin(18);
const SPIN_REV_26 = spin(26, true);
const SPIN_6 = spin(6);

/**
 * Phase-1 "Buddy 360" core — the web BuddyOrbScreen SVG (viewBox 350), one
 * layer per animated group so each rotates/breathes natively around 175,175.
 */
export default function BuddyOrb({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size }}>
      {/* ① Outer dotted ring — rotates clockwise 18s */}
      <SvgLayer size={size} viewBox={VB} animation={SPIN_18}>
        <Circle
          cx={175}
          cy={175}
          r={150}
          fill="none"
          stroke={rgb('constellation-cyan-bright')}
          strokeWidth={3}
          strokeDasharray="4 8"
          opacity={0.65}
        />
      </SvgLayer>

      {/* ② Inner segmented ring — counter-rotates 26s */}
      <SvgLayer size={size} viewBox={VB} animation={SPIN_REV_26}>
        <Circle
          cx={175}
          cy={175}
          r={124}
          fill="none"
          stroke={rgb('constellation-teal-deep')}
          strokeWidth={11}
          opacity={0.55}
        />
        <Circle
          cx={175}
          cy={175}
          r={124}
          fill="none"
          stroke={rgb('constellation-cyan-bright')}
          strokeWidth={11}
          strokeDasharray="20 12 46 12 20 70"
          opacity={0.9}
        />
      </SvgLayer>

      {/* ③ Thin separator ring */}
      <SvgLayer size={size} viewBox={VB}>
        <Circle
          cx={175}
          cy={175}
          r={98}
          fill="none"
          stroke={rgb('constellation-slate-navy')}
          strokeWidth={1}
          opacity={0.5}
        />
      </SvgLayer>

      {/* ④ Gold halo atmosphere */}
      <SvgLayer size={size} viewBox={VB} animation={ORB_HALO_PULSE}>
        <Defs>
          <RadialGradient id="buddyGoldHalo" cx="50%" cy="50%" r="50%">
            <Stop
              offset="55%"
              stopColor={rgb('constellation-gold-glow')}
              stopOpacity={0}
            />
            <Stop
              offset="82%"
              stopColor={rgb('constellation-gold-glow')}
              stopOpacity={0.3}
            />
            <Stop
              offset="100%"
              stopColor={rgb('constellation-gold-glow')}
              stopOpacity={0}
            />
          </RadialGradient>
        </Defs>
        <Circle cx={175} cy={175} r={101} fill="url(#buddyGoldHalo)" />
      </SvgLayer>

      {/* ⑤ Inner sphere — breathing */}
      <SvgLayer size={size} viewBox={VB} animation={ORB_BREATHE}>
        <Defs>
          <RadialGradient id="buddyCoreGrad" cx="50%" cy="42%" r="60%">
            <Stop offset="0%" {...stop(rgb('constellation-gold-cream'))} />
            <Stop offset="22%" {...stop(rgb('constellation-gold-bright'))} />
            <Stop offset="52%" {...stop(rgb('constellation-cyan'))} />
            <Stop offset="100%" {...stop(rgb('constellation-cyan-deep'))} />
          </RadialGradient>
        </Defs>
        <Circle cx={175} cy={175} r={63} fill="url(#buddyCoreGrad)" />
      </SvgLayer>

      {/* ⑥ Gold accent dashes — fast spin 6s, drop-shadow(0 0 6px gold-glow2 / .9) */}
      <SvgLayer size={size} viewBox={VB} animation={SPIN_6}>
        <Defs>
          <Filter
            id="buddyDashGlow"
            filterUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={VB}
            height={VB}
          >
            <FeDropShadow
              dx={0}
              dy={0}
              stdDeviation={3}
              floodColor={rgb('constellation-gold-glow2')}
              floodOpacity={0.9}
            />
          </Filter>
        </Defs>
        <G filter="url(#buddyDashGlow)">
          <Circle
            cx={175}
            cy={175}
            r={76}
            fill="none"
            stroke={rgb('constellation-gold-bright')}
            strokeWidth={1.6}
            strokeDasharray="14 206"
            opacity={0.85}
          />
        </G>
      </SvgLayer>

      {/* ⑦ Lightning bolt */}
      <SvgLayer size={size} viewBox={VB}>
        <Path
          d="M175 152.5 L155 185 L170 185 L160 210 L195 172.5 L177.5 172.5 Z"
          fill={rgb('constellation-navy')}
          opacity={0.9}
        />
      </SvgLayer>
    </View>
  );
}
