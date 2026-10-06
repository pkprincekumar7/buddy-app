import React from 'react';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import {
  Circle,
  Defs,
  FeDropShadow,
  Filter,
  G,
  Path,
  RadialGradient,
  Text as SvgText,
  TextPath,
  Stop,
} from 'react-native-svg';
import { stop } from '@/components/ui/svg-stop';
import { css, fonts, rgb } from '@/theme';
import SvgLayer from './SvgLayer';
import {
  HUB_HALO_PULSE,
  HUB_IN,
  fadeInOut,
  fadeOutIn,
  spin,
} from './animations';

const HUB = 190;

const SPIN_18 = spin(18);
const SPIN_REV_26 = spin(26, true);
const SPIN_6 = spin(6);
const SPIN_32 = spin(32);

// Phase-2 `buddyGoldBreathe 3.2s` animates the core's drop-shadow between these
// two glows; on RN that is a cross-fade between two box-shadowed discs behind it.
const CORE_GLOW_REST = css(
  '0 0 14px rgb(var(--constellation-gold-glow-rgb) / .65), 0 0 30px rgb(var(--constellation-cyan-rgb) / .45)',
);
const CORE_GLOW_PEAK = css(
  '0 0 26px rgb(var(--constellation-gold-glow2-rgb) / .95), 0 0 54px rgb(var(--constellation-cyan-rgb) / .55)',
);
const CORE_REST_ANIM = fadeOutIn(3.2);
const CORE_PEAK_ANIM = fadeInOut(3.2);
const CORE_R = 36;
const CORE_DISC = {
  position: 'absolute',
  left: HUB / 2 - CORE_R,
  top: HUB / 2 - CORE_R,
  width: CORE_R * 2,
  height: CORE_R * 2,
  borderRadius: CORE_R,
  backgroundColor: rgb('constellation-cyan'),
} as const;

const NBSP2 = '  ';
const HUB_TEXT = `HOME${NBSP2}•${NBSP2}`.repeat(6);

/** The 190px center HUD — tapping it returns to the phase-1 orb ("home"). */
export default function HubOrb({ onPress }: { onPress: () => void }) {
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 350 - HUB / 2,
          top: 350 - HUB / 2,
          width: HUB,
          height: HUB,
          zIndex: 3,
        },
        HUB_IN,
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Return home"
        style={{ width: HUB, height: HUB }}
      >
        <SvgLayer size={HUB} viewBox={HUB} animation={SPIN_18}>
          <Circle
            cx={95}
            cy={95}
            r={86}
            fill="none"
            stroke={rgb('constellation-cyan-bright')}
            strokeWidth={2.4}
            strokeDasharray="3.5 6.5"
            opacity={0.65}
          />
        </SvgLayer>

        <SvgLayer size={HUB} viewBox={HUB} animation={SPIN_REV_26}>
          <Circle
            cx={95}
            cy={95}
            r={71}
            fill="none"
            stroke={rgb('constellation-teal-deep')}
            strokeWidth={8}
            opacity={0.55}
          />
          <Circle
            cx={95}
            cy={95}
            r={71}
            fill="none"
            stroke={rgb('constellation-cyan-bright')}
            strokeWidth={8}
            strokeDasharray="13 8 30 8 13 46"
            opacity={0.9}
          />
        </SvgLayer>

        <SvgLayer size={HUB} viewBox={HUB}>
          <Circle
            cx={95}
            cy={95}
            r={56}
            fill="none"
            stroke={rgb('constellation-slate-navy')}
            strokeWidth={1}
            opacity={0.5}
          />
        </SvgLayer>

        <SvgLayer size={HUB} viewBox={HUB} animation={HUB_HALO_PULSE}>
          <Defs>
            <RadialGradient id="goldHaloHub" cx="50%" cy="50%" r="50%">
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
          <Circle cx={95} cy={95} r={58} fill="url(#goldHaloHub)" />
        </SvgLayer>

        {/* Core drop-shadow glow (buddyGoldBreathe) */}
        <Animated.View
          pointerEvents="none"
          style={[CORE_DISC, { boxShadow: CORE_GLOW_REST }, CORE_REST_ANIM]}
        />
        <Animated.View
          pointerEvents="none"
          style={[CORE_DISC, { boxShadow: CORE_GLOW_PEAK }, CORE_PEAK_ANIM]}
        />

        <SvgLayer size={HUB} viewBox={HUB}>
          <Defs>
            <RadialGradient id="coreGradHub" cx="50%" cy="42%" r="60%">
              <Stop offset="0%" {...stop(rgb('constellation-gold-cream'))} />
              <Stop offset="22%" {...stop(rgb('constellation-gold-bright'))} />
              <Stop offset="52%" {...stop(rgb('constellation-cyan'))} />
              <Stop offset="100%" {...stop(rgb('constellation-cyan-deep'))} />
            </RadialGradient>
          </Defs>
          <Circle cx={95} cy={95} r={CORE_R} fill="url(#coreGradHub)" />
        </SvgLayer>

        <SvgLayer size={HUB} viewBox={HUB} animation={SPIN_6}>
          <Defs>
            <Filter
              id="hubDashGlow"
              filterUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={HUB}
              height={HUB}
            >
              <FeDropShadow
                dx={0}
                dy={0}
                stdDeviation={2.5}
                floodColor={rgb('constellation-gold-glow2')}
                floodOpacity={0.9}
              />
            </Filter>
          </Defs>
          <G filter="url(#hubDashGlow)">
            <Circle
              cx={95}
              cy={95}
              r={43}
              fill="none"
              stroke={rgb('constellation-gold-bright')}
              strokeWidth={1.2}
              strokeDasharray="8 118"
              opacity={0.85}
            />
          </G>
        </SvgLayer>

        <SvgLayer size={HUB} viewBox={HUB}>
          <Path
            d="M95 80 L83 100 L92 100 L86 116 L108 92 L97 92 Z"
            fill={rgb('constellation-navy')}
            opacity={0.9}
          />
        </SvgLayer>

        <SvgLayer size={HUB} viewBox={HUB} animation={SPIN_32}>
          <Defs>
            <Path id="hubTextPath" d="M95,49 A46,46 0 1,1 94.9,49" />
          </Defs>
          <SvgText
            fill={rgb('constellation-cyan')}
            fontFamily={fonts.rajdhaniBold}
            fontSize={8.5}
            letterSpacing={8.5 * 0.13}
          >
            <TextPath href="#hubTextPath" startOffset="0%">
              {HUB_TEXT}
            </TextPath>
          </SvgText>
        </SvgLayer>
      </Pressable>
    </Animated.View>
  );
}
