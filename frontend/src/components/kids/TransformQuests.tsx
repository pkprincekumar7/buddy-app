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
import { KIDS_COLORS, tileVars } from '@/components/kids/palette';

const questColor = (i: number) => KIDS_COLORS[i % KIDS_COLORS.length] ?? 'transform';

/** The star in a filled progress ring (the prototype's). */
const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z';

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
        <section className="kids-enter-up text-center">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-kids-area md:text-sm">
            Your quests
          </p>
          <h1 className="mt-3 font-orbitron text-[clamp(28px,4vw,44px)] font-black leading-tight text-kids-text md:text-[clamp(34px,4.8vw,53px)]">
            {interest ? 'Add another one' : 'What are you into?'}
          </h1>
          <p className="mx-auto mt-3 max-w-[520px] text-pretty text-[17px] font-semibold leading-snug text-kids-body md:text-xl">
            {interest
              ? 'Pick what else you are into. You get new quests for it.'
              : 'Pick one. You get quests for it.'}
          </p>
          {interest && (
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="kids-quests-back mt-4 md:mt-[18px]"
            >
              Back to my quests
            </button>
          )}
        </section>
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] sm:gap-4 md:mt-[30px]">
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
              className="kids-interest"
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
      <section className="kids-enter-up">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-kids-area md:text-sm">
          {interest.label}
        </p>
        <h1 className="mt-2.5 font-orbitron text-[clamp(28px,4vw,44px)] font-black leading-[1.08] text-kids-text md:text-[clamp(34px,4.8vw,53px)]">
          Your quests
        </h1>
        <p className="mt-2.5 text-[17px] font-semibold leading-snug text-kids-body md:text-xl">
          Do it for real, then tap the big button.
        </p>
      </section>

      <div
        className="mt-5 flex flex-wrap gap-3 md:mt-[22px]"
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
              className={cn('kids-interest-chip', on && 'kids-interest-chip-on')}
            >
              <span className="font-orbitron text-[15px] font-black md:text-lg">{it.label}</span>
              <span className="font-rajdhani text-xs font-bold uppercase tracking-[0.08em] md:text-sm">
                {key === quests.default_interest ? 'From your parent' : 'You added'}
              </span>
            </button>
          );
        })}
        {others.length > 0 && (
          <button
            type="button"
            aria-label="Add another"
            onClick={() => setAdding(true)}
            className="kids-interest-add"
          >
            <Plus className="h-4 w-4" strokeWidth={2.6} aria-hidden="true" /> Add another
          </button>
        )}
      </div>

      <div className="mt-6 grid gap-[18px] md:mt-7">
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
              style={tileVars(done ? 'teal' : questColor(i))}
              className={cn('kids-quest kids-enter-up', done && 'kids-quest-done')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="kids-quest-no">
                    <span className="sr-only">Quest </span>
                    {i + 1}
                  </span>
                  <h2 className="min-w-0 font-orbitron text-lg font-black leading-tight text-kids-text md:text-2xl">
                    {q.title}
                  </h2>
                </div>
                <p className="mt-2.5 text-pretty text-[17px] font-semibold leading-[1.4] text-kids-how md:text-xl">
                  {q.how}
                </p>
                <div
                  role="img"
                  aria-label={`${count} of ${q.target} done`}
                  className="mt-3.5 flex flex-wrap gap-[9px]"
                >
                  {Array.from({ length: q.target }, (_, n) => (
                    <span
                      key={n}
                      className={cn('kids-quest-dot', n < count && 'kids-quest-dot-on')}
                    >
                      {n < count && (
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                          <path d={STAR} fill="currentColor" />
                        </svg>
                      )}
                    </span>
                  ))}
                </div>
              </div>
              {done ? (
                <div className="kids-quest-log-done" role="status">
                  <Check className="h-8 w-8 md:h-9 md:w-9" strokeWidth={3.4} aria-hidden="true" />
                  Quest done!
                </div>
              ) : (
                <button
                  type="button"
                  disabled={sending || today}
                  onClick={() => void doIt()}
                  className={cn('kids-quest-log', today && 'kids-quest-log-today')}
                >
                  {today ? (
                    <Check className="h-8 w-8 md:h-9 md:w-9" strokeWidth={3.4} aria-hidden="true" />
                  ) : (
                    <Plus
                      className="h-8 w-8 md:h-[34px] md:w-[34px]"
                      strokeWidth={3.4}
                      aria-hidden="true"
                    />
                  )}
                  {today ? 'Done today' : 'I did it today'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
