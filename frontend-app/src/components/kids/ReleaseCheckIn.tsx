import React, { useState } from 'react';
import { Text, TextInput, View, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Pressable } from '@/components/ui/pressable';
import type { KidActivity, KidEvent, KidMoodKey } from '@/api/kids';
import { moodStreak } from '@/lib/kidsDay';
import { MOODS, streakLine } from '@/lib/kidsMoods';
import { FLAME_PATH } from '@/components/kids/icons';
import MoodFace from '@/components/kids/MoodFace';
import {
  button,
  card,
  color,
  input,
  text,
  tile,
} from '@/components/kids/palette';

const NOTE_MAX = 500;

/** The moods two to a row (web grid-cols-2 below `sm`); the last one alone on the left. */
const ROWS = Array.from({ length: Math.ceil(MOODS.length / 2) }, (_, r) =>
  MOODS.slice(2 * r, 2 * r + 2),
);

/** The web textarea's box: py-4, text-xl's line height, three rows tall (3 × 28 + 2 × 16 + 2 × 3). */
const NOTE_BOX: TextStyle = {
  paddingVertical: 16,
  lineHeight: 28,
  minHeight: 3 * 28 + 2 * 16 + 2 * 3,
};

interface ReleaseCheckInProps {
  activity: KidActivity;
  day: string;
  sending: boolean;
  send: (event: KidEvent) => Promise<KidActivity | null>;
}

/** Release's daily check-in (web components/kids/ReleaseCheckIn): moods, a note, the streak. */
export default function ReleaseCheckIn({
  activity,
  day,
  sending,
  send,
}: ReleaseCheckInProps) {
  const saved = activity.moods[day];
  const [mood, setMood] = useState<KidMoodKey | null>(
    MOODS.find(m => m.key === saved?.mood)?.key ?? null,
  );
  const [note, setNote] = useState(saved?.note ?? '');
  const [focused, setFocused] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const picked = MOODS.find(m => m.key === mood);
  const streak = moodStreak(activity.moods, day);

  const save = async () => {
    if (!mood) return;
    const trimmed = note.trim();
    const done = await send({
      type: 'mood',
      mood,
      ...(trimmed && { note: trimmed }),
    });
    if (done) setJustSaved(true);
  };

  return (
    <View>
      <Text
        className="text-center text-base uppercase"
        style={[
          text.label,
          { color: color('release'), letterSpacing: 16 * 0.3 },
        ]}
      >
        Daily check-in
      </Text>
      <Text
        accessibilityRole="header"
        className="mt-3 text-center text-4xl"
        style={[text.heading, { lineHeight: 36 * 1.25 }]}
      >
        How do you feel today?
      </Text>
      <Text
        className="mt-4 text-center text-2xl"
        style={[text.body, { lineHeight: 24 * 1.375 }]}
      >
        There is no wrong answer.
      </Text>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="How you feel"
        className="mt-8 gap-4"
      >
        {ROWS.map(row => (
          <View key={row.map(m => m.key).join()} className="flex-row gap-4">
            {row.map(m => {
              const on = m.key === mood;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => {
                    setMood(m.key);
                    setJustSaved(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={m.label}
                  accessibilityState={{ checked: on }}
                  className="min-h-[170px] flex-1 items-center justify-center gap-3"
                  style={({ pressed }) => tile(m.color, on, pressed)}
                >
                  <MoodFace mood={m.key} size={64} />
                  <Text className="text-lg" style={text.heading}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
            {row.length === 1 ? <View className="flex-1" /> : null}
          </View>
        ))}
      </View>

      {picked ? (
        <View className="mt-7" style={card('release')}>
          <Text className="text-2xl" style={text.heading}>
            Want to tell more?
          </Text>
          <Text className="mt-1 text-lg" style={text.muted}>
            You can skip this.
          </Text>
          <TextInput
            value={note}
            onChangeText={t => {
              setNote(t);
              setJustSaved(false);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            maxLength={NOTE_MAX}
            multiline
            placeholder="What happened today?"
            placeholderTextColor={color('muted')}
            accessibilityLabel="What happened today?"
            className="mt-4"
            style={[input('release', focused), NOTE_BOX]}
          />
          <View className="mt-5 flex-row flex-wrap items-center justify-between gap-4">
            <Text
              accessibilityLiveRegion="polite"
              className="text-xl"
              style={[
                text.label,
                { color: justSaved ? color('teal') : color('body') },
              ]}
            >
              {justSaved
                ? 'Saved. Thanks for telling us.'
                : `You feel ${picked.label.toLowerCase()} today.`}
            </Text>
            <Pressable
              onPress={() => void save()}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={sending ? 'Saving' : 'Save'}
              className="h-16 items-center justify-center px-10"
              style={({ pressed }) => [
                button('release', pressed),
                sending && { opacity: 0.5 },
              ]}
            >
              <Text
                className="text-lg"
                style={[text.heading, { color: color('ink') }]}
              >
                {sending ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View className="mt-7 flex-row items-center justify-center gap-3">
        <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
          <Path
            d={FLAME_PATH}
            stroke={color('transform')}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text
          className="text-xl"
          style={[text.heading, { color: color('streak') }]}
        >
          {streakLine(streak)}
        </Text>
      </View>
    </View>
  );
}
