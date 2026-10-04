import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { COPY } from '@/lib/lifePathwayData';
import { css, font } from '@/theme';
import { CYAN, GOLD, IS_MOBILE, em, fadeUp, orbitron } from './styles';

const FROST = css('rgb(var(--constellation-text-frost-rgb))');
const INK = css('rgb(var(--constellation-navy-rgb))');
const CTA_BG = `linear-gradient(135deg,${CYAN},${GOLD})`;
const CTA_SHADOW = css('0 0 40px rgb(var(--constellation-cyan-rgb) / .4)');
/** web `.lp-cta:hover` — the pressed state on touch. */
const CTA_SHADOW_PRESSED = css(
  '0 0 60px rgb(var(--constellation-gold-rgb) / .55)',
);

/** web `clamp(19px,2.2vw,26px)` at phone width. */
const HEADLINE_SIZE = 19;

interface CtaSectionProps {
  childName: string;
  t: (text: string) => string;
  onStart: () => void;
  reducedMotion: boolean;
}

/** Closing headline + "Start {name}'s 90 days" CTA. */
export default function CtaSection({
  childName,
  t,
  onStart,
  reducedMotion,
}: CtaSectionProps) {
  const headlineA = t(COPY.ctaHeadlineA);
  const headlineB = t(COPY.ctaHeadlineB);
  const label = `Start ${childName ? `${childName}'s` : 'the'} 90 days`;
  const headline = {
    ...font('orbitron', 900),
    fontSize: HEADLINE_SIZE,
    lineHeight: HEADLINE_SIZE * 1.25,
    textAlign: 'center',
  } as const;

  return (
    <Animated.View
      style={[
        { marginTop: IS_MOBILE ? 56 : 80, alignItems: 'center' },
        fadeUp(0.45, reducedMotion),
      ]}
    >
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${headlineA} ${headlineB}`}
      >
        <Text style={[headline, { color: FROST }]}>
          {headlineA}
          {'\n'}
          <Text style={{ color: GOLD }}>{headlineB}</Text>
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onStart}
        style={({ pressed }) => ({
          marginTop: 26,
          paddingVertical: 15,
          paddingHorizontal: 38,
          borderRadius: 999,
          experimental_backgroundImage: CTA_BG,
          boxShadow: pressed ? CTA_SHADOW_PRESSED : CTA_SHADOW,
          transform: [{ translateY: pressed ? -2 : 0 }],
        })}
      >
        <Text
          style={[
            orbitron(13),
            {
              letterSpacing: em(13, 0.16),
              textTransform: 'uppercase',
              color: INK,
              textAlign: 'center',
            },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
