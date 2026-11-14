import React from 'react';
import { Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import type { Child } from '@/api/children';
import { questSummary, shortDay } from '@/api/kidQuests';
import { daysAgo } from '@/api/kidWorlds';
import { useKidActivity } from '@/hooks/useKidActivity';
import { useKidQuests } from '@/hooks/useKidQuests';
import { navigate } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { color } from '@/theme';

/**
 * What a child did in child view, on the parent's Home (web components/home/ChildViewNews):
 * the wins they chose to show and the quests they logged. Hidden until there's something to
 * show; "Share from Connect" once the parent's Connect is open.
 */
export default function ChildViewNews({ child }: { child: Child }) {
  const { activity } = useKidActivity(child.id);
  const { quests } = useKidQuests(child.id);
  const wins = Object.values(activity?.shown ?? {}).sort((a, b) =>
    b.at.localeCompare(a.at),
  );
  const logged = (quests ? questSummary(quests) : [])
    .flatMap(interest =>
      interest.quests.map(q => ({ ...q, interest: interest.label })),
    )
    .filter(q => q.count > 0 && q.lastLogged)
    .sort((a, b) => (b.lastLogged ?? '').localeCompare(a.lastLogged ?? ''));
  if (wins.length === 0 && logged.length === 0) return null;

  return (
    <View
      accessibilityLabel={`From ${child.name}'s child view`}
      className="mt-6 w-full rounded-2xl border border-edge-faint bg-card p-5"
    >
      <Text
        accessibilityRole="header"
        className="text-lg font-semibold text-foreground"
      >
        From {child.name}’s child view
      </Text>
      {wins.length > 0 ? (
        <View className="mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {child.name} wants to show you
          </Text>
          <View className="mt-2 gap-2">
            {wins.map(w => (
              <View key={w.title} className="flex-row items-center gap-2">
                <Star size={16} color={color.primary} />
                <Text className="flex-1 text-sm text-foreground">
                  {w.title}
                </Text>
                <Text className="text-sm text-muted-foreground">
                  {daysAgo(w.at)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {logged.length > 0 ? (
        <View className="mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quests
          </Text>
          <View className="mt-2 gap-2">
            {logged.slice(0, 5).map(q => (
              <View
                key={`${q.interest}-${q.title}`}
                className="flex-row flex-wrap justify-between gap-2"
              >
                <Text className="text-sm text-foreground">
                  {q.title}
                  <Text className="text-muted-foreground"> · {q.interest}</Text>
                </Text>
                <Text className="text-sm text-muted-foreground">
                  {q.count >= q.target ? 'Done' : `${q.count} of ${q.target}`} ·
                  last {q.lastLogged ? shortDay(q.lastLogged) : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {child.progress.release && wins.length > 0 ? (
        <Button
          size="sm"
          variant="outline"
          onPress={() => navigate(`/Connect/${child.id}`)}
          accessibilityLabel="Share from Connect"
          className="mt-4 self-start rounded-full"
        >
          Share from Connect
        </Button>
      ) : null}
    </View>
  );
}
