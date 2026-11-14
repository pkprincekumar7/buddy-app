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
import Svg, { Path } from 'react-native-svg';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import {
  KIDS_COLORS,
  color,
  interest as interestStyle,
  interestTile,
  questCard,
  questDot,
  questLog,
  questNo,
} from '@/components/kids/palette';
import { enter } from '@/components/kids/enter';
import { rgb } from '@/theme';

/** The star in a filled progress ring (web STAR). */
const STAR =
  'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z';

const questColor = (i: number) =>
  KIDS_COLORS[i % KIDS_COLORS.length] ?? 'transform';

/** Transform's circle colour: the web's --kids-area on this tab (.kids-btn, .kids-chip, text-kids-area). */
const AREA = 'transform';

/** The child view's type scale (matched to the parent pages at phone width), in px. */
const s = {
  // text-xs font-bold uppercase tracking-[0.3em] text-kids-area
  eyebrow: {
    ...font('rajdhani', 700),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 12 * 0.3,
    textTransform: 'uppercase',
    textAlign: 'center',
    color: color(AREA),
  },
  // font-orbitron text-3xl font-black leading-tight
  title: {
    ...font('orbitron', 900),
    fontSize: 30,
    lineHeight: 30 * 1.25,
    textAlign: 'center',
    color: color('text'),
  },
  // max-w-xl text-[17px] font-semibold leading-snug text-kids-body
  lead: {
    ...font('rajdhani', 600),
    fontSize: 17,
    lineHeight: 17 * 1.375,
    maxWidth: 576,
    alignSelf: 'center',
    textAlign: 'center',
    color: color('body'),
  },
  // .kids-interest text-base: dark ink.
  tile: {
    ...font('orbitron', 900),
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    color: color('ink'),
  },
  // An interest chip: Orbitron 900 15px, then Rajdhani 12px uppercase .08em.
  chipLabel: { ...font('orbitron', 900), fontSize: 15, lineHeight: 20 },
  chipFrom: {
    ...font('rajdhani', 700),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 12 * 0.08,
    textTransform: 'uppercase',
  },
  // "+ Add another", "Back to my quests": Rajdhani bold, #ffe08a.
  gold: {
    ...font('rajdhani', 700),
    fontSize: 16,
    lineHeight: 22,
    color: color('streak'),
  },
  questNo: {
    ...font('orbitron', 900),
    fontSize: 16,
    lineHeight: 20,
    color: color('ink'),
  },
  questTitle: {
    ...font('orbitron', 900),
    fontSize: 18,
    lineHeight: 22,
    color: color('text'),
  },
  questHow: {
    ...font('rajdhani', 600),
    fontSize: 17,
    lineHeight: 17 * 1.4,
    color: rgb('kids-how'),
  },
  // The round button's words: Orbitron 900 13px.
  log: {
    ...font('orbitron', 900),
    fontSize: 13,
    lineHeight: 14,
    textAlign: 'center',
    color: color('ink'),
  },
} satisfies Record<string, TextStyle>;

