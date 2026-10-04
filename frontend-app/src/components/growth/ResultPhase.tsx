import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { fillTemplate } from '@/lib/growthAreaData';
import type { GrowthArea, GrowthRecommendation } from '@/lib/growthAreaData';
import { SPINNER } from '@/lib/animations';
import { css, font, rgb } from '@/theme';
import { CTA, CTA_TEXT, Pill, fadeUp, scalePath } from './shared';

export type RecsPhase = 'idle' | 'loading' | 'ready' | 'error';

/** Constellation node positions (percent of the 560×132 result-panel area) and
 * the path connecting them, in the same order as the child's six picks. */
const CONSTELLATION_PATH = 'M40 84 L142 46 L244 66 L316 34 L418 60 L520 30';
const CONSTELLATION_STARS = [
  { left: 7.1, top: 64.6 },
  { left: 25.4, top: 35.4 },
  { left: 43.6, top: 50.8 },
  { left: 56.4, top: 26.2 },
  { left: 74.6, top: 46.2 },
  { left: 92.9, top: 23.1 },
];
const CONSTELLATION_H = 132;
/** Star column: 11px dot + 6px gap + 14px label line — centred on its point. */
const STAR_COL_W = 120;
const STAR_COL_H = 11 + 6 + 14;

const ARROW_RIGHT_PATH = 'M5 12h13M12 6l6 6-6 6';

const ENTER = fadeUp(12, 450);

const STAR_DOT = {
  backgroundColor: rgb('constellation-gold-pale'),
  boxShadow: css('0 0 14px rgb(var(--constellation-gold-rgb) / .9)'),
};
const REC_DOT = {
  backgroundColor: rgb('constellation-gold-pale'),
  boxShadow: css('0 0 10px rgb(var(--constellation-gold-rgb) / .9)'),
};
const REC_CARD = {
  experimental_backgroundImage: css(
    'linear-gradient(120deg,rgb(var(--constellation-navy-soft-rgb) / .55),rgb(var(--constellation-ink-navy-rgb) / .55))',
  ),
  borderWidth: 1,
  borderColor: rgb('constellation-gold', 0.18),
};
const NOTE = {
  fontSize: 13,
  fontWeight: '600' as const,
  textAlign: 'center' as const,
  color: rgb('constellation-slate-soft'),
  paddingVertical: 12,
};

interface ResultPhaseProps {
  area: GrowthArea;
  childName: string;
  childGender: string;
  archetype: { title: string; line: string } | null;
  pickedStars: string[];
  recsPhase: RecsPhase;
  recommendations: GrowthRecommendation[];
  onPlayAgain: () => void;
  onDone: () => void;
  onExploreTransform: () => void;
}

