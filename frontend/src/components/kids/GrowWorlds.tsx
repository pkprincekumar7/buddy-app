import { useState } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import {
  BAND_COLOR,
  bandFor,
  rankedGames,
  runsOf,
  trendLine,
  type KidWorlds,
} from '@/api/kidWorlds';
import type { KidActivity } from '@/api/kids';
import type { GrowResult } from '@/lib/kidsGrow';
import { cn } from '@/lib/utils';
import { KIDS_COLORS, tileVars } from '@/components/kids/palette';
import GrowGame from '@/components/kids/GrowGames';
import Confetti from '@/components/kids/Confetti';

const worldColor = (i: number) => KIDS_COLORS[i % KIDS_COLORS.length] ?? 'discover';

/** The world cards' orbs, as the prototype's: cyan, gold and sky, in turn. */
const WORLD_ORBS = ['kids-world-orb-cyan', 'kids-world-orb-gold', 'kids-world-orb-sky'] as const;

interface GrowWorldsProps {
  worlds: KidWorlds;
  saving: boolean;
  addRun: (world: number, scores: number[]) => Promise<KidWorlds | null>;
  /** Waits for the run's progress: grow tells children (grow.world_played), which opens
   *  Transform in child view a moment later. */
  awaitProgress: (done: (activity: KidActivity) => boolean) => void;
}

type Phase = 'intro' | 'play' | 'result';

/**
 * Grow in child view (docs/child-view-build-plan.md, 3.5): pick a world, play its three games
 * (each with an intro, the game, and its score and band), then the world's report: the total,
 * each game, the strongest and the one to practise, the world's mission, and how it compares
 * with last time. The finished world is saved as a run (grow keeps the last 10).
 */
