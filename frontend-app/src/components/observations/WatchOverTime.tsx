import React from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { fillTemplate } from '@/lib/growthAreaData';
import { css, font, rgb } from '@/theme';
import { STEP_CARD_BG } from './palette';
import { SPANS, type ObservationSpan } from './protocol';
import {
  SECTION_LABEL,
  SELECTED_SPAN_GRADIENT,
  bodyText,
  em,
  fadeUp,
  metaLabel,
  swapIn,
} from './styles';

const PANEL_GRADIENT = css(
  'linear-gradient(165deg,rgb(var(--constellation-panel-b-rgb) / .9),rgb(var(--constellation-navy-panel2-rgb) / .9))',
);

const SPAN_TRANSITION: ViewStyle = {
  transitionProperty: ['borderColor', 'backgroundColor'],
  transitionDuration: '0.2s',
  transitionTimingFunction: 'ease',
} as ViewStyle;

const PANEL_ENTERING = swapIn(350);

/** "A way to watch it over time": the span picker and the selected span's week-by-week plan. */
export default function WatchOverTime({
  span,
  onSelectSpan,
  activeSpan,
  childName,
  childGender,
}: {
  span: number;
  onSelectSpan: (index: number) => void;
  activeSpan: ObservationSpan;
  childName: string;
  childGender: string;
}) {
  return (
    <Animated.View {...fadeUp(0.2)} style={{ marginTop: 52 }}>
      <View className="items-center">
        <Text
          accessibilityRole="header"
          style={[SECTION_LABEL, { textAlign: 'center' }]}
        >
          A way to watch it over time
        </Text>
        <Text
          style={[
            bodyText(15.5, 1.5, 'constellation-slate-light'),
            { marginTop: 12, maxWidth: 520, textAlign: 'center' },
          ]}
        >
          Choose how long to watch. Superpower asks the same few questions on a
          rhythm.
        </Text>
      </View>

      <View
        className="flex-row flex-wrap justify-center"
        style={{ gap: 10, marginTop: 22 }}
      >
        {SPANS.map((s, index) => {
          const selected = span === index;
          return (
            <Pressable
              key={s.label}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${s.label}, ${s.tag}`}
              onPress={() => onSelectSpan(index)}
            >
              <Animated.View
                style={[
                  SPAN_TRANSITION,
                  {
                    minWidth: 150,
                    alignItems: 'center',
                    borderRadius: 15,
                    paddingVertical: 14,
                    paddingHorizontal: 22,
                    borderWidth: 1,
                    borderColor: selected
                      ? rgb('constellation-gold', 0.55)
                      : rgb('constellation-cyan', 0.14),
                  },
                  selected
                    ? {
                        backgroundColor: 'transparent',
                        experimental_backgroundImage: SELECTED_SPAN_GRADIENT,
                      }
                    : { backgroundColor: rgb('constellation-card', 0.6) },
                ]}
              >
                <Text
                  style={{
                    ...font('orbitron', 700),
                    fontSize: 17,
                    textAlign: 'center',
                    color: selected
                      ? rgb('constellation-cyan-palest')
                      : rgb('constellation-slate-pale'),
                  }}
                >
                  {s.label}
                </Text>
                <Text
                  style={{
                    ...font('rajdhani', 600),
                    marginTop: 3,
                    fontSize: 12.5,
                    textAlign: 'center',
                    color: rgb('constellation-slate-mid'),
                  }}
                >
                  {s.tag}
                </Text>
              </Animated.View>
            </Pressable>
          );
        })}
      </View>

      <View style={{ marginTop: 22 }}>
        <Animated.View
          key={activeSpan.label}
          entering={PANEL_ENTERING}
          style={{
            borderRadius: 22,
            paddingVertical: 26,
            paddingHorizontal: 28,
            experimental_backgroundImage: PANEL_GRADIENT,
            borderWidth: 1,
            borderColor: rgb('constellation-cyan', 0.18),
          }}
        >
          <View
            className="flex-row flex-wrap items-baseline justify-between"
            style={{ gap: 16 }}
          >
            <Text
              accessibilityRole="header"
              style={{
                ...font('orbitron', 900),
                fontSize: 20,
                color: rgb('constellation-cyan-palest'),
              }}
            >
              {activeSpan.title}
            </Text>
            <View>
              <Text style={[metaLabel(10.5), { textAlign: 'right' }]}>
                Check-in rhythm
              </Text>
              <Text
                style={{
                  ...font('rajdhani', 700),
                  marginTop: 3,
                  fontSize: 15,
                  textAlign: 'right',
                  color: rgb('constellation-gold'),
                }}
              >
                {activeSpan.cadence}
              </Text>
            </View>
          </View>

          <View style={{ gap: 14, marginTop: 24 }}>
            {activeSpan.steps.map(step => (
              <View
                key={step.when}
                style={{
                  borderRadius: 15,
                  paddingVertical: 17,
                  paddingHorizontal: 18,
                  backgroundColor: STEP_CARD_BG,
                  borderWidth: 1,
                  borderColor: rgb('constellation-cyan', 0.14),
                }}
              >
                <View className="flex-row items-center" style={{ gap: 9 }}>
                  <View
                    className="rounded-full"
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: step.dot,
                      boxShadow: `0 0 10px ${step.dot}`,
                    }}
                  />
                  <Text
                    style={{
                      ...font('rajdhani', 700),
                      fontSize: 10.5,
                      letterSpacing: em(10.5, 0.18),
                      textTransform: 'uppercase',
                      color: rgb('constellation-slate-mid'),
                    }}
                  >
                    {step.when}
                  </Text>
                </View>
                <Text
                  style={{
                    ...font('rajdhani', 700),
                    marginTop: 10,
                    fontSize: 15,
                    color: rgb('constellation-cyan-pale'),
                  }}
                >
                  {fillTemplate(step.title, childName, childGender)}
                </Text>
                <Text
                  style={[
                    bodyText(13.5, 1.45, 'constellation-slate-light'),
                    { marginTop: 6 },
                  ]}
                >
                  {fillTemplate(step.body, childName, childGender)}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
