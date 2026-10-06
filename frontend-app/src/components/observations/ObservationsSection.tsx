import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { ObservationItem } from '@/lib/observationsData';
import { font, rgb } from '@/theme';
import ObservationCard from './ObservationCard';
import PillButton from './PillButton';
import {
  CARD_SHELL,
  SECTION_LABEL,
  bodyText,
  fadeUp,
  metaLabel,
  shimmer,
} from './styles';

/** Placeholder card shown while the set generates — same footprint as the real ones. */
function ObservationSkeleton() {
  return (
    <View style={[CARD_SHELL, { gap: 14 }]}>
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <Animated.View
          className="rounded-full"
          style={[
            {
              width: 38,
              height: 38,
              flexShrink: 0,
              backgroundColor: rgb('constellation-cyan', 0.07),
            },
            shimmer(),
          ]}
        />
        <View className="flex-1" style={{ gap: 7 }}>
          <Animated.View
            style={[
              {
                height: 13,
                width: '62%',
                borderRadius: 5,
                backgroundColor: rgb('constellation-cyan', 0.09),
              },
              shimmer(),
            ]}
          />
          <Animated.View
            style={[
              {
                height: 9,
                width: '36%',
                borderRadius: 5,
                backgroundColor: rgb('constellation-cyan', 0.06),
              },
              shimmer(0.2),
            ]}
          />
        </View>
      </View>
      {[88, 70].map((w, i) => (
        <Animated.View
          key={w}
          style={[
            {
              height: 10,
              width: `${w}%`,
              borderRadius: 5,
              backgroundColor: rgb('constellation-cyan', 0.06),
            },
            shimmer(0.1 * (i + 1)),
          ]}
        />
      ))}
    </View>
  );
}

/** Centered message card used for the failed and empty states. */
function MessageCard({
  title,
  body,
  action,
  onAction,
  paddingVertical,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
  paddingVertical: number;
}) {
  return (
    <View
      style={[
        CARD_SHELL,
        {
          marginTop: 16,
          paddingVertical,
          paddingHorizontal: 24,
          alignItems: 'center',
        },
      ]}
    >
      <Text
        style={{
          ...font('rajdhani', 700),
          fontSize: 16,
          textAlign: 'center',
          color: rgb('constellation-cyan-pale'),
        }}
      >
        {title}
      </Text>
      <Text
        style={[
          bodyText(14, 1.5, 'constellation-slate-light'),
          { marginTop: 8, maxWidth: 460, textAlign: 'center' },
        ]}
      >
        {body}
      </Text>
      <PillButton label={action} onPress={onAction} marginTop={18} />
    </View>
  );
}

export interface ObservationsSectionProps {
  isGenerating: boolean;
  generationFailed: boolean;
  /** Header-right copy: the job progress line while generating, else the watch count. */
  statusLabel: string;
  errorMessage: string;
  observations: ObservationItem[];
  tracked: string[];
  childName: string;
  onToggle: (id: string) => void;
  onRetry: () => void;
  onGoToGrow: () => void;
}

/** The "Observations" section: skeletons → failure / empty state → the card list. */
export default function ObservationsSection({
  isGenerating,
  generationFailed,
  statusLabel,
  errorMessage,
  observations,
  tracked,
  childName,
  onToggle,
  onRetry,
  onGoToGrow,
}: ObservationsSectionProps) {
  return (
    <Animated.View {...fadeUp(0.14)} style={{ marginTop: 40 }}>
      <View
        className="flex-row flex-wrap items-baseline justify-between"
        style={{ gap: 14 }}
      >
        <Text accessibilityRole="header" style={SECTION_LABEL}>
          Observations
        </Text>
        <Text style={metaLabel(11)}>{statusLabel}</Text>
      </View>

      {isGenerating ? (
        <View style={{ gap: 14, marginTop: 16 }}>
          {[0, 1, 2].map(i => (
            <ObservationSkeleton key={i} />
          ))}
        </View>
      ) : generationFailed ? (
        <MessageCard
          title="We could not group your answers just now"
          body={errorMessage}
          action="Try again"
          onAction={onRetry}
          paddingVertical={30}
        />
      ) : observations.length === 0 ? (
        <MessageCard
          title="Nothing to group yet"
          body="This page reads back what you have already told us. Answer a Grow area or finish the onboarding questions, and the patterns in your answers will appear here."
          action="Go to Grow"
          onAction={onGoToGrow}
          paddingVertical={34}
        />
      ) : (
        <View style={{ gap: 14, marginTop: 16 }}>
          {observations.map(obs => (
            <ObservationCard
              key={obs.id}
              obs={obs}
              on={tracked.includes(obs.id)}
              childName={childName}
              onToggle={() => onToggle(obs.id)}
            />
          ))}
        </View>
      )}
    </Animated.View>
  );
}
