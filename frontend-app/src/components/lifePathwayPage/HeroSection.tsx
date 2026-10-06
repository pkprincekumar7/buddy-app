import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { COPY } from '@/lib/lifePathwayData';
import { css, font, textGlowRoom } from '@/theme';
import { EYEBROW, GLOW_TEXT, GOLD, em, fadeUp, rajdhani } from './styles';

const CYAN_FROST = css('rgb(var(--constellation-cyan-frost-rgb))');
const SLATE_PALE = css('rgb(var(--constellation-slate-pale-rgb))');
const FROST = css('rgb(var(--constellation-text-frost-rgb))');

/** web `clamp(26px,3.8vw,44px)` at phone width. */
const HEADLINE_SIZE = 26;

interface HeroSectionProps {
  childName: string;
  currentAge: number;
  journeyEndAge: number;
  archetype: string | null;
  t: (text: string) => string;
  reducedMotion: boolean;
}

/** Hero — eyebrow, intro, two-line headline and the ten-year framing line. */
export default function HeroSection({
  childName,
  currentAge,
  journeyEndAge,
  archetype,
  t,
  reducedMotion,
}: HeroSectionProps) {
  const eyebrow = [
    childName,
    `Age ${String(currentAge)}`,
    archetype ? `The ${archetype}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const headlineA = t(COPY.headlineA);
  const headlineB = t(COPY.headlineB);

  return (
    <Animated.View style={[{ alignItems: 'center' }, fadeUp(0, reducedMotion)]}>
      <Text
        style={[
          EYEBROW,
          { letterSpacing: em(10.5, 0.36), textAlign: 'center' },
        ]}
      >
        {eyebrow}
      </Text>
      <Text
        style={[
          rajdhani(15, 700, 1.5),
          { marginTop: 18, textAlign: 'center', color: CYAN_FROST },
        ]}
      >
        {COPY.intro}
      </Text>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${headlineA} ${headlineB}`}
        style={{ marginTop: 16, alignItems: 'center' }}
      >
        <Text
          style={{
            ...font('orbitron', 900),
            fontSize: HEADLINE_SIZE,
            lineHeight: HEADLINE_SIZE * 1.06,
            letterSpacing: em(HEADLINE_SIZE, -0.01),
            textAlign: 'center',
            color: FROST,
          }}
        >
          {headlineA}
        </Text>
        <Animated.Text
          style={[
            {
              ...font('orbitron', 900),
              fontSize: HEADLINE_SIZE,
              lineHeight: HEADLINE_SIZE * 1.06,
              letterSpacing: em(HEADLINE_SIZE, -0.01),
              textAlign: 'center',
              color: GOLD,
              textShadowOffset: { width: 0, height: 0 },
              // GLOW_TEXT pulses the radius up to 22.
              ...textGlowRoom(22),
            },
            GLOW_TEXT,
          ]}
        >
          {headlineB}
        </Animated.Text>
      </View>
      <Text
        style={[
          rajdhani(16, 600, 1.55),
          { marginTop: 20, textAlign: 'center', color: SLATE_PALE },
        ]}
      >
        A lifelong journey. We begin with the first ten years, age {currentAge}{' '}
        to {journeyEndAge}.
      </Text>
    </Animated.View>
  );
}
