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
    <div className="mx-auto max-w-[1000px]">
      <section className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-kids-area md:text-sm">
          Daily check-in
        </p>
        <h1 className="mt-3 font-orbitron text-[clamp(28px,4vw,44px)] font-black leading-tight text-kids-text md:text-[clamp(34px,4.8vw,53px)]">
          How do you feel today?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[17px] font-semibold leading-snug text-kids-body md:text-xl">
          There is no wrong answer.
        </p>
      </section>

      <div
        role="radiogroup"
        aria-label="How you feel"
        className="mt-7 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 md:mt-[30px]"
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
              className={cn(
                'kids-tile min-h-[120px] text-base md:min-h-[136px] md:text-lg',
                on && 'kids-tile-on',
              )}
            >
              <MoodFace mood={m.key} className="h-10 w-10 md:h-12 md:w-12" />
              {m.label}
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="kids-card kids-note-pop mt-6 md:mt-7">
          <p className="font-orbitron text-lg font-black text-kids-text md:text-xl">
            Want to tell more?
          </p>
          <p className="mt-1 text-[15px] font-semibold text-kids-muted md:text-lg">
            You can skip this.
          </p>
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
            className="kids-input mt-3 resize-y"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p
              role="status"
              className={cn(
                'text-[15px] font-bold md:text-lg',
                justSaved ? 'text-kids-teal' : 'text-kids-body',
              )}
            >
              {justSaved
                ? 'Saved. Thanks for telling us.'
                : `You feel ${picked.label.toLowerCase()} today.`}
            </p>
            <button
              type="button"
              onClick={() => void save()}
              disabled={sending}
              className="kids-btn kids-btn-deep h-11 px-6 text-sm md:h-12 md:text-base"
            >
              {sending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-center gap-2.5">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-[22px] w-[22px] stroke-kids-transform"
        >
          <path d={FLAME_PATH} />
        </svg>
        <p className="font-orbitron text-base font-black text-kids-streak md:text-lg">
          {streakLine(streak)}
        </p>
      </div>
    </div>
  );
}
