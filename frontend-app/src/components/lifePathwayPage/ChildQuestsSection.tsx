import React from 'react';
import { Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useKidQuests } from '@/hooks/useKidQuests';
import { anyLogged, daysAgo, questSummary, questTotals } from '@/api/kidQuests';
import { localDay } from '@/lib/kidsDay';
import { rgb } from '@/theme';
import { GOLD, CYAN, em, orbitron, rajdhani } from './styles';

const C = (token: string, alpha?: number) =>
  rgb(`constellation-${token}`, alpha);

/** A small uppercase pill ("2/3 quests done", "Not started"; web PILL). */
const PILL: ViewStyle = {
  paddingVertical: 5,
  paddingHorizontal: 12,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: C('cyan', 0.25),
};
const PILL_TEXT: TextStyle = {
  ...rajdhani(11, 700),
  letterSpacing: em(11, 0.12),
  textTransform: 'uppercase',
  color: C('slate-pale'),
};
const RULE = { borderTopWidth: 1, borderTopColor: C('cyan', 0.07) } as const;

/** A quest's progress ring with "count/target" inside, teal once done (web conic ring). */
function Ring({
  count,
  target,
  done,
}: {
  count: number;
  target: number;
  done: boolean;
}) {
  const size = 48;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const part = Math.min(1, count / target);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${count} of ${target} logged`}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={C('cyan', 0.12)}
          strokeWidth={stroke}
          fill={C('ring-core')}
        />
        {part > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={done ? C('teal') : C('cyan')}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${length * part} ${length}`}
            // From the top, clockwise (the web's conic gradient).
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View className="absolute inset-0 items-center justify-center">
        <Text style={[orbitron(12, 700), { color: C('cyan-pale') }]}>
          {count}/{target}
        </Text>
      </View>
    </View>
  );
}

interface ChildQuestsSectionProps {
  childId: string;
  childName: string;
}

/**
 * The child's Transform quests on the parent's Life Pathway (web
 * components/lifepathway/ChildQuests, the prototype's panel): the done chip, "Your topic: …
 * · done in child view", the plan topic's "Logged" and "Finished n/3", each quest with its
 * ring, status and when it was last logged; before any log, the topic and "Not started". Any
 * interest the child added follows. Hidden while it loads or when transform refuses.
 */
