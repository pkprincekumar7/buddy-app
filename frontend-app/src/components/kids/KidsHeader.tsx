import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Volume2 } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import type { KidsArea } from '@/lib/childView';
import { rgb } from '@/theme';
import { buttonOff, chip, color, text } from '@/components/kids/palette';

interface KidsHeaderProps {
  area: KidsArea;
  areaName: string;
  readAloud: boolean;
  onHome: () => void;
  onToggleReadAloud: () => void;
}

/** Web `bg-kids-bg/80` (the bar is sticky, so the page scrolls under it). */
const BAR = { backgroundColor: rgb('kids-bg', 0.8) } as const;
/** "Read to me" while on (web .kids-read-on): always cyan, dark ink, pushed down 4px with its
 * shade unchanged. */
const readOn = (pressed: boolean) => ({
  backgroundColor: color('discover'),
  borderRadius: 999,
  boxShadow: `0 5px 0 ${color('discover-shade')}`,
  transform: [{ translateY: pressed ? 4 : 0 }],
});

/**
 * The kids page's bar (web components/kids/KidsHeader), as the prototype's: Home (back to the
 * circles), the circle's chip, Read to me (lit while the page reads itself aloud). The page
 * keeps it stuck under the app's own header.
 */
export default function KidsHeader({
  area,
  areaName,
  readAloud,
  onHome,
  onToggleReadAloud,
}: KidsHeaderProps) {
  const ink = readAloud ? color('ink') : color('text');
  return (
    <View
      className="flex-row flex-wrap items-center justify-between gap-2.5 px-4 py-2.5"
      style={BAR}
    >
      <View className="flex-row items-center gap-2.5">
        <Pressable
          onPress={onHome}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          className="h-10 flex-row items-center justify-center gap-1.5 pl-4 pr-[22px]"
          style={({ pressed }) => buttonOff(pressed)}
        >
          {/* The prototype's house: a roof and walls, no door. */}
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path
              d="M3 11l9-7 9 7M5 10v10h14V10"
              stroke={color('text')}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text className="text-sm" style={text.label}>
            Home
          </Text>
        </Pressable>
        <View
          className="flex-row items-center gap-2 py-1.5"
          style={[chip(area), { paddingHorizontal: 18 }]}
        >
          <View
            className="h-2.5 w-2.5 rounded-full"
            style={{
              backgroundColor: color(area),
              boxShadow: `0 0 10px ${color(area)}`,
            }}
          />
          <Text
            className="text-sm uppercase"
            style={[text.heading, { letterSpacing: 14 * 0.08 }]}
          >
            {areaName}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={onToggleReadAloud}
        accessibilityRole="button"
        accessibilityLabel="Read to me"
        accessibilityState={{ selected: readAloud }}
        className="h-10 flex-row items-center justify-center gap-2.5 px-4"
        style={({ pressed }) =>
          readAloud ? readOn(pressed) : buttonOff(pressed)
        }
      >
        <Volume2 size={20} color={ink} />
        {/* Rajdhani bold, on or off (the prototype's). */}
        <Text className="text-sm" style={[text.label, { color: ink }]}>
          Read to me
        </Text>
      </Pressable>
    </View>
  );
}
