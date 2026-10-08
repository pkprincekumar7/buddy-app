/**
 * The profile-phase cards below the trait diagram (web PersonalityProfile):
 * "How X's Mind Works", "Thinkers Like X", "Strengths", "In X's Own Words",
 * and the parent note.
 */
import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { generateAvatarDataUri } from '@/lib/avatarUtils';
import { env } from '@/lib/env';
import { css, rgb } from '@/theme';
import { PP } from './palette';
import { barGrow, enterFade, enterScale, enterUp } from './animations';
import { StrengthIcon } from './ProfileIcons';
import { CARD, SEC_LABEL, SERIF, SERIF_ITALIC } from './styles';

export interface TraitScore {
  label: string;
  score: number;
}
export interface FamousPerson {
  name: string;
  image?: string;
  caption?: string;
}

const BAR_FILL = `linear-gradient(90deg,${PP.barFill1},${PP.barFill2} 70%,${PP.barFill3})`;
const THINKER_SCRIM = css(
  'linear-gradient(0deg, rgb(var(--constellation-void-panel-rgb) / .92) 0%, rgb(var(--constellation-void-panel-rgb) / .25) 55%, rgb(var(--constellation-void-panel-rgb) / 0) 100%)',
);

// ── How mind works ──────────────────────────────────────────────────────────
export function MindWorksCard({
  childName,
  traitScores,
}: {
  childName: string;
  traitScores: TraitScore[];
}) {
  return (
    <Animated.View
      entering={enterUp(0.4)}
      style={[
        CARD,
        { paddingTop: 22, paddingHorizontal: 26, paddingBottom: 24 },
      ]}
    >
      <Text accessibilityRole="header" style={SEC_LABEL}>
        How {childName}'s Mind Works
      </Text>
      <View style={{ gap: 14 }}>
        {traitScores.map((ts, i) => (
          <View
            key={ts.label}
            accessible
            accessibilityLabel={`${ts.label} ${ts.score}%`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
          >
            <Text
              style={{
                width: 150,
                fontSize: 15,
                color: rgb('constellation-blue-soft'),
              }}
            >
              {ts.label}
            </Text>
            <View
              style={{
                flex: 1,
                height: 12,
                borderRadius: 8,
                backgroundColor: PP.barTrack,
                overflow: 'hidden',
              }}
            >
              <Animated.View
                style={[
                  {
                    height: '100%',
                    borderRadius: 8,
                    experimental_backgroundImage: BAR_FILL,
                  },
                  barGrow(ts.score, 0.5 + i * 0.1),
                ]}
              />
            </View>
            <Text
              style={{
                width: 58,
                fontSize: 15,
                textAlign: 'right',
                color: rgb('constellation-gold-light'),
              }}
            >
              {ts.score}%
            </Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

// ── Thinkers ────────────────────────────────────────────────────────────────
function decodeSvgDataUri(uri: string): string {
  const comma = uri.indexOf(',');
  return decodeURIComponent(comma >= 0 ? uri.slice(comma + 1) : uri);
}

function ThinkerImage({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    // Web swaps the <img> src to generateAvatarDataUri(); RN Image can't decode
    // an SVG data URI, so the same SVG renders via SvgXml.
    return (
      <View style={StyleSheet.absoluteFill}>
        <SvgXml
          xml={decodeSvgDataUri(generateAvatarDataUri(name))}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid slice"
        />
      </View>
    );
  }
  return (
    <Image
      source={{
        uri: `${env.CDN_BASE_URL}/app-assets/famous_people/${name.replace(
          / /g,
          '_',
        )}.png`,
      }}
      accessibilityLabel={name}
      resizeMode="cover"
      style={StyleSheet.absoluteFill}
      onError={() => setFailed(true)}
    />
  );
}

export function ThinkersCard({
  childName,
  famousPeople,
}: {
  childName: string;
  famousPeople: FamousPerson[];
}) {
  return (
    <Animated.View
      entering={enterUp(0.5)}
      style={[
        CARD,
        { paddingTop: 22, paddingHorizontal: 26, paddingBottom: 26 },
      ]}
    >
      <Text accessibilityRole="header" style={SEC_LABEL}>
        Thinkers Like {childName}
      </Text>
      <View style={{ flexDirection: 'row', gap: 18 }}>
        {famousPeople.slice(0, 2).map((person, i) => (
          <Animated.View
            key={person.name}
            entering={enterScale(0.6 + i * 0.1, 0.9)}
            style={{
              flex: 1,
              height: 150,
              borderWidth: 1,
              borderColor: rgb('constellation-blue-haze', 0.22),
              borderRadius: 12,
              overflow: 'hidden',
              backgroundColor: PP.thinkerBg,
            }}
          >
            <ThinkerImage name={person.name} />
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { experimental_backgroundImage: THINKER_SCRIM },
              ]}
            />
            <Text
              style={{
                position: 'absolute',
                left: 16,
                bottom: 14,
                right: 12,
                fontSize: 13,
                letterSpacing: 13 * 0.14,
                textTransform: 'uppercase',
                color: PP.thinkerCaption,
                lineHeight: 13 * 1.4,
              }}
            >
              {person.name}
              {person.caption ? ` · ${person.caption}` : ''}
            </Text>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

// ── Strengths ───────────────────────────────────────────────────────────────
export function StrengthsCard({
  strengths,
  isWide,
}: {
  strengths: string[];
  isWide: boolean;
}) {
  return (
    <Animated.View
      entering={enterUp(0.6)}
      style={[
        CARD,
        { paddingTop: 20, paddingHorizontal: 26, paddingBottom: 22 },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[SEC_LABEL, { marginBottom: 16 }]}
      >
        Strengths
      </Text>
      <View style={isWide ? { flexDirection: 'row', gap: 8 } : { gap: 16 }}>
        {strengths.slice(0, 4).map((strength, i) => {
          const sep = strength.match(/[:—–-](.+)/);
          const title = sep
            ? strength.slice(0, strength.indexOf(sep[0])).trim()
            : strength;
          return (
            <Animated.View
              key={i}
              entering={enterUp(0.7 + i * 0.07, 8)}
              style={
                isWide
                  ? { flex: 1, alignItems: 'center', gap: 10 }
                  : { flexDirection: 'row', alignItems: 'center', gap: 14 }
              }
            >
              <View style={{ flexShrink: 0 }}>
                <StrengthIcon index={i} />
              </View>
              <Text
                style={{
                  flexShrink: 1,
                  fontSize: 14,
                  lineHeight: 14 * 1.3,
                  textAlign: isWide ? 'center' : 'left',
                  color: rgb('constellation-blue-soft'),
                }}
              >
                {title}
              </Text>
            </Animated.View>
          );
        })}
      </View>
    </Animated.View>
  );
}

// ── In own words ────────────────────────────────────────────────────────────
const QUOTE_MARK = {
  fontSize: 48,
  lineHeight: 48 * 0.6,
  color: rgb('constellation-gold-dark'),
  opacity: 0.9,
  flexShrink: 0,
} as const;

export function OwnWordsCard({
  childName,
  childQuote,
}: {
  childName: string;
  childQuote: string;
}) {
  return (
    <Animated.View
      entering={enterUp(0.7)}
      style={[
        CARD,
        { paddingTop: 18, paddingHorizontal: 30, paddingBottom: 22, gap: 6 },
      ]}
    >
      <Text accessibilityRole="header" style={SEC_LABEL}>
        In {childName}'s Own Words
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Text accessible={false} style={[SERIF, QUOTE_MARK]}>
          {'“'}
        </Text>
        <Text
          style={[
            SERIF,
            {
              flex: 1,
              ...SERIF_ITALIC,
              fontSize: 24,
              lineHeight: 24 * 1.4,
              textAlign: 'center',
              color: PP.quoteText,
            },
          ]}
        >
          {childQuote}
        </Text>
        <Text
          accessible={false}
          style={[SERIF, QUOTE_MARK, { alignSelf: 'flex-end' }]}
        >
          {'”'}
        </Text>
      </View>
    </Animated.View>
  );
}

// ── Parent note ─────────────────────────────────────────────────────────────
export function ParentNote({ parentNote }: { parentNote: string }) {
  return (
    <Animated.View
      entering={enterFade(0.8)}
      style={{ alignSelf: 'center', maxWidth: 600 }}
    >
      <Text
        style={{
          textAlign: 'center',
          fontSize: 15,
          lineHeight: 15 * 1.5,
          color: PP.parentNote,
        }}
      >
        {parentNote}
      </Text>
    </Animated.View>
  );
}