export default function ChildQuestsSection({
  childId,
  childName,
}: ChildQuestsSectionProps) {
  const { quests } = useKidQuests(childId);
  if (!quests) return null;
  const summary = questSummary(quests);
  const name = childName.trim();
  const who = name.length > 0 ? name.split(/\s+/)[0] ?? name : 'Your child';
  const topic = summary.find(s => s.fromParent) ?? summary[0];
  const totals = topic ? questTotals(topic.quests) : null;
  // Anything logged, in the plan's topic or an interest the child added, shows the list; the
  // header's chip and counts are the plan topic's own (0/3 when only an added one is logged).
  const started = anyLogged(quests);
  const today = localDay();

  return (
    <View
      style={{
        marginTop: 56,
        borderRadius: 20,
        backgroundColor: C('panel', 0.62),
        borderWidth: 1,
        borderColor: C('cyan', 0.14),
        overflow: 'hidden',
      }}
    >
      <View
        className="flex-row flex-wrap items-center justify-between gap-4"
        style={{
          paddingTop: 22,
          paddingHorizontal: 20,
          paddingBottom: 20,
          borderBottomWidth: 1,
          borderBottomColor: C('cyan', 0.09),
        }}
      >
        <View className="shrink">
          <View className="flex-row flex-wrap items-center gap-2.5">
            <Text
              accessibilityRole="header"
              style={[orbitron(17, 700), { color: C('cyan-paler') }]}
            >
              {who}&apos;s quests
            </Text>
            <View style={PILL}>
              <Text style={PILL_TEXT}>
                {started && totals
                  ? `${totals.finished}/${totals.total} quests done`
                  : 'Not started'}
              </Text>
            </View>
          </View>
          <Text
            style={[
              rajdhani(13, 600),
              { marginTop: 5, color: C('slate-warm') },
            ]}
          >
            {topic
              ? `Your topic: ${topic.label} · done in child view`
              : 'Done in child view'}
          </Text>
        </View>
        {started && totals ? (
          <View className="flex-row" style={{ gap: 22 }}>
            {[
              { n: String(totals.logged), label: 'Logged', on: false },
              {
                n: `${totals.finished}/${totals.total}`,
                label: 'Finished',
                on: totals.finished > 0,
              },
            ].map(k => (
              <View key={k.label} className="items-end">
                <Text
                  style={[
                    orbitron(19, 700),
                    {
                      lineHeight: 19,
                      color: k.on ? C('teal-pale') : C('cyan-pale'),
                    },
                  ]}
                >
                  {k.n}
                </Text>
                <Text
                  style={[
                    rajdhani(9.5, 700),
                    {
                      marginTop: 6,
                      letterSpacing: em(9.5, 0.14),
                      textTransform: 'uppercase',
                      color: C('slate-mute'),
                    },
                  ]}
                >
                  {k.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {!started || !topic ? (
        <View style={{ paddingVertical: 26, paddingHorizontal: 20 }}>
          <View className="flex-row flex-wrap items-center justify-between gap-3">
            <Text style={[rajdhani(15, 700), { color: C('cyan-pale') }]}>
              {topic?.label ?? 'Quests'}
            </Text>
            <View style={PILL}>
              <Text style={PILL_TEXT}>Not started</Text>
            </View>
          </View>
          <Text
            style={[
              rajdhani(13.5, 600),
              { marginTop: 6, lineHeight: 13.5 * 1.5, color: C('slate-warm') },
            ]}
          >
            When {who} logs a {topic?.label ?? ''} quest in child view, it shows
            up here.
          </Text>
        </View>
      ) : (
        summary.map(interest => (
          <View key={interest.key}>
            {interest !== topic ? (
              <Text
                style={[
                  rajdhani(10.5, 700),
                  RULE,
                  {
                    paddingTop: 14,
                    paddingHorizontal: 20,
                    paddingBottom: 4,
                    letterSpacing: em(10.5, 0.18),
                    textTransform: 'uppercase',
                    color: CYAN,
                  },
                ]}
              >
                {interest.label} · {who} added
              </Text>
            ) : null}
            {interest.quests.map(q => {
              const done = q.count >= q.target;
              const on = q.count > 0;
              return (
                <View
                  key={q.title}
                  className="flex-row items-center"
                  style={[
                    RULE,
                    { paddingVertical: 16, paddingHorizontal: 20, gap: 16 },
                  ]}
                >
                  <Ring count={q.count} target={q.target} done={done} />
                  <View className="min-w-0 flex-1">
                    <View className="flex-row flex-wrap items-center gap-2.5">
                      <Text
                        style={[
                          rajdhani(16, 700),
                          { lineHeight: 20, color: C('cyan-pale') },
                        ]}
                      >
                        {q.title}
                      </Text>
                      <Text
                        style={[
                          rajdhani(10, 700),
                          {
                            letterSpacing: em(10, 0.12),
                            textTransform: 'uppercase',
                            color: done
                              ? C('teal')
                              : on
                              ? GOLD
                              : C('slate-dim'),
                          },
                        ]}
                      >
                        {done ? 'Done' : on ? 'In progress' : 'Not started'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        rajdhani(13, 600),
                        {
                          marginTop: 4,
                          lineHeight: 13 * 1.4,
                          color: C('slate-warm'),
                        },
                      ]}
                    >
                      {on
                        ? q.lastLogged
                          ? `Last logged ${daysAgo(q.lastLogged, today)}`
                          : 'Logged'
                        : q.how}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ))
      )}
    </View>
  );
}