/** The result phase: constellation of the child's six picks + recommendations. */
export default function ResultPhase({
  area,
  childName,
  childGender,
  archetype,
  pickedStars,
  recsPhase,
  recommendations,
  onPlayAgain,
  onDone,
  onExploreTransform,
}: ResultPhaseProps) {
  const [boxW, setBoxW] = useState(0);

  return (
    <Animated.View
      entering={ENTER}
      style={{ marginTop: 4, alignItems: 'center' }}
    >
      <Text
        style={{
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: 9.5 * 0.3,
          fontSize: 9.5,
          textAlign: 'center',
          color: rgb('constellation-cyan-bright'),
          // Keep clear of the sheet's top-right close button on both sides so
          // the centred line wraps instead of running under it.
          paddingHorizontal: 34,
        }}
      >
        {fillTemplate(
          '{name}’s ' + area.name + ' Constellation',
          childName,
          childGender,
        )}
      </Text>
      <Text
        accessibilityRole="header"
        style={[
          font('orbitron', 700),
          {
            marginTop: 8,
            fontSize: 22,
            textAlign: 'center',
            color: rgb('constellation-cyan-paler'),
          },
        ]}
      >
        {archetype?.title ?? ''}
      </Text>
      <Text
        style={{
          marginTop: 8,
          maxWidth: 430,
          fontSize: 14.5,
          fontWeight: '600',
          textAlign: 'center',
          color: rgb('constellation-slate-soft'),
        }}
      >
        {archetype ? fillTemplate(archetype.line, childName, childGender) : ''}
      </Text>

      <View
        style={{
          position: 'relative',
          alignSelf: 'stretch',
          height: CONSTELLATION_H,
          marginTop: 6,
        }}
        onLayout={e => setBoxW(e.nativeEvent.layout.width)}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {boxW > 0 && (
          <Svg
            pointerEvents="none"
            width={boxW}
            height={CONSTELLATION_H}
            style={{ position: 'absolute', left: 0, top: 0 }}
          >
            <Path
              d={scalePath(
                CONSTELLATION_PATH,
                boxW / 560,
                CONSTELLATION_H / 130,
              )}
              fill="none"
              stroke={rgb('constellation-gold', 0.35)}
              strokeWidth={1}
            />
          </Svg>
        )}
        {CONSTELLATION_STARS.map((pos, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (pos.left / 100) * boxW - STAR_COL_W / 2,
              top: (pos.top / 100) * CONSTELLATION_H - STAR_COL_H / 2,
              width: STAR_COL_W,
              alignItems: 'center',
              gap: 6,
            }}
          >
            <View
              style={[{ width: 11, height: 11, borderRadius: 5.5 }, STAR_DOT]}
            />
            <Text
              numberOfLines={1}
              style={{
                fontSize: 11,
                lineHeight: 14,
                fontWeight: '700',
                letterSpacing: 11 * 0.06,
                color: rgb('constellation-cyan-frost'),
              }}
            >
              {pickedStars[i] ?? ''}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={{
          alignSelf: 'stretch',
          marginTop: 4,
          borderTopWidth: 1,
          borderTopColor: rgb('constellation-gold', 0.22),
          paddingTop: 18,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 14,
          }}
        >
          <Text
            accessibilityRole="header"
            style={[
              font('orbitron', 700),
              {
                fontSize: 13.5,
                letterSpacing: 13.5 * 0.14,
                textTransform: 'uppercase',
                color: rgb('constellation-gold'),
              },
            ]}
          >
            Recommendations
          </Text>
          <Text
            style={{
              fontSize: 10.5,
              fontWeight: '600',
              letterSpacing: 10.5 * 0.14,
              textTransform: 'uppercase',
              color: rgb('constellation-slate'),
            }}
          >
            {fillTemplate(
              'From your five answers and {name}’s six choices',
              childName,
              childGender,
            )}
          </Text>
        </View>

        <View style={{ gap: 9, marginTop: 14 }}>
          {recsPhase === 'loading' && (
            <View
              style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}
            >
              <View style={{ width: 40, height: 40 }}>
                <View
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 20,
                    borderWidth: 3,
                    borderColor: rgb('constellation-gold', 0.2),
                  }}
                />
                <Animated.View
                  accessibilityRole="progressbar"
                  accessibilityLabel="Loading"
                  style={[
                    {
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 20,
                      borderWidth: 3,
                      borderColor: 'transparent',
                      borderTopColor: rgb('constellation-gold'),
                    },
                    SPINNER,
                    // Tailwind animate-spin: 1s linear.
                    { animationDuration: '1s' },
                  ]}
                />
              </View>
              <Text
                style={{
                  fontSize: 12.5,
                  fontWeight: '600',
                  textAlign: 'center',
                  color: rgb('constellation-slate-soft'),
                }}
              >
                {fillTemplate(
                  'Building {his} 3-month plan…',
                  childName,
                  childGender,
                )}
              </Text>
            </View>
          )}

          {recsPhase === 'error' && (
            <Text style={NOTE}>
              Could not generate recommendations. Play again to retry.
            </Text>
          )}

          {recsPhase === 'ready' &&
            (recommendations.length > 0 ? (
              recommendations.map((rec, i) => (
                <View
                  key={i}
                  style={[
                    {
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 12,
                      borderRadius: 13,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                    },
                    REC_CARD,
                  ]}
                >
                  <View
                    style={{
                      width: 26,
                      alignItems: 'center',
                      gap: 6,
                      paddingTop: 2,
                    }}
                  >
                    <View
                      style={[
                        { width: 7, height: 7, borderRadius: 3.5 },
                        REC_DOT,
                      ]}
                    />
                    <Text
                      style={[
                        font('orbitron', 700),
                        { fontSize: 10, color: rgb('constellation-gold', 0.6) },
                      ]}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{
                        fontWeight: '700',
                        fontSize: 14.5,
                        lineHeight: 14.5 * 1.35,
                        color: rgb('constellation-cyan-pale'),
                      }}
                    >
                      {rec.title}
                    </Text>
                    {rec.detail ? (
                      <Text
                        style={{
                          marginTop: 3,
                          fontWeight: '600',
                          fontSize: 13,
                          lineHeight: 13 * 1.45,
                          color: rgb('constellation-slate-cool'),
                        }}
                      >
                        {rec.detail}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))
            ) : (
              <Text style={NOTE}>
                No recommendations generated for this area yet.
              </Text>
            ))}
        </View>
      </View>

      {(recsPhase === 'ready' || recsPhase === 'error') && (
        <View
          style={{
            alignSelf: 'stretch',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            marginTop: 18,
          }}
        >
          <Pill
            label="Play again"
            onPress={onPlayAgain}
            textColor={rgb('constellation-amber')}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 22,
              backgroundColor: rgb('constellation-overlay', 0.85),
              borderWidth: 1,
              borderColor: rgb('constellation-amber', 0.35),
            }}
          />
          <Pill
            label="Done"
            onPress={onDone}
            textColor={CTA_TEXT}
            style={[CTA, { paddingVertical: 11, paddingHorizontal: 26 }]}
          />
          {/* Zero-size flex item — forces Explore Transform onto its own wrapped row (web: below md). */}
          <View style={{ width: '100%', height: 0 }} />
          <Pill
            label="Explore Transform"
            onPress={onExploreTransform}
            textColor={rgb('constellation-gold-pale')}
            icon={{
              d: ARROW_RIGHT_PATH,
              side: 'right',
              size: 14,
              strokeWidth: 2.4,
            }}
            style={{
              paddingVertical: 11,
              paddingHorizontal: 22,
              backgroundColor: rgb('constellation-navy-deep', 0.9),
              borderWidth: 1,
              borderColor: rgb('constellation-gold', 0.5),
            }}
          />
        </View>
      )}
    </Animated.View>
  );
}
