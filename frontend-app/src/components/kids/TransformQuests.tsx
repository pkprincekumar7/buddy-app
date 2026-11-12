import React, { useState, type ReactNode } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import { font } from '@/theme';
import type { KidActivity } from '@/api/kids';
import {
  currentInterest,
  myInterests,
  questKey,
  type KidQuests,
  type QuestInterestKey,
} from '@/api/kidQuests';
import {
  POWER_COLORS,
  button,
  buttonOff,
  chip,
  color,
  questCard,
  questDot,
  tile,
} from '@/components/kids/palette';

const questColor = (i: number) =>
  POWER_COLORS[i % POWER_COLORS.length] ?? 'transform';

/** Transform's circle colour: the web's --kids-area on this tab (.kids-btn, .kids-chip, text-kids-area). */
const AREA = 'transform';

/** The web's classes at phone width, in px (Tailwind text-* sizes and line heights). */
const s = {
  // text-base font-bold uppercase tracking-[0.3em] text-kids-area
  eyebrow: {
    ...font('rajdhani', 700),
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 16 * 0.3,
    textTransform: 'uppercase',
    textAlign: 'center',
    color: color(AREA),
  },
  // font-orbitron text-4xl font-black leading-tight
  title: {
    ...font('orbitron', 900),
    fontSize: 36,
    lineHeight: 45,
    textAlign: 'center',
    color: color('text'),
  },
  // max-w-xl text-2xl font-semibold leading-snug text-kids-body
  lead: {
    ...font('rajdhani', 600),
    fontSize: 24,
    lineHeight: 33,
    maxWidth: 576,
    alignSelf: 'center',
    textAlign: 'center',
    color: color('body'),
  },
  // .kids-tile text-xl
  tile: {
    ...font('orbitron', 900),
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
    color: color('text'),
  },
  // An interest chip: font-orbitron text-lg font-black, then text-xs font-bold
  // uppercase tracking-[0.15em] opacity-80.
  chipLabel: { ...font('orbitron', 900), fontSize: 18, lineHeight: 28 },
  chipFrom: {
    ...font('rajdhani', 700),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 12 * 0.15,
    textTransform: 'uppercase',
    opacity: 0.8,
  },
  // .kids-chip text-lg font-bold text-kids-text
  chipAdd: {
    ...font('rajdhani', 700),
    fontSize: 18,
    lineHeight: 28,
    color: color('text'),
  },
  // font-orbitron text-sm font-black uppercase tracking-[0.2em] text-kids-muted
  questNo: {
    ...font('orbitron', 900),
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 14 * 0.2,
    textTransform: 'uppercase',
    color: color('muted'),
  },
  questTitle: {
    ...font('orbitron', 900),
    fontSize: 24,
    lineHeight: 32,
    color: color('text'),
  },
  questHow: {
    ...font('rajdhani', 600),
    fontSize: 20,
    lineHeight: 28,
    color: color('body'),
  },
  questDone: {
    ...font('rajdhani', 700),
    fontSize: 20,
    lineHeight: 28,
    color: color('teal'),
  },
  // .kids-btn / .kids-btn-off text-lg
  btn: {
    ...font('orbitron', 900),
    fontSize: 18,
    lineHeight: 28,
    color: color('ink'),
  },
  btnOff: {
    ...font('rajdhani', 700),
    fontSize: 18,
    lineHeight: 28,
    color: color('text'),
  },
} satisfies Record<string, TextStyle>;