/** The web's `grid grid-cols-2 gap-3`: rows of two equal cells, 12px apart. */
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
    <View className="mt-6 gap-3">
      {rows.map(row => (
        <View key={row[0]} className="flex-row gap-3">
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

/** The quests page's header is left-aligned (web). */
const LEFT = { textAlign: 'left' } as const;

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
  const reduced = useReducedMotion();
  const mine = myInterests(quests);
  const current = currentInterest(quests);
  const interest = quests.catalog.find(i => i.key === current) ?? null;
  const others = quests.catalog.filter(i => !mine.includes(i.key));

  if (adding || !interest) {
    return (
      <View>
        <Animated.View style={enter('up', 0, reduced)}>
          <Text style={s.eyebrow}>Your quests</Text>
          <Text accessibilityRole="header" className="mt-2.5" style={s.title}>
            {interest ? 'Add another one' : 'What are you into?'}
          </Text>
          <Text className="mt-3" style={s.lead}>
            {interest
              ? 'Pick what else you are into. You get new quests for it.'
              : 'Pick one. You get quests for it.'}
          </Text>
          {interest ? (
            <Pressable
              onPress={() => setAdding(false)}
              accessibilityRole="button"
              accessibilityLabel="Back to my quests"
              className="mt-4 self-center"
              style={({ pressed }) => interestStyle.back(pressed)}
            >
              <Text style={s.gold}>Back to my quests</Text>
            </Pressable>
          ) : null}
        </Animated.View>
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
              className="flex-1"
              style={({ pressed }) => interestTile(questColor(i), pressed)}
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
      <Animated.View style={enter('up', 0, reduced)}>
        <Text style={[s.eyebrow, LEFT]}>{interest.label}</Text>
        <Text
          accessibilityRole="header"
          className="mt-2.5"
          style={[s.title, LEFT]}
        >
          Your quests
        </Text>
        <Text
          className="mt-2.5"
          style={[s.lead, LEFT, { alignSelf: 'stretch' }]}
        >
          Do it for real, then tap the big button.
        </Text>
      </Animated.View>

      <View
        accessibilityLabel="Your interests"
        className="mt-5 flex-row flex-wrap gap-3"
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
              style={({ pressed }) => [
                interestStyle.chip(on),
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
            style={({ pressed }) => interestStyle.add(pressed)}
          >
            <Plus size={16} strokeWidth={2.6} color={color('streak')} />
            <Text style={s.gold}>Add another</Text>
          </Pressable>
        ) : null}
      </View>

      <View className="mt-6" style={{ gap: 18 }}>
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
            <Animated.View
              key={key}
              style={[questCard(c, done), enter('up', 0, reduced)]}
            >
              {/* The text on the left, the round button on the right. */}
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-3">
                  <View
                    accessible
                    accessibilityLabel={`Quest ${i + 1}`}
                    style={questNo(done ? 'teal' : c)}
                  >
                    <Text style={s.questNo}>{i + 1}</Text>
                  </View>
                  <Text
                    accessibilityRole="header"
                    className="shrink"
                    style={s.questTitle}
                  >
                    {q.title}
                  </Text>
                </View>
                <Text className="mt-2.5" style={s.questHow}>
                  {q.how}
                </Text>
                <View
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={`${count} of ${q.target} done`}
                  className="mt-3.5 flex-row flex-wrap"
                  style={{ gap: 9 }}
                >
                  {Array.from({ length: q.target }, (_, n) => (
                    <View
                      key={n}
                      style={questDot(done ? 'teal' : c, n < count)}
                    >
                      {n < count ? (
                        <Svg width={16} height={16} viewBox="0 0 24 24">
                          <Path d={STAR} fill={color('ink')} />
                        </Svg>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
              {done ? (
                <Animated.View
                  accessibilityLiveRegion="polite"
                  style={[questLog(c, 'done'), enter('pop', 0, reduced, 0.45)]}
                >
                  <Check size={32} strokeWidth={3.4} color={color('ink')} />
                  <Text style={s.log}>Quest done!</Text>
                </Animated.View>
              ) : (
                <Pressable
                  onPress={() => void doIt()}
                  disabled={sending || today}
                  accessibilityRole="button"
                  accessibilityLabel={today ? 'Done today' : 'I did it today'}
                  accessibilityState={{ disabled: sending || today }}
                  style={({ pressed }) => [
                    questLog(c, today ? 'today' : 'todo', pressed && !today),
                    sending && !today && { opacity: 0.5 },
                  ]}
                >
                  {today ? (
                    <Check size={32} strokeWidth={3.4} color={color('text')} />
                  ) : (
                    <Plus size={32} strokeWidth={3.4} color={color('ink')} />
                  )}
                  <Text style={[s.log, today && { color: color('text') }]}>
                    {today ? 'Done today' : 'I did it today'}
                  </Text>
                </Pressable>
              )}
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}
