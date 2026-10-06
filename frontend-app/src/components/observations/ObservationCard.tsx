import React from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import {
  OBSERVATION_ICONS,
  formatObservationSources,
  type ObservationItem,
} from '@/lib/observationsData';
import { css, font, rgb } from '@/theme';
import { CheckIcon, ObservationGlyph } from './Icons';
import {
  CARD_SHELL,
  SELECTED_CARD_GRADIENT,
  bodyText,
  metaLabel,
} from './styles';

const BADGE_GRADIENT = css(
  'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
);

const CARD_TRANSITION: ViewStyle = {
  transitionProperty: ['borderColor', 'backgroundColor'],
  transitionDuration: '0.22s',
  transitionTimingFunction: 'ease',
} as ViewStyle;

const BOX_TRANSITION: ViewStyle = {
  transitionProperty: ['borderColor', 'backgroundColor'],
  transitionDuration: '0.2s',
  transitionTimingFunction: 'ease',
} as ViewStyle;

/** One generated observation: glyph, title, provenance, watch checkbox, summary and the parent's notes. */
export default function ObservationCard({
  obs,
  on,
  childName,
  onToggle,
}: {
  obs: ObservationItem;
  on: boolean;
  childName: string;
  onToggle: () => void;
}) {
  const provenance = formatObservationSources(obs.sources, childName);
  return (
    <Animated.View
      style={[
        CARD_SHELL,
        CARD_TRANSITION,
        {
          gap: 14,
          borderColor: on
            ? rgb('constellation-cyan', 0.45)
            : rgb('constellation-cyan', 0.12),
        },
        on
          ? {
              backgroundColor: 'transparent',
              experimental_backgroundImage: SELECTED_CARD_GRADIENT,
            }
          : { backgroundColor: rgb('constellation-card', 0.6) },
      ]}
    >
      <View
        className="flex-row items-start justify-between"
        style={{ gap: 14 }}
      >
        <View
          className="flex-row items-center"
          style={{ gap: 12, flexShrink: 1, minWidth: 0 }}
        >
          <View
            className="items-center justify-center rounded-full"
            style={{
              width: 38,
              height: 38,
              flexShrink: 0,
              experimental_backgroundImage: BADGE_GRADIENT,
              borderWidth: 1.5,
              borderColor: rgb('constellation-gold', 0.5),
            }}
          >
            <ObservationGlyph d={OBSERVATION_ICONS[obs.icon]} />
          </View>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text
              style={{
                ...font('rajdhani', 700),
                fontSize: 16,
                color: rgb('constellation-cyan-pale'),
              }}
            >
              {obs.title}
            </Text>
            <Text style={[metaLabel(10.5), { marginTop: 2 }]}>
              {provenance}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          accessibilityLabel={
            on ? `Stop watching ${obs.title}` : `Watch ${obs.title}`
          }
          onPress={onToggle}
          hitSlop={10}
          style={{ flexShrink: 0 }}
        >
          <Animated.View
            className="items-center justify-center"
            style={[
              BOX_TRANSITION,
              {
                width: 22,
                height: 22,
                borderRadius: 7,
                borderWidth: 1.5,
                borderColor: on
                  ? rgb('constellation-cyan')
                  : rgb('constellation-ring-faint', 0.4),
                backgroundColor: on ? rgb('constellation-cyan') : 'transparent',
              },
            ]}
          >
            <CheckIcon opacity={on ? 1 : 0} />
          </Animated.View>
        </Pressable>
      </View>

      <Text style={bodyText(14.5, 1.5, 'constellation-caption')}>
        {obs.summary}
      </Text>

      {/* The parent's own words, presented as the evidence for the pattern
          above — never model-authored prose. */}
      <View style={{ gap: 7 }}>
        {obs.notes.map(note => (
          <View key={note} className="flex-row items-start" style={{ gap: 10 }}>
            <View style={{ width: 14 }}>
              <View
                className="rounded-full"
                style={{
                  width: 5,
                  height: 5,
                  marginTop: 8,
                  marginLeft: 4,
                  backgroundColor: rgb('constellation-cyan'),
                }}
              />
            </View>
            <Text
              style={[
                bodyText(13.5, 1.45, 'constellation-slate-light'),
                { flex: 1 },
              ]}
            >
              {note}
            </Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}