export default function GrowWorlds({ worlds, saving, addRun, awaitProgress }: GrowWorldsProps) {
  const [world, setWorld] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<GrowResult[]>([]);
  const [report, setReport] = useState<{ total: number; previous: number | null } | null>(null);
  // The finished world didn't save: the child stays on the last game to try again, so the
  // report only ever shows a total that was kept.
  const [saveFailed, setSaveFailed] = useState(false);

  const back = () => {
    setWorld(null);
    setStep(0);
    setPhase('intro');
    setResults([]);
    setReport(null);
    setSaveFailed(false);
  };
  const start = (w: number) => {
    back();
    setWorld(w);
  };

  if (world === null) {
    return (
      <div className="mx-auto max-w-5xl">
        <section className="kids-enter-up text-center">
          <p className="kids-pill-eyebrow kids-enter-pop">Grow</p>
          <h1 className="mt-4 font-orbitron text-[clamp(28px,4vw,44px)] font-bold leading-[1.08] tracking-[0.02em] text-kids-heading md:text-[clamp(34px,4.8vw,53px)]">
            Pick a <span className="kids-glow-word">world</span>
          </h1>
          <p className="mx-auto mt-3 max-w-[520px] text-pretty text-[17px] font-semibold leading-snug text-kids-subtle md:text-xl">
            Play three quick games right here.
          </p>
        </section>
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] sm:gap-5 md:mt-[34px]">
          {worlds.worlds.map((w, i) => {
            const runs = runsOf(worlds, i);
            const last = runs[runs.length - 1];
            return (
              <button
                key={w.name}
                type="button"
                onClick={() => start(i)}
                className="kids-world kids-enter-unfold-y"
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <div
                  className="relative h-[88px] w-[88px] motion-safe:animate-[kids-float_4s_ease-in-out_infinite] md:h-[104px] md:w-[104px]"
                  style={{ animationDelay: `${i * 0.5}s` }}
                >
                  <div className="kids-world-ring motion-safe:animate-[spin_18s_linear_infinite]" />
                  <div className={cn('kids-world-orb', WORLD_ORBS[i % WORLD_ORBS.length])}>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="h-[38px] w-[38px] md:h-[46px] md:w-[46px]"
                    >
                      <path d={w.icon} />
                    </svg>
                  </div>
                  {last && (
                    <span className="kids-world-done kids-enter-pop" aria-hidden="true">
                      <Check className="h-3.5 w-3.5 md:h-4 md:w-4" strokeWidth={3.2} />
                    </span>
                  )}
                </div>
                <span className="kids-world-name">{w.name}</span>
                {last ? (
                  <span className="flex flex-col items-center gap-1">
                    <span className="kids-world-tag kids-world-tag-done">Completed</span>
                    <span className="font-rajdhani text-sm font-bold text-kids-muted md:text-base">
                      Last: {last.total}
                    </span>
                  </span>
                ) : (
                  <span className="kids-world-tag">3 games</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const W = worlds.worlds[world];
  if (!W) return null;

  if (report) {
    const order = rankedGames(results.map((r) => r.score));
    const strongest = W.games[order[0] ?? 0];
    const weakest = W.games[order[order.length - 1] ?? 0];
    const band = bandFor(report.total, worlds.bands);
    return (
      <div className="kids-enter-pop-quick mx-auto max-w-3xl" style={tileVars(worldColor(world))}>
        <section className="text-center">
          <p className="kids-pill-eyebrow kids-pill-gold kids-enter-pop">{W.name} report</p>
          <h1 className="mt-4 font-orbitron text-[clamp(28px,4vw,44px)] font-bold leading-[1.08] text-kids-heading md:text-[clamp(34px,4.8vw,53px)]">
            World <span className="kids-gold-glow">complete!</span>
          </h1>
          <div className="relative mx-auto mt-6 h-32 w-32 md:mt-[26px] md:h-[150px] md:w-[150px]">
            <div
              className={cn(
                'kids-world-orb kids-report-orb motion-safe:animate-[kids-float_3.4s_ease-in-out_infinite]',
                WORLD_ORBS[world % WORLD_ORBS.length],
              )}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="h-14 w-14 md:h-16 md:w-16"
              >
                <path d={W.icon} />
              </svg>
            </div>
            {/* The world is done: confetti over its orb (the prototype's). */}
            <Confetti />
          </div>
        </section>
        <div className="kids-report-card mt-5 text-center" role="status">
          <p className="font-orbitron text-5xl font-black text-kids-streak">{report.total}</p>
          {band && (
            <p
              className="mt-2 font-orbitron text-lg font-black md:text-xl"
              style={tileVars(BAND_COLOR[band.color])}
            >
              <span className="text-kids-tile">{band.label}</span>
            </p>
          )}
          <p className="mt-2 text-[15px] font-bold text-kids-body md:text-lg">
            {trendLine(report.total, report.previous)}
          </p>
        </div>
        <ul className="mt-5 grid gap-3">
          {W.games.map((g, j) => {
            const r = results[j];
            const b = bandFor(r?.score ?? 0, worlds.bands);
            return (
              <li
                key={g.title}
                className="kids-report-card"
                style={tileVars(b ? BAND_COLOR[b.color] : 'discover')}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-orbitron text-base font-black text-kids-text md:text-lg">
                    {g.title}
                  </p>
                  <p className="font-orbitron text-xl font-black text-kids-tile md:text-2xl">
                    {r?.score ?? 0}
                  </p>
                </div>
                <p className="mt-1 text-[15px] font-semibold text-kids-muted md:text-lg">
                  {r?.line}
                </p>
                <div className="kids-score-bar mt-3" aria-hidden="true">
                  <div className="kids-score-bar-fill" style={{ width: `${r?.score ?? 0}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="kids-report-card">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-kids-muted md:text-[13px]">
              Strongest
            </p>
            <p className="mt-1 font-orbitron text-base font-black text-kids-text md:text-lg">
              {strongest?.skill}
            </p>
          </div>
          <div className="kids-report-card">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-kids-muted md:text-[13px]">
              Keep practising
            </p>
            <p className="mt-1 font-orbitron text-base font-black text-kids-text md:text-lg">
              {weakest?.skill}
            </p>
            <p className="mt-1 text-[15px] font-semibold text-kids-body md:text-lg">
              {weakest?.tip}
            </p>
          </div>
        </div>
        <div className="kids-report-card mt-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-kids-muted md:text-[13px]">
            Your mission
          </p>
          <p className="mt-1 text-base font-bold text-kids-text md:text-lg">{W.mission}</p>
          <p className="mt-1 text-[15px] font-semibold text-kids-body md:text-lg">{W.hint}</p>
        </div>
        <div className="mt-7 flex flex-col items-center gap-4 md:mt-[30px]">
          <button
            type="button"
            onClick={() => start(world)}
            className="kids-btn-line h-11 px-6 text-sm md:h-12 md:text-base"
          >
            Play again
          </button>
          <button type="button" onClick={back} className="kids-text-link">
            Pick another world
          </button>
        </div>
      </div>
    );
  }

  const G = W.games[step];
  if (!G) return null;
  const result = results[step];
  const playedBefore = runsOf(worlds, world).length > 0;
  const resultBand = result ? bandFor(result.score, worlds.bands) : null;

  const finishWorld = async () => {
    const runs = runsOf(worlds, world);
    const previous = runs[runs.length - 1]?.total ?? null;
    const scores = results.map((r) => r.score);
    setSaveFailed(false);
    const saved = await addRun(world, scores);
    const run = saved ? runsOf(saved, world).at(-1) : undefined;
    if (!run) {
      setSaveFailed(true);
      return;
    }
    awaitProgress((activity) => activity.circles_done.grow);
    setReport({ total: run.total, previous });
  };

  return (
    <div
      key={`${world}-${step}`}
      className="kids-enter-up-quick mx-auto max-w-3xl text-center"
      style={tileVars(worldColor(world))}
    >
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={back}
          aria-label="Back to worlds"
          className="kids-round-back"
        >
          <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden="true" />
        </button>
        <div className="flex gap-3" aria-label={`Game ${step + 1} of 3`} role="img">
          {[0, 1, 2].map((j) => (
            <span
              key={j}
              className={cn(
                'kids-step-dot',
                j < step && 'kids-step-dot-done',
                j === step && 'kids-step-dot-now',
              )}
            />
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2.5 md:mt-[18px]">
        <p className="kids-pill-eyebrow kids-enter-pop">{W.name}</p>
        <p className="kids-pill-eyebrow kids-pill-gold kids-enter-pop">Game {step + 1} of 3</p>
      </div>
      <h1 className="mt-3.5 text-center font-orbitron text-[26px] font-bold leading-[1.1] text-kids-heading md:text-[clamp(28px,4vw,40px)]">
        {G.title}
      </h1>
      <p className="mx-auto mt-2.5 max-w-[520px] text-pretty text-center text-[17px] font-semibold leading-snug text-kids-subtle md:text-xl">
        {G.how}
      </p>

      {phase === 'intro' && (
        <div className="kids-enter-pop-quick mt-6">
          <div className="kids-game-intro">
            <p className="kids-game-skill">{G.skill}</p>
            <button
              type="button"
              onClick={() => {
                setRound((r) => r + 1);
                setPhase('play');
              }}
              className="kids-play-orb kids-pulse"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-9 w-9 md:h-10 md:w-10">
                <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
              </svg>
              Play
            </button>
            <p className="kids-game-note">{playedBefore ? 'Played before' : 'New game'}</p>
          </div>
        </div>
      )}
      {phase === 'play' && (
        <div className="kids-enter-up-quick mt-5">
          <GrowGame
            key={round}
            type={G.type}
            cfg={G.cfg}
            onDone={(r) => {
              setResults((all) => {
                const next = [...all];
                next[step] = r;
                return next;
              });
              setPhase('result');
            }}
          />
        </div>
      )}
      {phase === 'result' && result && (
        <>
          <div className="kids-result-card kids-enter-pop-quick mt-6" role="status">
            <div className="kids-check-orb kids-enter-pop">
              <Check className="h-10 w-10 md:h-12 md:w-12" strokeWidth={3} aria-hidden="true" />
            </div>
            <p className="kids-gold-glow mt-4 font-orbitron text-[clamp(28px,5vw,40px)] font-black">
              Well done!
            </p>
            <p className="mt-2 font-orbitron text-4xl font-black text-kids-gold">{result.score}</p>
            {resultBand && (
              <p
                className="mt-1 font-orbitron text-base font-black md:text-lg"
                style={tileVars(BAND_COLOR[resultBand.color])}
              >
                <span className="text-kids-tile">{resultBand.label}</span>
              </p>
            )}
            <p className="mt-2 text-[17px] font-semibold text-kids-body md:text-xl">
              {result.line}
            </p>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-3.5 md:mt-[22px]">
            {step < 2 ? (
              <button
                type="button"
                onClick={() => {
                  setStep(step + 1);
                  setPhase('intro');
                }}
                className="kids-btn-glow h-11 px-7 text-sm md:h-12 md:text-base"
              >
                Next game
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void finishWorld()}
                className="kids-btn-glow h-11 px-7 text-sm md:h-12 md:text-base"
              >
                {saving ? 'Saving…' : 'Finish world'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRound((r) => r + 1);
                setPhase('play');
                setSaveFailed(false);
              }}
              className="kids-btn-line h-11 px-6 text-sm md:h-12 md:text-base"
            >
              Try again
            </button>
          </div>
          {saveFailed && (
            <p role="alert" className="mt-3 text-sm font-semibold text-kids-wrong md:text-base">
              That world didn&apos;t save. Tap Finish world to try again.
            </p>
          )}
        </>
      )}
    </div>
  );
}
