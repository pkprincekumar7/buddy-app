import React from 'react';
import { Text, View } from 'react-native';
import { House, Volume2 } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import type { KidsArea } from '@/lib/childView';
import { rgb } from '@/theme';
import {
  button,
  buttonOff,
  chip,
  color,
  text,
} from '@/components/kids/palette';

interface KidsHeaderProps {
  area: KidsArea;
  areaName: string;
  readAloud: boolean;
  onHome: () => void;
  onToggleReadAloud: () => void;
}

/** Web `bg-kids-bg/80` (the bar is sticky, so the page scrolls under it). */
const BAR = { backgroundColor: rgb('kids-bg', 0.8) } as const;
/** `.kids-btn` pressed: down 5px (the off look keeps `.kids-btn`'s press). */
const PRESSED = { transform: [{ translateY: 5 }] } as const;

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
          className="h-10 flex-row items-center justify-center gap-1.5 pl-3 pr-4"
          style={({ pressed }) => [buttonOff(pressed), pressed && PRESSED]}
        >
          <House size={18} color={color('text')} />
          <Text className="text-sm" style={text.label}>
            Home
          </Text>
        </Pressable>
        <View
          className="flex-row items-center gap-2 px-3 py-1.5"
          style={chip(area)}
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
            style={[text.heading, { letterSpacing: 14 * 0.05 }]}
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
        className="h-10 flex-row items-center justify-center gap-1.5 px-4"
        style={({ pressed }) =>
          readAloud
            ? button(area, pressed)
            : [buttonOff(pressed), pressed && PRESSED]
        }
      >
        <Volume2 size={18} color={ink} />
        {/* On it's `.kids-btn` (Orbitron black); off, `.kids-btn-off` (Rajdhani bold). */}
        <Text
          className="text-sm"
          style={[readAloud ? text.heading : text.label, { color: ink }]}
        >
          Read to me
        </Text>
      </Pressable>
    </View>
  );
}
