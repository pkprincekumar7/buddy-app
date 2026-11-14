import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useKidActivity } from '@/hooks/useKidActivity';
import { moodStreak } from '@/lib/kidsDay';
import { MOODS, parentStreakLine, recentMoodDays } from '@/lib/kidsMoods';
import MoodFace from '@/components/kids/MoodFace';
import { font, rgb } from '@/theme';
import { SECTION_LABEL, bodyText, fadeUp } from './styles';

const DAYS_SHOWN = 14;

function dayParts(day: string): { weekday: string; full: string } {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  return {
    weekday: date.toLocaleDateString('en-GB', { weekday: 'short' }),
    full: date.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
  };
}

/**
 * The child's Release check-ins, for the parent (web components/observations/RecentMoods):
 * the last two weeks as faces, and the streak. Only the mood, never the child's note.
 * Hidden while loading or when the read fails.
 */
export default function RecentMoods({
  childId,
  childName,
}: {
  childId: string | undefined;
  childName: string;
}) {
  const { activity, day } = useKidActivity(childId);
  if (!activity) return null;

  const trimmed = childName.trim();
  const name = trimmed ? trimmed.split(/\s+/)[0] ?? trimmed : 'Your child';
  const days = recentMoodDays(activity.moods, day, DAYS_SHOWN);
  const checkedIn = days.filter(d => d.mood).length;
  const streak = moodStreak(activity.moods, day);
  const weeks = [days.slice(0, 7), days.slice(7)];

  return (
    <Animated.View {...fadeUp(0.29)} style={{ marginTop: 44 }}>
      <Text accessibilityRole="header" style={SECTION_LABEL}>
        How {name} has been feeling
      </Text>
      <View
        style={{
          marginTop: 16,
          borderRadius: 18,
          paddingVertical: 20,
          paddingHorizontal: 16,
          backgroundColor: rgb('constellation-card', 0.6),
          borderWidth: 1,
          borderColor: rgb('constellation-cyan', 0.12),
        }}
      >
        {checkedIn === 0 ? (
          <Text style={bodyText(14, 1.5, 'constellation-slate-light')}>
            No check-ins in the last two weeks. When {name} picks a mood in
            Release, in child view, it shows up here.
          </Text>
        ) : (
          <>
            <View
              accessibilityLabel={`${name}'s moods, the last ${DAYS_SHOWN} days`}
              style={{ gap: 8 }}
            >
              {weeks.map((week, w) => (
                <View key={w} className="flex-row" style={{ gap: 6 }}>
                  {week.map(d => {
                    const today = d.day === day;
                    const parts = dayParts(d.day);
                    const label = MOODS.find(m => m.key === d.mood)?.label;
                    return (
                      <View
                        key={d.day}
                        accessible
                        accessibilityLabel={`${today ? 'Today' : parts.full}: ${
                          label ?? 'no check-in'
                        }`}
                        className="flex-1 items-center"
                        style={{
                          gap: 6,
                          paddingVertical: 8,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: rgb(
                            'constellation-cyan',
                            today ? 0.35 : 0,
                          ),
                          backgroundColor: today
                            ? rgb('constellation-cyan', 0.08)
                            : undefined,
                        }}
                      >
                        <View
                          className="items-center justify-center"
                          style={{ width: 28, height: 28 }}
                        >
                          {d.mood ? (
                            <MoodFace mood={d.mood} size={28} />
                          ) : (
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: rgb(
                                  'constellation-slate',
                                  0.35,
                                ),
                              }}
                            />
                          )}
                        </View>
                        <Text
                          style={{
                            ...font('rajdhani', 700),
                            fontSize: 11,
                            color: rgb(
                              today
                                ? 'constellation-cyan-soft'
                                : 'constellation-slate',
                            ),
                          }}
                        >
                          {parts.weekday}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
            <Text
              style={{
                ...font('rajdhani', 700),
                marginTop: 16,
                fontSize: 15,
                color: rgb('constellation-gold'),
              }}
            >
              {parentStreakLine(streak, name)}
            </Text>
            <Text
              style={[
                bodyText(14, 1.5, 'constellation-slate-light'),
                { marginTop: 4 },
              ]}
            >
              Checked in on {checkedIn} of the last {DAYS_SHOWN} days
            </Text>
          </>
        )}
        <Text
          style={[
            bodyText(13, 1.5, 'constellation-slate-light'),
            { marginTop: 12 },
          ]}
        >
          Only the mood is shown here, not what {name} writes with it.
        </Text>
      </View>
    </Animated.View>
  );
}
