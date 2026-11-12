import { useState } from 'react';
import { Check } from 'lucide-react';
import type { KidActivity, KidEvent } from '@/api/kids';
import { getInitials } from '@/lib/avatarUtils';
import type { Win } from '@/lib/kidsWins';
import { cn } from '@/lib/utils';
import { STAR_PATH } from '@/components/kids/icons';
import { POWER_COLORS, tileVars } from '@/components/kids/palette';

const winColor = (i: number) => POWER_COLORS[i % POWER_COLORS.length] ?? 'connect';

interface ConnectWinsProps {
  wins: Win[];
  childName: string;
  avatarUrl?: string | null;
  activity: KidActivity;
  sending: boolean;
  send: (event: KidEvent) => Promise<KidActivity | null>;
}

/**
 * Connect in child view (docs/child-view-build-plan.md, 4.1): the child's own wins and a card
 * for the one picked. Per P.2 nothing is shared from here: "Show my grown-up" keeps the win,
 * and the parent shares it from their Connect page.
 */
export default function ConnectWins({
  wins,
  childName,
  avatarUrl,
  activity,
  sending,
  send,
}: ConnectWinsProps) {
  const [picked, setPicked] = useState(0);
  const win = wins[Math.min(picked, wins.length - 1)];
  const firstName = childName.trim().split(/\s+/)[0] ?? childName;
  const shown = win ? Boolean(activity.shown?.[win.key]) : false;

  return (
    <div className="mx-auto max-w-4xl">
      <section className="text-center">
        <p className="text-base font-bold uppercase tracking-[0.3em] text-kids-area">Connect</p>
        <h1 className="mt-3 font-orbitron text-4xl font-black leading-tight text-kids-text md:text-5xl">
          Your wins
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-2xl font-semibold leading-snug text-kids-body">
          Pick a win. Show it to your grown-up.
        </p>
      </section>

      {!win ? (
        <div className="kids-card mx-auto mt-8 max-w-xl text-center">
          <p className="font-orbitron text-2xl font-black text-kids-text">No wins yet</p>
          <p className="mt-2 text-xl font-semibold text-kids-body">
            Open your powers, finish a quest or play a world. Your wins show up here.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-[1fr_1.1fr]">
          <div role="radiogroup" aria-label="Your wins" className="grid content-start gap-3">
            {wins.map((w, i) => (
              <button
                key={w.key}
                type="button"
                role="radio"
                aria-checked={i === picked}
                onClick={() => setPicked(i)}
                style={tileVars(winColor(i))}
                className={cn(
                  'kids-tile flex-row justify-start gap-3 px-5 py-4 text-left text-base',
                  i === picked && 'kids-tile-on',
                )}
              >
                <span className="h-3 w-3 shrink-0 rounded-full bg-kids-tile" aria-hidden="true" />
                <span className="flex-1">{w.title}</span>
                {activity.shown?.[w.key] && (
                  <Check className="h-5 w-5 text-kids-teal" aria-label="Shown" />
                )}
              </button>
            ))}
          </div>

          <div>
            <div className="kids-card text-center" aria-live="polite">
              <p className="flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-[0.3em] text-kids-muted">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-kids-streak">
                  <path d={STAR_PATH} />
                </svg>
                Superpower
              </p>
              <p className="mt-5 font-orbitron text-3xl font-black leading-tight text-kids-text">
                {win.title}
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <span className="kids-avatar h-14 w-14 text-2xl">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span aria-hidden="true">{getInitials(childName).charAt(0)}</span>
                  )}
                </span>
                <span className="text-xl font-bold text-kids-body">{firstName}</span>
              </div>
            </div>
            <button
              type="button"
              disabled={sending || shown}
              onClick={() => void send({ type: 'show_win', key: win.key, title: win.title })}
              className={cn('mt-5 h-16 w-full text-lg', shown ? 'kids-btn-off' : 'kids-btn')}
            >
              {shown ? 'Your grown-up can see it' : 'Show my grown-up'}
            </button>
            <p className="mt-3 text-center text-base font-semibold text-kids-muted">
              Only your first name goes on the card.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