/** The web's `grid grid-cols-2 gap-4`: rows of two equal cells, 16px apart. */
function TwoColumns<T>({
  items,
  children,
}: {
  items: readonly T[];
  children: (item: T, i: number) => ReactNode;
}) {
  const rows: number[][] = [];
  items.forEach((_, i) => {
    if (i % 2 === 0) rows.push([i]);
    else rows[rows.length - 1]?.push(i);
  });
  return (
    <View className="mt-8 gap-4">
      {rows.map(row => (
        <View key={row[0]} className="flex-row gap-4">
          {row.map(i => {
            const item = items[i];
            return item === undefined ? null : (
              <View key={i} className="flex-1">
                {children(item, i)}
              </View>
            );
          })}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}

/** The web's `button:active` scale, for the chips. */
const pressScale = (pressed: boolean) => ({
  transform: [{ scale: pressed ? 0.97 : 1 }],
});

interface TransformQuestsProps {
  quests: KidQuests;
  sending: boolean;
  pick: (interest: QuestInterestKey) => Promise<KidQuests | null>;
  /** Resolves true when it was the quest's first log. */
  log: (interest: QuestInterestKey, quest: number) => Promise<boolean>;
  /** Waits for the log's progress: transform tells children (transform.quest_logged), which
   *  gives the star and opens Release in child view a moment later. */
  awaitProgress: (done: (activity: KidActivity) => boolean) => void;
}

/**
 * Transform in child view (web components/kids/TransformQuests): the plan's interest, or one
 * the child picks or adds, and its three quests. "I did it today" logs one once a day up to
 * its target; its first log gives a star.
 */
export default function TransformQuests({
  quests,
  sending,
  pick,
  log,
  awaitProgress,
}: TransformQuestsProps) {
  const [adding, setAdding] = useState(false);
  const mine = myInterests(quests);
  const current = currentInterest(quests);
  const interest = quests.catalog.find(i => i.key === current) ?? null;
  const others = quests.catalog.filter(i => !mine.includes(i.key));

  if (adding || !interest) {
    return (
      <View>
        <Text style={s.eyebrow}>Your quests</Text>
        <Text accessibilityRole="header" className="mt-3" style={s.title}>
          {interest ? 'Add another one' : 'What are you into?'}
        </Text>
        <Text className="mt-4" style={s.lead}>
          Pick one. You get quests for it.
        </Text>
        {interest ? (
          <Pressable
            onPress={() => setAdding(false)}
            accessibilityRole="button"
            accessibilityLabel="Back to my quests"
            className="mt-5 h-12 items-center justify-center self-center px-6"
            style={({ pressed }) => buttonOff(pressed)}
          >
            <Text style={[s.btnOff, { fontSize: 16, lineHeight: 24 }]}>
              Back to my quests
            </Text>
          </Pressable>
        ) : null}
        <TwoColumns items={others}>
          {(it, i) => (
            <Pressable
              disabled={sending}
              onPress={() =>
                void pick(it.key).then(next => {
                  if (next) setAdding(false);
                })
              }
              accessibilityRole="button"
              accessibilityLabel={it.label}
              accessibilityState={{ disabled: sending }}
              className="min-h-[110px] flex-1 items-center justify-center"
              style={({ pressed }) => tile(questColor(i), false, pressed)}
            >
              <Text style={s.tile}>{it.label}</Text>
            </Pressable>
          )}
        </TwoColumns>
      </View>
    );
  }

  return (
    <View>
      <Text style={s.eyebrow}>{interest.label}</Text>
      <Text accessibilityRole="header" className="mt-3" style={s.title}>
        Your quests
      </Text>

      <View
        accessibilityLabel="Your interests"
        className="mt-6 flex-row flex-wrap justify-center gap-3"
      >
        {mine.map(key => {
          const it = quests.catalog.find(c => c.key === key);
          if (!it) return null;
          const on = key === current;
          const ink = { color: on ? color('ink') : color('streak') };
          return (
            <Pressable
              key={key}
              disabled={sending || on}
              onPress={() => void pick(key)}
              accessibilityRole="button"
              accessibilityLabel={it.label}
              accessibilityState={{ selected: on, disabled: sending || on }}
              className="items-start px-4 py-2.5"
              style={({ pressed }) => [
                chip(AREA),
                on && { backgroundColor: color(AREA) },
                pressScale(pressed),
              ]}
            >
              <Text style={[s.chipLabel, ink]}>{it.label}</Text>
              <Text style={[s.chipFrom, ink]}>
                {key === quests.default_interest
                  ? 'From your parent'
                  : 'You added'}
              </Text>
            </Pressable>
          );
        })}
        {others.length > 0 ? (
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add another"
            className="flex-row items-center gap-2.5 px-4 py-2.5"
            style={({ pressed }) => [chip(AREA), pressScale(pressed)]}
          >
            <Plus size={20} color={color('text')} />
            <Text style={s.chipAdd}>Add another</Text>
          </Pressable>
        ) : null}
      </View>

      <View className="mt-8 gap-5">
        {interest.quests.map((q, i) => {
          const key = questKey(interest.key, i);
          const count = Math.min(quests.logs[key] ?? 0, q.target);
          const done = count >= q.target;
          const today = quests.logged_today.includes(key);
          const c = questColor(i);
          const doIt = async () => {
            if (await log(interest.key, i)) {
              awaitProgress(activity => activity.circles_done.transform);
            }
          };
          return (
            <View key={key} style={questCard(c, done)}>
              {/* Web: the text grows on the left, the progress dots sit top-right. */}
              <View className="flex-row items-start justify-between gap-4">
                <View className="min-w-0 flex-1">
                  <Text style={s.questNo}>Quest {i + 1}</Text>
                  <Text
                    accessibilityRole="header"
                    className="mt-1"
                    style={s.questTitle}
                  >
                    {q.title}
                  </Text>
                  <Text className="mt-2" style={s.questHow}>
                    {q.how}
                  </Text>
                </View>
                <View
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={`${count} of ${q.target} done`}
                  className="flex-row flex-wrap gap-1.5"
                >
                  {Array.from({ length: q.target }, (_, n) => (
                    <View
                      key={n}
                      style={[
                        questDot(c, n < count),
                        { width: 20, height: 20, borderRadius: 10 },
                      ]}
                    />
                  ))}
                </View>
              </View>
              <View className="mt-4">
                {done ? (
                  <View className="flex-row items-center gap-2">
                    <Check size={24} color={color('teal')} />
                    <Text style={s.questDone}>Quest done!</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => void doIt()}
                    disabled={sending || today}
                    accessibilityRole="button"
                    accessibilityLabel={today ? 'Done today' : 'I did it today'}
                    accessibilityState={{ disabled: sending || today }}
                    className="h-14 items-center justify-center self-start px-8"
                    style={({ pressed }) =>
                      today
                        ? buttonOff(false)
                        : [button(AREA, pressed), sending && { opacity: 0.5 }]
                    }
                  >
                    <Text style={today ? s.btnOff : s.btn}>
                      {today ? 'Done today' : 'I did it today'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
