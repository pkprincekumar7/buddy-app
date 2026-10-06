import React from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { Sparkles } from 'lucide-react-native';
import { hsl } from '@/theme';
import { SUMMARY_ICONS, type SummaryItem } from './flow';

const easeOut = Easing.out(Easing.ease);

// web: initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}, delay i*0.06, 0.35s easeOut.
function cardEntering(i: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 10 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: easeOut },
  })
    .duration(350)
    .delay(i * 60);
}

/** "Your answers · n of 7" — the previously-answered summary cards. */
export default function ResumeSummary({ items }: { items: SummaryItem[] }) {
  return (
    <View className="mx-4 mb-4 gap-3">
      <View className="flex-row items-center gap-2 px-1">
        <View className="h-5 w-5 items-center justify-center rounded-full bg-success-bright/15">
          <Text className="text-[10px] font-bold text-success-bright">✓</Text>
        </View>
        <Text
          className="text-xs font-semibold uppercase text-white/30"
          style={{ letterSpacing: 12 * 0.05 }}
        >
          Your answers · {items.length} of 7
        </Text>
      </View>
      <View className="gap-2">
        {items.map((item, i) => {
          const Icon = SUMMARY_ICONS[item.label] ?? Sparkles;
          const values = item.answer.includes(',')
            ? item.answer.split(',').map(v => v.trim())
            : null;
          return (
            <Animated.View
              key={item.label}
              entering={cardEntering(i)}
              className="rounded-2xl border border-edge-faint bg-ghost-md px-3.5 py-3"
            >
              <View className="mb-1.5 flex-row items-center gap-1.5">
                <Icon size={12} color={hsl('info', 0.6)} />
                <Text
                  className="text-[10px] font-semibold uppercase text-white/30"
                  style={{ letterSpacing: 10 * 0.05 }}
                >
                  {item.label}
                </Text>
              </View>
              {values ? (
                <View className="flex-row flex-wrap gap-1">
                  {values.map(v => (
                    <View
                      key={v}
                      className="rounded-full bg-info-strong/15 px-2 py-0.5"
                    >
                      <Text className="text-[11px] font-medium text-white/70">
                        {v}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text
                  className="text-sm font-medium text-white/80"
                  style={{ lineHeight: 14 * 1.375 }}
                >
                  {item.answer}
                </Text>
              )}
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}
