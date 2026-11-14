import type { CSSProperties } from 'react';
import { useKidActivity } from '@/hooks/useKidActivity';
import { moodStreak } from '@/lib/kidsDay';
import { MOODS, parentStreakLine, recentMoodDays } from '@/lib/kidsMoods';
import MoodFace from '@/components/kids/MoodFace';

/** The Observations page's type scale (its `--obs-type-scale`). */
const fs = (px: number) => `calc(${px}px * var(--obs-type-scale, 1))`;

const DAYS_SHOWN = 14;

const LABEL: CSSProperties = {
  fontWeight: 700,
  fontSize: fs(14),
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'rgb(var(--constellation-cyan-pale-rgb))',
};

const MUTED: CSSProperties = {
  fontSize: fs(14),
  fontWeight: 600,
  lineHeight: 1.5,
  color: 'rgb(var(--constellation-slate-light-rgb))',
};

function dayParts(day: string): { weekday: string; full: string } {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  return {
    weekday: date.toLocaleDateString('en-GB', { weekday: 'short' }),
    full: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
  };
}

/**
 * The child's Release check-ins, for the parent (docs/child-view-build-plan.md, 2.4): the
 * last two weeks as faces, and the streak. Only the mood: the child's notes are their own
 * and are never shown here. Hidden while loading or when the read fails; the page's
 * observations don't depend on it.
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
  const name = trimmed ? (trimmed.split(/\s+/)[0] ?? trimmed) : 'Your child';
  const days = recentMoodDays(activity.moods, day, DAYS_SHOWN);
  const checkedIn = days.filter((d) => d.mood).length;
  const streak = moodStreak(activity.moods, day);

  return (
    <section style={{ marginTop: 44, animation: 'obsFadeUp .7s ease .29s both' }}>
      <div className="font-orbitron" style={LABEL}>
        How {name} has been feeling
      </div>
      <div
        style={{
          marginTop: 16,
          borderRadius: 18,
          padding: '20px 21px',
          background: 'rgb(var(--constellation-card-rgb) / .6)',
          border: '1px solid rgb(var(--constellation-cyan-rgb) / .12)',
        }}
      >
        {checkedIn === 0 ? (
          <div style={MUTED}>
            No check-ins in the last two weeks. When {name} picks a mood in Release, in child view,
            it shows up here.
          </div>
        ) : (
          <>
            <ol
              aria-label={`${name}'s moods, the last ${DAYS_SHOWN} days`}
              style={{
                display: 'grid',
                // Two rows of a week each, so the faces stay readable on a phone.
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                gap: 8,
                margin: 0,
                padding: 0,
                listStyle: 'none',
              }}
            >
              {days.map((d) => {
                const today = d.day === day;
                const parts = dayParts(d.day);
                const label = MOODS.find((m) => m.key === d.mood)?.label;
                return (
                  <li
                    key={d.day}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 0',
                      borderRadius: 12,
                      background: today ? 'rgb(var(--constellation-cyan-rgb) / .08)' : undefined,
                      border: `1px solid rgb(var(--constellation-cyan-rgb) / ${today ? 0.35 : 0})`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        maxWidth: 34,
                        aspectRatio: '1',
                      }}
                    >
                      {d.mood ? (
                        <MoodFace mood={d.mood} className="h-full w-full" />
                      ) : (
                        <span
                          style={{
                            width: '30%',
                            aspectRatio: '1',
                            borderRadius: '50%',
                            background: 'rgb(var(--constellation-slate-rgb) / .35)',
                          }}
                        />
                      )}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        fontWeight: 700,
                        fontSize: fs(11),
                        color: today
                          ? 'rgb(var(--constellation-cyan-soft-rgb))'
                          : 'rgb(var(--constellation-slate-rgb))',
                      }}
                    >
                      {parts.weekday}
                    </span>
                    <span className="sr-only">{`${today ? 'Today' : parts.full}: ${label ?? 'no check-in'}`}</span>
                  </li>
                );
              })}
            </ol>
            <div
              style={{
                marginTop: 16,
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: fs(15),
                  color: 'rgb(var(--constellation-gold-rgb))',
                }}
              >
                {parentStreakLine(streak, name)}
              </div>
              <div style={MUTED}>
                Checked in on {checkedIn} of the last {DAYS_SHOWN} days
              </div>
            </div>
          </>
        )}
        <div style={{ ...MUTED, marginTop: 12, fontSize: fs(13) }}>
          Only the mood is shown here, not what {name} writes with it.
        </div>
      </div>
    </section>
  );
}
