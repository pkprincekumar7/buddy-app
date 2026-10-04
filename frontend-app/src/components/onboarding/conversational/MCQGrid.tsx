import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { Check, HelpCircle } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { color, hsl, rgb } from '@/theme';
import { OPTION_ICONS } from './flow';

const easeOut = Easing.out(Easing.ease);

// web: initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}, delay idx*0.06, 0.3s easeOut.
function optionEntering(idx: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 8 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: easeOut },
  })
    .duration(300)
    .delay(idx * 60);
}

// web: <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}> (default spring).
const CHECK_ENTERING = new Keyframe({
  0: { transform: [{ scale: 0 }] },
  100: { transform: [{ scale: 1 }], easing: easeOut },
}).duration(300);

// ring-1 ring-info/30
const SELECTED_RING = `0 0 0 1px ${hsl('info', 0.3)}`;

/** Web `MCQGrid` — one column of option buttons at phone width. */
export default function MCQGrid({
  options,
  selected,
  onSelect,
  stepKey,
}: {
  options: string[];
  selected?: string;
  onSelect: (o: string) => void;
  stepKey: number;
}) {
  return (
    <View className="gap-2.5">
      {options.map((option, idx) => {
        const Icon = OPTION_ICONS[option] ?? HelpCircle;
        const isSelected = selected === option;
        return (
          <Animated.View
            key={`${stepKey}-${option}`}
            entering={optionEntering(idx)}
          >
            <Pressable
              onPress={() => onSelect(option)}
              accessibilityRole="button"
              accessibilityLabel={option}
              accessibilityState={{ selected: isSelected }}
              className={cn(
                'flex-row items-center gap-3 rounded-xl border px-4 py-3',
                isSelected
                  ? 'border-info-medium/60 bg-info-strong/20'
                  : 'border-edge-faint bg-ghost-md',
              )}
              style={({ pressed }) => [
                isSelected && { boxShadow: SELECTED_RING },
                pressed && { transform: [{ scale: 0.96 }] },
              ]}
            >
              <Icon
                size={16}
                color={isSelected ? color.info : hsl('muted-foreground', 0.5)}
              />
              <Text
                className={cn(
                  'shrink text-left text-sm font-medium',
                  isSelected ? 'text-foreground' : 'text-muted-foreground',
                )}
                style={{ lineHeight: 14 * 1.25 }}
              >
                {option}
              </Text>
              {isSelected && (
                <Animated.View
                  entering={CHECK_ENTERING}
                  className="ml-auto h-4 w-4 shrink-0 items-center justify-center rounded-full bg-info-medium"
                >
                  <Check size={10} color={rgb('white')} />
                </Animated.View>
              )}
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}
