import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import type { KidActivity, KidEvent } from '@/api/kids';
import { getInitials } from '@/lib/avatarUtils';
import type { Win } from '@/lib/kidsWins';
import { STAR_PATH } from '@/components/kids/icons';
import {
  KIDS_COLORS,
  button,
  buttonOff,
  card,
  color,
  connect as cw,
  text,
} from '@/components/kids/palette';
import { SPIN, enter, loop } from '@/components/kids/enter';

const winColor = (i: number) =>
  KIDS_COLORS[i % KIDS_COLORS.length] ?? 'connect';

interface ConnectWinsProps {
  wins: Win[];
  childName: string;
  /** The child's age, shown on the card beside the first name (as the prototype's). */
  childAge?: number | null;
  avatarUrl?: string | null;
  activity: KidActivity;
  sending: boolean;
  send: (event: KidEvent) => Promise<KidActivity | null>;
}

/**
 * Connect in child view (web components/kids/ConnectWins): the child's wins and a card for
 * the one picked. Per P.2 nothing is shared from here: "Show my grown-up" keeps the win for
 * the parent's Connect page.
 */
export default function ConnectWins({
  wins,
  childName,
  childAge,
  avatarUrl,
  activity,
  sending,
  send,
}: ConnectWinsProps) {
  const [picked, setPicked] = useState(0);
  const win = wins[Math.min(picked, wins.length - 1)];
  const firstName = childName.trim().split(/\s+/)[0] ?? childName;
  // "Rahul, age 10" on the card; just the first name when no age is saved.
  const cardName =
    typeof childAge === 'number' ? `${firstName}, age ${childAge}` : firstName;
  const shown = win ? Boolean(activity.shown?.[win.key]) : false;
  const reduced = useReducedMotion();

  return (
    <View>
      <Text
        className="text-center text-xs uppercase"
        style={[
          text.label,
          { color: color('connect'), letterSpacing: 12 * 0.3 },
        ]}
      >
        Connect
      </Text>
      <Text
        accessibilityRole="header"
        className="mt-2.5 text-center text-3xl"
        style={[text.heading, { lineHeight: 30 * 1.25 }]}
      >
        Your wins
      </Text>
      <Text
        className="mt-3 text-center text-[17px]"
        style={[text.body, { lineHeight: 17 * 1.375 }]}
      >
        Pick a win. Show it to your grown-up.
      </Text>

      {!win ? (
        <View className="mt-6" style={card('connect')}>
          <Text className="text-center text-base" style={text.heading}>
            No wins yet
          </Text>
          <Text className="mt-2 text-center text-[15px]" style={text.body}>
            Open your powers, finish a quest or play a world. Your wins show up
            here.
          </Text>
        </View>
      ) : (
        <>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Your wins"
            className="mt-6 gap-3"
          >
            {wins.map((w, i) => {
              const on = i === picked;
              const c = winColor(i);
              return (
                <Pressable
                  key={w.key}
                  onPress={() => setPicked(i)}
                  accessibilityRole="radio"
                  accessibilityLabel={w.title}
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => cw.win(on, pressed)}
                >
                  <View
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 7,
                      backgroundColor: color(c),
                    }}
                  />
                  <Text className="flex-1" style={cw.winText}>
                    {w.title}
                  </Text>
                  {activity.shown?.[w.key] ? (
                    <Check size={18} color={color('teal')} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {/* The card re-pops on each pick (web kids-pop .35 s). */}
          <Animated.View
            key={win.key}
            accessibilityLiveRegion="polite"
            className="mt-5"
            style={[cw.card, enter('pop', 0, reduced, 0.35)]}
          >
            <View className="flex-row items-center justify-between">
              <Text style={cw.label}>SUPERPOWER</Text>
              <Animated.View style={loop(SPIN, 8, 0, 'linear', reduced)}>
                <Svg width={34} height={34} viewBox="0 0 24 24">
                  <Path
                    d={STAR_PATH}
                    fill={color('streak')}
                    stroke={color('ink')}
                    strokeWidth={1.2}
                  />
                </Svg>
              </Animated.View>
            </View>
            <Text style={cw.title}>{win.title}</Text>
            <View className="flex-row items-center gap-3.5">
              <View style={cw.avatar}>
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    accessibilityIgnoresInvertColors
                    className="h-full w-full"
                  />
                ) : (
                  <Text style={cw.initial}>
                    {getInitials(childName).charAt(0)}
                  </Text>
                )}
              </View>
              <Text style={cw.name}>{cardName}</Text>
            </View>
          </Animated.View>
          <Pressable
            onPress={() =>
              void send({ type: 'show_win', key: win.key, title: win.title })
            }
            disabled={sending || shown}
            accessibilityRole="button"
            accessibilityLabel={
              shown ? 'Your grown-up can see it' : 'Show my grown-up'
            }
            accessibilityState={{ disabled: sending || shown }}
            className="mt-5 h-11 items-center justify-center px-6"
            style={({ pressed }) =>
              shown
                ? buttonOff(false)
                : [button('connect', pressed), sending && { opacity: 0.5 }]
            }
          >
            <Text
              className="text-sm"
              style={
                shown ? text.label : [text.heading, { color: color('ink') }]
              }
            >
              {shown ? 'Your grown-up can see it' : 'Show my grown-up'}
            </Text>
          </Pressable>
          <Text className="mt-2.5 text-center text-[15px]" style={text.muted}>
            {typeof childAge === 'number'
              ? 'Only your first name and age go on the card.'
              : 'Only your first name goes on the card.'}
          </Text>
        </>
      )}
    </View>
  );
}
