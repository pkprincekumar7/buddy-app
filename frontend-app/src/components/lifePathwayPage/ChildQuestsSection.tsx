import React from 'react';
import { Text, View } from 'react-native';
import { useKidQuests } from '@/hooks/useKidQuests';
import { anyLogged, questSummary, shortDay } from '@/api/kidQuests';
import { css } from '@/theme';
import { CYAN, GOLD, em, orbitron, rajdhani } from './styles';

const FROST = css('rgb(var(--constellation-text-frost-rgb))');
const BODY = css('rgb(var(--constellation-slate-warm-rgb))');
const LABEL = css('rgb(var(--constellation-slate-mute-rgb))');
const TITLE = css('rgb(var(--constellation-cyan-paler-rgb))');
const CARD = {
  marginTop: 16,
  paddingVertical: 18,
  paddingHorizontal: 18,
  borderRadius: 18,
  backgroundColor: css('rgb(var(--constellation-navy-deepest-rgb) / .6)'),
  borderWidth: 1,
  borderColor: css('rgb(var(--constellation-cyan-rgb) / .2)'),
} as const;

interface ChildQuestsSectionProps {
  childId: string;
  childName: string;
}

/**
 * The child's Transform quests on the parent's Life Pathway (web
 * components/lifepathway/ChildQuests): each quest's count and last day, or "Nothing logged
 * yet". Hidden while it loads or when transform refuses.
 */
export default function ChildQuestsSection({
  childId,
  childName,
}: ChildQuestsSectionProps) {
  const { quests } = useKidQuests(childId);
  if (!quests) return null;
  const summary = questSummary(quests);
  const who = childName || 'Your child';

  return (
    <View style={{ marginTop: 56 }}>
      <Text accessibilityRole="header" style={[orbitron(17), { color: TITLE }]}>
        {who}&apos;s quests
      </Text>
      <Text style={[rajdhani(13.5, 600), { marginTop: 6, color: BODY }]}>
        What {who} does in child view, quest by quest.
      </Text>
      {!anyLogged(quests) || summary.length === 0 ? (
        <View style={CARD}>
          <Text style={[rajdhani(15, 700), { color: FROST }]}>
            Nothing logged yet.
          </Text>
          <Text style={[rajdhani(13.5, 600), { marginTop: 4, color: BODY }]}>
            When {who} ticks off a quest in child view, it shows here.
          </Text>
        </View>
      ) : (
        summary.map(interest => (
          <View key={interest.key} style={CARD}>
            <View className="flex-row flex-wrap items-baseline gap-2.5">
              <Text style={[orbitron(15), { color: FROST }]}>
                {interest.label}
              </Text>
              <Text
                style={[
                  rajdhani(10.5, 700),
                  {
                    letterSpacing: em(10.5, 0.18),
                    textTransform: 'uppercase',
                    color: interest.fromParent ? GOLD : CYAN,
                  },
                ]}
              >
                {interest.fromParent ? 'From your plan' : `${who} added`}
              </Text>
            </View>
            <View className="mt-2.5 gap-2">
              {interest.quests.map(q => {
                const done = q.count >= q.target;
                return (
                  <View
                    key={q.title}
                    className="flex-row flex-wrap justify-between gap-3"
                  >
                    <Text style={[rajdhani(14.5, 600), { color: FROST }]}>
                      {q.title}
                    </Text>
                    <Text style={[rajdhani(14.5, 600), { color: LABEL }]}>
                      <Text
                        style={{
                          ...rajdhani(14.5, 700),
                          color: done ? GOLD : CYAN,
                        }}
                      >
                        {done ? 'Done' : `${q.count} of ${q.target}`}
                      </Text>
                      {' · '}
                      {q.lastLogged
                        ? `last ${shortDay(q.lastLogged)}`
                        : 'not yet'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ))
      )}
    </View>
  );
}
