import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { COPY } from '@/lib/lifePathwayData';
import { css } from '@/theme';
import { LP_PALETTE } from './palette';
import {
  CYAN,
  EYEBROW,
  IS_MOBILE,
  em,
  fadeUp,
  orbitron,
  rajdhani,
} from './styles';

const CARD_BG = `linear-gradient(150deg,${LP_PALETTE.superCardFrom},${LP_PALETTE.superCardTo})`;
const CARD_BORDER = css('rgb(var(--constellation-gold-rgb) / .4)');
const CARD_SHADOW = css(
  '0 0 60px rgb(var(--constellation-gold-rgb) / .10) inset',
);
const CARD_ORB = css(
  'radial-gradient(circle,rgb(var(--constellation-gold-rgb) / .22),rgb(var(--constellation-gold-rgb) / 0) 70%)',
);
const GOLD_CREAM2 = css('rgb(var(--constellation-gold-cream2-rgb))');
const TRAIT_BORDER = css('rgb(var(--constellation-gold-rgb) / .45)');
const GOLD_PALE = css('rgb(var(--constellation-gold-pale-rgb))');
const FIRST_TEN_BG = css(
  'linear-gradient(150deg,rgb(var(--constellation-navy-panel3-rgb) / .8),rgb(var(--constellation-ink-navy-rgb) / .8))',
);
const FIRST_TEN_BORDER = css('rgb(var(--constellation-cyan-rgb) / .22)');
const SLATE_COOL = css('rgb(var(--constellation-slate-cool-rgb))');

/** web `clamp(22px,2.5vw,30px)` at phone width. */
const TITLE_SIZE = 22;

interface SuperpowerSectionProps {
  t: (text: string) => string;
  superpowerTitle: string;
  superpowerLead: string;
  traits: string[];
  him: string;
  currentAge: number;
  journeyEndAge: number;
  reducedMotion: boolean;
}

/** Superpower card + "First 10" card (stacked on phones). */
export default function SuperpowerSection({
  t,
  superpowerTitle,
  superpowerLead,
  traits,
  him,
  currentAge,
  journeyEndAge,
  reducedMotion,
}: SuperpowerSectionProps) {
  return (
    <Animated.View
      style={[
        { marginTop: IS_MOBILE ? 48 : 76, gap: 18 },
        fadeUp(0.1, reducedMotion),
      ]}
    >
      <View
        style={{
          position: 'relative',
          borderRadius: 20,
          paddingVertical: 24,
          paddingHorizontal: 26,
          experimental_backgroundImage: CARD_BG,
          borderWidth: 1,
          borderColor: CARD_BORDER,
          overflow: 'hidden',
          boxShadow: CARD_SHADOW,
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: -60,
            top: -60,
            width: 220,
            height: 220,
            borderRadius: 110,
            experimental_backgroundImage: CARD_ORB,
          }}
        />
        <Text style={EYEBROW}>{t(COPY.superpowerLabel)}</Text>
        <Text
          accessibilityRole="header"
          style={[
            orbitron(TITLE_SIZE),
            {
              marginTop: 10,
              lineHeight: TITLE_SIZE * 1.05,
              color: GOLD_CREAM2,
            },
          ]}
        >
          {superpowerTitle}
        </Text>
        <Text
          style={[
            rajdhani(14.5, 600, 1.5),
            { marginTop: 10, color: LP_PALETTE.superCardBody },
          ]}
        >
          {superpowerLead} {t(COPY.superpowerTail)}
        </Text>
        {traits.length > 0 && (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 10,
              marginTop: 18,
            }}
          >
            {traits.map(trait => (
              <View
                key={trait}
                style={{
                  paddingVertical: 7,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: TRAIT_BORDER,
                }}
              >
                <Text
                  style={[
                    rajdhani(12, 700),
                    {
                      letterSpacing: em(12, 0.12),
                      textTransform: 'uppercase',
                      color: GOLD_PALE,
                    },
                  ]}
                >
                  {trait}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View
        style={{
          borderRadius: 22,
          paddingVertical: 26,
          paddingHorizontal: 28,
          experimental_backgroundImage: FIRST_TEN_BG,
          borderWidth: 1,
          borderColor: FIRST_TEN_BORDER,
          justifyContent: 'center',
        }}
      >
        <Text style={[orbitron(32), { lineHeight: 32, color: CYAN }]}>
          {COPY.firstTenTitle}
        </Text>
        <Text
          style={[rajdhani(14, 600, 1.45), { marginTop: 8, color: SLATE_COOL }]}
        >
          years of a lifelong journey. Superpower stays with {him} for life; age{' '}
          {currentAge} to {journeyEndAge} is simply where we begin.
        </Text>
      </View>
    </Animated.View>
  );
}
