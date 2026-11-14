import { useState } from 'react';
import type { KidPowers } from '@/api/discover';
import type { KidActivity, KidEvent } from '@/api/kids';
import { getInitials } from '@/lib/avatarUtils';
import { POWER_SLOTS, powerSize } from '@/lib/kidsPowers';
import { cn } from '@/lib/utils';
import { POWER_ICONS } from '@/components/kids/icons';
import GameDialog from '@/components/kids/GameDialog';
import Confetti from '@/components/kids/Confetti';

interface DiscoverPowersProps {
  childName: string;
  avatarUrl?: string | null;
  powers: KidPowers;
  activity: KidActivity;
  send: (event: KidEvent) => Promise<KidActivity | null>;
}

/**
 * Discover in child view, as the prototype's (docs/child-view-build-plan.md, 2.5 and 2.6): the
 * gold eyebrow, "You are The <style>" and its line, then the child's photo with their name in
 * the middle of their seven powers. A power opens its mini game (and is opened for good, +1
 * star the first time; all seven earn the badge, +3, which opens Grow in child view). The
 * server gives every star.
 */
export default function DiscoverPowers({
  childName,
  avatarUrl,
  powers,
  activity,
  send,
}: DiscoverPowersProps) {
  const [playing, setPlaying] = useState<number | null>(null);
  const opened = new Set(activity.flipped_powers);
  const game = playing === null ? null : (powers.powers[playing] ?? null);
  const firstName = childName.trim().split(/\s+/)[0] ?? childName;

  const open = (i: number) => {
    setPlaying(i);
    if (!opened.has(i)) void send({ type: 'flip_power', power: i });
  };

  return (
    <div className="mx-auto max-w-[1000px]">
      <section className="kids-enter-up text-center">
        <p className="kids-eyebrow kids-enter-pop-six">
          <span className="kids-twinkle" aria-hidden="true" />
          <span className="truncate">Hey {firstName}, your superpowers are here!</span>
          <span className="kids-twinkle [animation-delay:0.5s]" aria-hidden="true" />
        </p>
        <h1 className="mt-3.5 text-balance font-orbitron text-[clamp(28px,4vw,44px)] font-bold leading-[1.08] tracking-[0.02em] text-kids-heading md:text-[clamp(34px,4.8vw,53px)]">
          You are <span className="kids-glow-word">The {powers.style}</span>
        </h1>
        {powers.style_line && (
          <p className="mx-auto mt-3 max-w-[540px] text-pretty text-[17px] font-semibold leading-snug text-kids-subtle md:text-xl">
            {powers.style_line}
          </p>
        )}
      </section>

      <div className="relative mx-auto mt-6 aspect-square w-full max-w-[560px]">
        <div className="kids-orbit-glow" />
        <div className="kids-orbit-ring inset-[14%]" />
        <div className="kids-orbit-ring kids-orbit-ring-dashed inset-[6%] motion-safe:animate-[spin_60s_linear_infinite]" />
        <div className="kids-orbit-ring kids-orbit-ring-faint inset-[24%]" />
        {POWER_SLOTS.map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={cn('kids-orbit-spoke', playing === i && 'kids-orbit-spoke-on')}
            style={{ transform: `rotate(${-90 + (i * 360) / POWER_SLOTS.length}deg)` }}
          >
            <span
              className="kids-orbit-spoke-line kids-enter-grow"
              style={{ animationDelay: `${0.6 + i * 0.22}s` }}
            />
          </div>
        ))}
        <div className="kids-photo-ring kids-enter-pop">
          <div className="kids-photo text-[clamp(32px,6.4vw,52px)]">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover object-[50%_35%]" />
            ) : (
              <span aria-hidden="true">{getInitials(childName).charAt(0)}</span>
            )}
          </div>
        </div>
        <div className="kids-name-pill kids-enter-up [animation-delay:0.5s]">{firstName}</div>
        {/* Each time Discover opens (the page mounts it anew per circle). */}
        <Confetti />
        {powers.powers.map((p, i) => {
          const slot = POWER_SLOTS[i];
          if (!slot) return null;
          const size = `${powerSize(p.level)}%`;
          return (
            <button
              key={p.game}
              type="button"
              onClick={() => open(i)}
              aria-label={`${p.name}: play its game${opened.has(i) ? '' : ' (not opened yet)'}`}
              style={{
                left: `${slot.x}%`,
                top: `${slot.y}%`,
                width: size,
                height: size,
                animationDelay: `${0.6 + i * 0.22}s`,
              }}
              className={cn(
                'kids-power kids-enter-unfold group',
                opened.has(i) && 'kids-power-open',
                playing === i && 'kids-power-on',
              )}
            >
              <span className="kids-power-face">
                <span
                  className="kids-float flex flex-col items-center gap-1"
                  style={{ animationDelay: `${i * 0.8}s` }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-[clamp(14px,2.8vw,21px)] w-[clamp(14px,2.8vw,21px)]"
                  >
                    <path d={POWER_ICONS[p.game]} />
                  </svg>
                  <span className="kids-power-label">{p.name}</span>
                </span>
              </span>
              <span className="kids-power-tip" aria-hidden="true">
                Click here to enjoy the game
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-center">
        <p className="kids-count-pill kids-enter-pop-six [animation-delay:2.4s]">
          {powers.powers.length} superpowers unlocked
        </p>
      </div>

      {game && (
        <GameDialog
          power={game}
          best={activity.best_times[game.game]}
          onClose={() => setPlaying(null)}
          onFinish={(seconds) => void send({ type: 'game_best', game: game.game, seconds })}
        />
      )}
    </div>
  );
}
