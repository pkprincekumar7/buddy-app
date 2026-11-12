import { useState } from 'react';
import type { KidActivity, KidEvent, KidMoodKey } from '@/api/kids';
import { moodStreak } from '@/lib/kidsDay';
import { MOODS, streakLine } from '@/lib/kidsMoods';
import { cn } from '@/lib/utils';
import { FLAME_PATH } from '@/components/kids/icons';
import { tileVars } from '@/components/kids/palette';
import MoodFace from '@/components/kids/MoodFace';

const NOTE_MAX = 500;

interface ReleaseCheckInProps {
  activity: KidActivity;
  day: string;
  sending: boolean;
  send: (event: KidEvent) => Promise<KidActivity | null>;
}

/**
 * Release's daily check-in (docs/child-view-build-plan.md, 2.3): five moods, an optional
 * note, and the streak. Saving again the same day replaces that day's mood.
 */
export default function ReleaseCheckIn({ activity, day, sending, send }: ReleaseCheckInProps) {
  const saved = activity.moods[day];
  const [mood, setMood] = useState<KidMoodKey | null>(
    MOODS.find((m) => m.key === saved?.mood)?.key ?? null,
  );
  const [note, setNote] = useState(saved?.note ?? '');
  const [justSaved, setJustSaved] = useState(false);
  const picked = MOODS.find((m) => m.key === mood);
  const streak = moodStreak(activity.moods, day);

  const save = async () => {
    if (!mood) return;
    const trimmed = note.trim();
    const done = await send({ type: 'mood', mood, ...(trimmed && { note: trimmed }) });
    if (done) setJustSaved(true);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <section className="text-center">
        <p className="text-base font-bold uppercase tracking-[0.3em] text-kids-area">
          Daily check-in
        </p>
        <h1 className="mt-3 font-orbitron text-4xl font-black leading-tight text-kids-text md:text-5xl">
          How do you feel today?
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-2xl font-semibold leading-snug text-kids-body">
          There is no wrong answer.
        </p>
      </section>

      <div
        role="radiogroup"
        aria-label="How you feel"
        className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
      >
        {MOODS.map((m) => {
          const on = m.key === mood;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setMood(m.key);
                setJustSaved(false);
              }}
              style={tileVars(m.color)}
              className={cn('kids-tile min-h-[170px] text-lg', on && 'kids-tile-on')}
            >
              <MoodFace mood={m.key} className="h-16 w-16" />
              {m.label}
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="kids-card mt-7">
          <p className="font-orbitron text-2xl font-black text-kids-text">Want to tell more?</p>
          <p className="mt-1 text-lg font-semibold text-kids-muted">You can skip this.</p>
          <label htmlFor="kids-mood-note" className="sr-only">
            What happened today?
          </label>
          <textarea
            id="kids-mood-note"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => {
              setNote(e.target.value);
              setJustSaved(false);
            }}
            rows={3}
            placeholder="What happened today?"
            className="kids-input mt-4 resize-y"
          />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <p
              role="status"
              className={cn('text-xl font-bold', justSaved ? 'text-kids-teal' : 'text-kids-body')}
            >
              {justSaved
                ? 'Saved. Thanks for telling us.'
                : `You feel ${picked.label.toLowerCase()} today.`}
            </p>
            <button
              type="button"
              onClick={() => void save()}
              disabled={sending}
              className="kids-btn h-16 px-10 text-lg"
            >
              {sending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-7 flex items-center justify-center gap-3">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-7 w-7 stroke-kids-transform"
        >
          <path d={FLAME_PATH} />
        </svg>
        <p className="font-orbitron text-xl font-black text-kids-streak">{streakLine(streak)}</p>
      </div>
    </div>
  );
}
