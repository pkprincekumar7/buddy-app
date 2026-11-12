import { useState } from 'react';
import { ArrowLeft, Check, Play } from 'lucide-react';
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
import { POWER_COLORS, tileVars } from '@/components/kids/palette';
import GrowGame from '@/components/kids/GrowGames';

const worldColor = (i: number) => POWER_COLORS[i % POWER_COLORS.length] ?? 'discover';

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

  const back = () => {
    setWorld(null);
    setStep(0);
    setPhase('intro');
    setResults([]);
    setReport(null);
  };
  const start = (w: number) => {
    back();
    setWorld(w);
  };

  if (world === null) {
    return (
      <div className="mx-auto max-w-4xl">
        <section className="text-center">
          <p className="text-base font-bold uppercase tracking-[0.3em] text-kids-area">Grow</p>
          <h1 className="mt-3 font-orbitron text-4xl font-black leading-tight text-kids-text md:text-5xl">
            Pick a <span className="text-kids-area">world</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-2xl font-semibold leading-snug text-kids-body">
            Play three quick games right here.
          </p>
        </section>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {worlds.worlds.map((w, i) => {
            const runs = runsOf(worlds, i);
            const last = runs[runs.length - 1];
            return (
              <button
                key={w.name}
                type="button"
                onClick={() => start(i)}
                style={tileVars(worldColor(i))}
                className="kids-tile relative min-h-[170px] px-3 text-lg"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-12 w-12 text-kids-tile"
                >
                  <path d={w.icon} />
                </svg>
                <span className="text-center">{w.name}</span>
                <span className="font-rajdhani text-base font-bold text-kids-muted">
                  {last ? `Last: ${last.total}` : '3 games'}
                </span>
                {last && (
                  <Check
                    className="absolute right-3 top-3 h-6 w-6 text-kids-teal"
                    aria-label="Played"
                  />
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
      <div className="mx-auto max-w-3xl" style={tileVars(worldColor(world))}>
        <section className="text-center">
          <p className="text-base font-bold uppercase tracking-[0.3em] text-kids-area">
            {W.name} report
          </p>
          <h1 className="mt-3 font-orbitron text-4xl font-black leading-tight text-kids-text md:text-5xl">
            World <span className="text-kids-area">complete!</span>
          </h1>
        </section>
        <div className="kids-card mt-7 text-center" role="status">
          <p className="font-orbitron text-6xl font-black text-kids-streak">{report.total}</p>
          {band && (
            <p
              className="mt-2 font-orbitron text-xl font-black"
              style={tileVars(BAND_COLOR[band.color])}
            >
              <span className="text-kids-tile">{band.label}</span>
            </p>
          )}
          <p className="mt-2 text-lg font-bold text-kids-body">
            {trendLine(report.total, report.previous)}
          </p>
        </div>
        <ul className="mt-6 grid gap-3">
          {W.games.map((g, j) => {
            const r = results[j];
            const b = bandFor(r?.score ?? 0, worlds.bands);
            return (
              <li
                key={g.title}
                className="kids-card"
                style={tileVars(b ? BAND_COLOR[b.color] : 'discover')}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-orbitron text-lg font-black text-kids-text">{g.title}</p>
                  <p className="font-orbitron text-2xl font-black text-kids-tile">
                    {r?.score ?? 0}
                  </p>
                </div>
                <p className="mt-1 text-base font-semibold text-kids-muted">{r?.line}</p>
                <div className="kids-score-bar mt-3" aria-hidden="true">
                  <div className="kids-score-bar-fill" style={{ width: `${r?.score ?? 0}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="kids-card" style={tileVars('transform')}>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-kids-muted">
              Strongest
            </p>
            <p className="mt-1 font-orbitron text-xl font-black text-kids-text">
              {strongest?.skill}
            </p>
          </div>
          <div className="kids-card" style={tileVars('release')}>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-kids-muted">
              Keep practising
            </p>
            <p className="mt-1 font-orbitron text-xl font-black text-kids-text">{weakest?.skill}</p>
            <p className="mt-1 text-base font-semibold text-kids-body">{weakest?.tip}</p>
          </div>
        </div>
        <div className="kids-card mt-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-kids-muted">
            Your mission
          </p>
          <p className="mt-1 text-xl font-bold text-kids-text">{W.mission}</p>
          <p className="mt-1 text-base font-semibold text-kids-body">{W.hint}</p>
        </div>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => start(world)} className="kids-btn h-14 px-8 text-lg">
            Play again
          </button>
          <button type="button" onClick={back} className="kids-btn-off h-14 px-8 text-lg">
            Pick another world
          </button>
        </div>
      </div>
    );
  }

  const G = W.games[step];
  if (!G) return null;
  const result = results[step];
  const resultBand = result ? bandFor(result.score, worlds.bands) : null;

  const finishWorld = async () => {
    const runs = runsOf(worlds, world);
    const previous = runs[runs.length - 1]?.total ?? null;
    const scores = results.map((r) => r.score);
    const saved = await addRun(world, scores);
    if (saved) awaitProgress((activity) => activity.circles_done.grow);
    const mine = saved ? runsOf(saved, world) : [];
    setReport({
      total: mine[mine.length - 1]?.total ?? Math.round(scores.reduce((a, b) => a + b, 0) / 3),
      previous,
    });
  };

  return (
    <div className="mx-auto max-w-3xl" style={tileVars(worldColor(world))}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={back}
          aria-label="Back to worlds"
          className="kids-btn-off flex h-11 w-11 items-center justify-center"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex gap-2" aria-label={`Game ${step + 1} of 3`} role="img">
          {[0, 1, 2].map((j) => (
            <span
              key={j}
              className={cn(
                'h-3 w-10 rounded-full',
                j < step ? 'bg-kids-streak' : j === step ? 'bg-kids-discover' : 'bg-kids-off',
              )}
            />
          ))}
        </div>
      </div>
      <p className="mt-6 text-sm font-bold uppercase tracking-[0.25em] text-kids-area">
        {W.name} · Game {step + 1} of 3
      </p>
      <h1 className="mt-2 font-orbitron text-3xl font-black text-kids-text md:text-4xl">
        {G.title}
      </h1>
      <p className="mt-3 text-xl font-semibold text-kids-body">{G.how}</p>

      {phase === 'intro' && (
        <div className="kids-card mt-6 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-kids-muted">{G.skill}</p>
          <button
            type="button"
            onClick={() => {
              setRound((r) => r + 1);
              setPhase('play');
            }}
            className="kids-btn mt-4 inline-flex h-16 items-center gap-2 px-10 text-xl"
          >
            <Play className="h-6 w-6" aria-hidden="true" /> Play
          </button>
        </div>
      )}
      {phase === 'play' && (
        <div className="mt-6">
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
        <div className="kids-card mt-6 text-center" role="status">
          <p className="font-orbitron text-2xl font-black text-kids-text">Well done!</p>
          <p className="mt-2 font-orbitron text-5xl font-black text-kids-streak">{result.score}</p>
          {resultBand && (
            <p
              className="mt-1 font-orbitron text-lg font-black"
              style={tileVars(BAND_COLOR[resultBand.color])}
            >
              <span className="text-kids-tile">{resultBand.label}</span>
            </p>
          )}
          <p className="mt-2 text-lg font-semibold text-kids-body">{result.line}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {step < 2 ? (
              <button
                type="button"
                onClick={() => {
                  setStep(step + 1);
                  setPhase('intro');
                }}
                className="kids-btn h-14 px-8 text-lg"
              >
                Next game
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void finishWorld()}
                className="kids-btn h-14 px-8 text-lg"
              >
                {saving ? 'Saving…' : 'Finish world'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRound((r) => r + 1);
                setPhase('play');
              }}
              className="kids-btn-off h-14 px-8 text-lg"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
