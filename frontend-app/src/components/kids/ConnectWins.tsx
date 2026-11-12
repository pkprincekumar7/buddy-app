import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Check } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import type { KidActivity, KidEvent } from '@/api/kids';
import { getInitials } from '@/lib/avatarUtils';
import type { Win } from '@/lib/kidsWins';
import { STAR_PATH } from '@/components/kids/icons';
import {
  POWER_COLORS,
  avatar,
  button,
  buttonOff,
  card,
  color,
  text,
  tile,
} from '@/components/kids/palette';

const winColor = (i: number) =>
  POWER_COLORS[i % POWER_COLORS.length] ?? 'connect';

interface ConnectWinsProps {
  wins: Win[];
  childName: string;
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
  avatarUrl,
  activity,
  sending,
  send,
}: ConnectWinsProps) {
  const [picked, setPicked] = useState(0);
  const win = wins[Math.min(picked, wins.length - 1)];
  const firstName = childName.trim().split(/\s+/)[0] ?? childName;
  const shown = win ? Boolean(activity.shown?.[win.key]) : false;

  return (
    <View>
      <Text
        className="text-center text-base uppercase"
        style={[
          text.label,
          { color: color('connect'), letterSpacing: 16 * 0.3 },
        ]}
      >
        Connect
      </Text>
      <Text
        accessibilityRole="header"
        className="mt-3 text-center text-4xl"
        style={[text.heading, { lineHeight: 36 * 1.25 }]}
      >
        Your wins
      </Text>
      <Text
        className="mt-4 text-center text-2xl"
        style={[text.body, { lineHeight: 24 * 1.375 }]}
      >
        Pick a win. Show it to your grown-up.
      </Text>

      {!win ? (
        <View className="mt-8" style={card('connect')}>
          <Text className="text-center text-2xl" style={text.heading}>
            No wins yet
          </Text>
          <Text className="mt-2 text-center text-xl" style={text.body}>
            Open your powers, finish a quest or play a world. Your wins show up
            here.
          </Text>
        </View>
      ) : (
        <>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Your wins"
            className="mt-8 gap-3"
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
                  className="flex-row items-center gap-3 px-5 py-4"
                  style={({ pressed }) => tile(c, on, pressed)}
                >
                  <View
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: color(c) }}
                  />
                  <Text className="flex-1 text-base" style={text.heading}>
                    {w.title}
                  </Text>
                  {activity.shown?.[w.key] ? (
                    <Check size={20} color={color('teal')} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <View
            accessibilityLiveRegion="polite"
            className="mt-6 items-center"
            style={card('connect')}
          >
            <View className="flex-row items-center gap-2">
              <Svg width={20} height={20} viewBox="0 0 24 24">
                <Path d={STAR_PATH} fill={color('streak')} />
              </Svg>
              <Text
                className="text-sm uppercase"
                style={[
                  text.label,
                  { color: color('muted'), letterSpacing: 14 * 0.3 },
                ]}
              >
                Superpower
              </Text>
            </View>
            <Text
              className="mt-5 text-center text-3xl"
              style={[text.heading, { lineHeight: 30 * 1.25 }]}
            >
              {win.title}
            </Text>
            <View className="mt-6 flex-row items-center gap-3">
              <View
                style={[
                  avatar('connect'),
                  { position: 'relative', width: 56, height: 56 },
                ]}
              >
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    accessibilityIgnoresInvertColors
                    className="h-full w-full"
                  />
                ) : (
                  <Text className="text-2xl" style={text.heading}>
                    {getInitials(childName).charAt(0)}
                  </Text>
                )}
              </View>
              <Text
                className="text-xl"
                style={[text.label, { color: color('body') }]}
              >
                {firstName}
              </Text>
            </View>
          </View>
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
            className="mt-5 h-16 items-center justify-center"
            style={({ pressed }) =>
              shown
                ? buttonOff(false)
                : [button('connect', pressed), sending && { opacity: 0.5 }]
            }
          >
            <Text
              className="text-lg"
              style={
                shown ? text.label : [text.heading, { color: color('ink') }]
              }
            >
              {shown ? 'Your grown-up can see it' : 'Show my grown-up'}
            </Text>
          </Pressable>
          <Text className="mt-3 text-center text-base" style={text.muted}>
            Only your first name goes on the card.
          </Text>
        </>
      )}
    </View>
  );
}
