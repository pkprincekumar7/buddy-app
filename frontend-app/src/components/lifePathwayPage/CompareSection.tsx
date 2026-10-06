import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { COPY } from '@/lib/lifePathwayData';
import { css } from '@/theme';
import { LP_PALETTE } from './palette';
import { GOLD, IS_MOBILE, em, fadeUp, orbitron, rajdhani } from './styles';

const SUPER_BG = `linear-gradient(155deg,${LP_PALETTE.compareFrom},${LP_PALETTE.compareTo})`;
const SUPER_BORDER = css('rgb(var(--constellation-gold-rgb) / .45)');
const SUPER_SHADOW = css(
  '0 20px 70px rgb(var(--constellation-cyan-rgb) / .10)',
);
const SUPER_ORB = css(
  'radial-gradient(circle,rgb(var(--constellation-cyan-rgb) / .18),rgb(var(--constellation-cyan-rgb) / 0) 70%)',
);
const GOLD_CREAM2 = css('rgb(var(--constellation-gold-cream2-rgb))');
const ROUTINE_BG = css('rgb(var(--constellation-void-soft-rgb) / .55)');
const ROUTINE_BORDER = css('rgb(var(--constellation-ring-faint-rgb) / .16)');
const SLATE_LIGHT = css('rgb(var(--constellation-slate-light-rgb))');

/** Superpower version vs routine version cards. */
export default function CompareSection({
  t,
  reducedMotion,
}: {
  t: (text: string) => string;
  reducedMotion: boolean;
}) {
  return (
    <Animated.View
      style={[{ marginTop: IS_MOBILE ? 48 : 72 }, fadeUp(0.3, reducedMotion)]}
    >
      <View style={{ gap: 18, marginTop: 30 }}>
        <View
          style={{
            position: 'relative',
            borderRadius: 22,
            paddingVertical: 28,
            paddingHorizontal: 30,
            experimental_backgroundImage: SUPER_BG,
            borderWidth: 1,
            borderColor: SUPER_BORDER,
            overflow: 'hidden',
            boxShadow: SUPER_SHADOW,
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: -40,
              bottom: -70,
              width: 240,
              height: 240,
              borderRadius: 120,
              experimental_backgroundImage: SUPER_ORB,
            }}
          />
          <Text
            accessibilityRole="header"
            style={[orbitron(20), { color: GOLD_CREAM2 }]}
          >
            {COPY.compareSuperTitle}
          </Text>
          <Text
            style={[
              rajdhani(14, 700, 1.45),
              { marginTop: 9, letterSpacing: em(14, 0.02), color: GOLD },
            ]}
          >
            {t(COPY.compareSuperLead)}
          </Text>
          <Text
            style={[
              rajdhani(14.5, 600, 1.5),
              { marginTop: 12, color: LP_PALETTE.compareSuperBody },
            ]}
          >
            {t(COPY.compareSuperBody)}
          </Text>
        </View>
        <View
          style={{
            borderRadius: 22,
            paddingVertical: 28,
            paddingHorizontal: 30,
            backgroundColor: ROUTINE_BG,
            borderWidth: 1,
            borderColor: ROUTINE_BORDER,
          }}
        >
          <Text
            accessibilityRole="header"
            style={[orbitron(20, 700), { color: SLATE_LIGHT }]}
          >
            {COPY.compareRoutineTitle}
          </Text>
          <Text
            style={[
              rajdhani(14, 700, 1.45),
              { marginTop: 9, letterSpacing: em(14, 0.02), color: SLATE_LIGHT },
            ]}
          >
            {t(COPY.compareRoutineLead)}
          </Text>
          <Text
            style={[
              rajdhani(14.5, 600, 1.5),
              { marginTop: 12, color: LP_PALETTE.compareRoutineBody },
            ]}
          >
            {t(COPY.compareRoutineBody)}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}
