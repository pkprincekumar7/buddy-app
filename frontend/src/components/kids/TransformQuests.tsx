import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { KidActivity } from '@/api/kids';
import {
  currentInterest,
  myInterests,
  questKey,
  type KidQuests,
  type QuestInterestKey,
} from '@/api/kidQuests';
import { cn } from '@/lib/utils';
import { POWER_COLORS, tileVars } from '@/components/kids/palette';

const questColor = (i: number) => POWER_COLORS[i % POWER_COLORS.length] ?? 'transform';

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
 * Transform in child view (docs/child-view-build-plan.md, 3.2): the interest the parent's plan
 * names, or one the child picks or adds, and its three quests. "I did it today" logs a quest
 * once a day up to its target (transform keeps the count); its first log gives a star.
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
  const interest = quests.catalog.find((i) => i.key === current) ?? null;
  const others = quests.catalog.filter((i) => !mine.includes(i.key));

  if (adding || !interest) {
    return (
      <div className="mx-auto max-w-4xl">
        <section className="text-center">
          <p className="text-base font-bold uppercase tracking-[0.3em] text-kids-area">
            Your quests
          </p>
          <h1 className="mt-3 font-orbitron text-4xl font-black leading-tight text-kids-text md:text-5xl">
            {interest ? 'Add another one' : 'What are you into?'}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-2xl font-semibold leading-snug text-kids-body">
            Pick one. You get quests for it.
          </p>
          {interest && (
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="kids-btn-off mt-5 h-12 px-6 text-base"
            >
              Back to my quests
            </button>
          )}
        </section>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {others.map((it, i) => (
            <button
              key={it.key}
              type="button"
              disabled={sending}
              onClick={() =>
                void pick(it.key).then((next) => {
                  if (next) setAdding(false);
                })
              }
              style={tileVars(questColor(i))}
              className="kids-tile min-h-[110px] text-xl"
            >
              {it.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <section className="text-center">
        <p className="text-base font-bold uppercase tracking-[0.3em] text-kids-area">
          {interest.label}
        </p>
        <h1 className="mt-3 font-orbitron text-4xl font-black leading-tight text-kids-text md:text-5xl">
          Your quests
        </h1>
      </section>

      <div
        className="mt-6 flex flex-wrap justify-center gap-3"
        role="group"
        aria-label="Your interests"
      >
        {mine.map((key) => {
          const it = quests.catalog.find((c) => c.key === key);
          if (!it) return null;
          const on = key === current;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              disabled={sending || on}
              onClick={() => void pick(key)}
              className={cn(
                'kids-chip flex-col items-start gap-0 text-left',
                on ? 'bg-kids-area text-kids-ink' : 'text-kids-streak',
              )}
            >
              <span className="font-orbitron text-lg font-black">{it.label}</span>
              <span className="text-xs font-bold uppercase tracking-[0.15em] opacity-80">
                {key === quests.default_interest ? 'From your parent' : 'You added'}
              </span>
            </button>
          );
        })}
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="kids-chip text-lg font-bold text-kids-text"
          >
            <Plus className="h-5 w-5" aria-hidden="true" /> Add another
          </button>
        )}
      </div>

      <div className="mt-8 grid gap-5">
        {interest.quests.map((q, i) => {
          const key = questKey(interest.key, i);
          const count = Math.min(quests.logs[key] ?? 0, q.target);
          const done = count >= q.target;
          const today = quests.logged_today.includes(key);
          const doIt = async () => {
            if (await log(interest.key, i)) {
              awaitProgress((activity) => activity.circles_done.transform);
            }
          };
          return (
            <div
              key={key}
              style={tileVars(questColor(i))}
              className={cn('kids-quest', done && 'kids-quest-done')}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-orbitron text-sm font-black uppercase tracking-[0.2em] text-kids-muted">
                    Quest {i + 1}
                  </p>
                  <h2 className="mt-1 font-orbitron text-2xl font-black text-kids-text">
                    {q.title}
                  </h2>
                  <p className="mt-2 text-xl font-semibold text-kids-body">{q.how}</p>
                </div>
                <div
                  role="img"
                  aria-label={`${count} of ${q.target} done`}
                  className="flex flex-wrap gap-1.5"
                >
                  {Array.from({ length: q.target }, (_, n) => (
                    <span
                      key={n}
                      className={cn('kids-quest-dot', n < count && 'kids-quest-dot-on')}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-4">
                {done ? (
                  <p className="flex items-center gap-2 text-xl font-bold text-kids-teal">
                    <Check className="h-6 w-6" aria-hidden="true" /> Quest done!
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={sending || today}
                    onClick={() => void doIt()}
                    className={cn('h-14 px-8 text-lg', today ? 'kids-btn-off' : 'kids-btn')}
                  >
                    {today ? 'Done today' : 'I did it today'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
