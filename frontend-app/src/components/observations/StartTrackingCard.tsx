import React from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import type { ObservationItem } from '@/lib/observationsData';
import { css, font, rgb } from '@/theme';
import { CTA_BUTTON_TEXT, CTA_PANEL_GRADIENT } from './palette';
import { bodyText, em, fadeUp } from './styles';

const CTA_GRADIENT = css(
  'linear-gradient(135deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-gold-rgb)))',
);
const CTA_GLOW = css('0 0 30px rgb(var(--constellation-cyan-rgb) / .3)');

const CTA_TRANSITION: ViewStyle = {
  transitionProperty: 'opacity',
  transitionDuration: '0.2s',
  transitionTimingFunction: 'ease',
} as ViewStyle;

/**
 * The "Start tracking" panel. On a phone the web's `.obs-cta` grid collapses
 * to one column (max-width: 700px) with the button stretched to full width.
 */
export default function StartTrackingCard({
  title,
  line,
  chosen,
  disabled,
  isSaving,
  onStart,
}: {
  title: string;
  line: string;
  chosen: ObservationItem[];
  disabled: boolean;
  isSaving: boolean;
  onStart: () => void;
}) {
  const label = isSaving ? 'Saving…' : 'Start tracking';
  return (
    <Animated.View {...fadeUp(0.26)} style={{ marginTop: 44 }}>
      <View
        style={{
          borderRadius: 22,
          paddingVertical: 26,
          paddingHorizontal: 28,
          experimental_backgroundImage: CTA_PANEL_GRADIENT,
          borderWidth: 1,
          borderColor: rgb('constellation-gold', 0.28),
          gap: 22,
        }}
      >
        <View>
          <Text
            accessibilityRole="header"
            style={{
              ...font('orbitron', 700),
              fontSize: 18,
              color: rgb('constellation-cyan-palest'),
            }}
          >
            {title}
          </Text>
          <Text
            style={[
              bodyText(15, 1.5, 'constellation-slate-pale'),
              { marginTop: 8, maxWidth: 620 },
            ]}
          >
            {line}
          </Text>
          {chosen.length > 0 && (
            <View
              className="flex-row flex-wrap"
              style={{ gap: 8, marginTop: 14 }}
            >
              {chosen.map(obs => (
                <View
                  key={obs.id}
                  style={{
                    paddingVertical: 7,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    backgroundColor: rgb('constellation-cyan', 0.08),
                    borderWidth: 1,
                    borderColor: rgb('constellation-cyan', 0.28),
                  }}
                >
                  <Text
                    style={{
                      ...font('rajdhani', 700),
                      fontSize: 12,
                      color: rgb('constellation-cyan-soft'),
                    }}
                  >
                    {obs.title}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled, busy: isSaving }}
          disabled={disabled}
          onPress={onStart}
        >
          <Animated.View
            className="w-full items-center justify-center"
            style={[
              CTA_TRANSITION,
              {
                paddingVertical: 15,
                paddingHorizontal: 34,
                borderRadius: 999,
                experimental_backgroundImage: CTA_GRADIENT,
                boxShadow: CTA_GLOW,
                opacity: disabled ? 0.4 : 1,
              },
            ]}
          >
            {/* A pill that breaks across two lines stops reading as a button. */}
            <Text
              numberOfLines={1}
              style={{
                ...font('rajdhani', 700),
                fontSize: 13,
                letterSpacing: em(13, 0.14),
                textTransform: 'uppercase',
                color: CTA_BUTTON_TEXT,
              }}
            >
              {label}
            </Text>
          </Animated.View>
        </Pressable>
      </View>
    </Animated.View>
  );
}
