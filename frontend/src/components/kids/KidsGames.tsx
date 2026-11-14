import { useEffect, useRef, useState, type ComponentType, type PointerEvent } from 'react';
import { useWinOnce } from '@/hooks/useWinOnce';
import {
  CLIMB_TICK_MS,
  CURIOUS_BOXES,
  CURIOUS_GOAL,
  DRAW_GOAL,
  DRAW_START,
  ENERGY_GOAL,
  ENERGY_TICK_MS,
  FOCUS_GOAL,
  FOCUS_MOVE_MS,
  ORDER_STARS,
  VOICE_TICK_MS,
  climbSlide,
  climbSpot,
  climbTap,
  drawLift,
  drawTo,
  energyTick,
  focusSpot,
  hidePlanets,
  orderTap,
  planetsFound,
  polyline,
  progress,
  voiceStep,
  type Bubble,
  type DrawState,
  type GameKey,
} from '@/lib/kidsGames';
import { cn } from '@/lib/utils';
import { POWER_ICONS } from '@/components/kids/icons';
import { Bar, Sky, Bursts } from '@/components/kids/GamePieces';
import { addBurst, type Burst } from '@/lib/kidsBursts';
import { tileColor } from '@/components/kids/palette';

/**
 * The seven games' views (docs/child-view-build-plan.md, 2.6). The rules are lib/kidsGames;
 * every colour is a --kids-* token (the .kids-game-* classes, or tileColor for SVG).
 */
export interface GameProps {
  onWin: () => void;
}

/** Where a pointer is in the box, in percent. */
function pointIn(e: PointerEvent<HTMLElement>, box: HTMLElement) {
  const r = box.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
}

// ── the games ──────────────────────────────────────────────────────────────────

function FocusGame({ onWin }: GameProps) {
  const [caught, setCaught] = useState(0);
  const [spot, setSpot] = useState({ x: 50, y: 55 });
  const [bursts, setBursts] = useState<Burst[]>([]);
  useEffect(() => {
    const id = setInterval(() => setSpot(focusSpot()), FOCUS_MOVE_MS);
    return () => clearInterval(id);
  }, []);
  useWinOnce(caught >= FOCUS_GOAL, onWin);
  const catchIt = () => {
    if (caught >= FOCUS_GOAL) return;
    setBursts((b) => addBurst(b, spot.x, spot.y));
    setCaught((n) => n + 1);
    setSpot(focusSpot());
  };
  return (
    <div className="kids-game">
      <Sky />
      <Bar value={progress(caught, FOCUS_GOAL)} />
      <Bursts list={bursts} />
      <button
        type="button"
        aria-label="The light"
        onPointerDown={catchIt}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && catchIt()}
        className="kids-game-orb h-[17%] w-[17%] transition-[left,top] duration-1000 ease-in-out motion-reduce:transition-none"
        style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
      />
      <p className="kids-game-caption" aria-live="polite">
        {caught} / {FOCUS_GOAL}
      </p>
    </div>
  );
}

function CuriousGame({ onWin }: GameProps) {
  const [planets] = useState(() => hidePlanets());
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const found = planetsFound(planets, opened);
  useWinOnce(found >= CURIOUS_GOAL, onWin);
  return (
    <div className="kids-game grid grid-cols-3 grid-rows-3 gap-[4%] px-[7%] pb-[7%] pt-[14%]">
      <Bar value={progress(found, CURIOUS_GOAL)} />
      {Array.from({ length: CURIOUS_BOXES }, (_, i) => {
        const open = opened.has(i);
        const planet = planets.includes(i);
        return (
          <button
            key={i}
            type="button"
            aria-label={open ? (planet ? 'A planet!' : 'Empty') : `Box ${i + 1}`}
            disabled={open}
            onPointerDown={() => !open && setOpened(new Set(opened).add(i))}
            onKeyDown={(e) =>
              (e.key === 'Enter' || e.key === ' ') && setOpened(new Set(opened).add(i))
            }
            className={cn(
              'kids-game-box',
              open && 'kids-game-box-open',
              open && planet && 'kids-game-box-found',
            )}
          >
            {!open ? (
              '?'
            ) : planet ? (
              <svg viewBox="0 0 40 40" aria-hidden="true" className="h-[62%] w-[62%]">
                <ellipse
                  cx="20"
                  cy="20"
                  rx="18"
                  ry="6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  transform="rotate(-20 20 20)"
                  className="text-kids-streak"
                />
                <circle cx="20" cy="20" r="10" className="fill-kids-streak" />
              </svg>
            ) : (
              <span className="h-2 w-2 rounded-full bg-kids-off" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function OrderGame({ onWin }: GameProps) {
  const [done, setDone] = useState(0);
  const [wrong, setWrong] = useState(-1);
  useWinOnce(done >= ORDER_STARS.length, onWin);
  useEffect(() => {
    if (wrong < 0) return;
    const id = setTimeout(() => setWrong(-1), 400);
    return () => clearTimeout(id);
  }, [wrong]);
  const tap = (i: number) => {
    const next = orderTap(done, i);
    setDone(next.done);
    if (next.wrong) setWrong(i);
  };
  return (
    <div className="kids-game">
      <Sky />
      <Bar value={progress(done, ORDER_STARS.length)} />
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <polyline
          points={polyline(ORDER_STARS.slice(0, done))}
          fill="none"
          stroke={tileColor('discover')}
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {ORDER_STARS.map((s, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Star ${i + 1}`}
          onPointerDown={() => tap(i)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && tap(i)}
          className={cn(
            'kids-game-node h-[14%] w-[14%]',
            i === done && 'kids-game-node-next',
            i < done && 'kids-game-node-done',
            i === wrong && 'kids-game-node-wrong',
          )}
          style={{ left: `${s.x}%`, top: `${s.y}%` }}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

function DrawGame({ onWin }: GameProps) {
  const box = useRef<HTMLDivElement>(null);
  const down = useRef(false);
  const [state, setState] = useState<DrawState>(DRAW_START);
  useWinOnce(state.length >= DRAW_GOAL, onWin);
  const move = (e: PointerEvent<HTMLDivElement>, stroke: boolean) => {
    if (!down.current || !box.current) return;
    const p = pointIn(e, box.current);
    setState((s) => drawTo(s, p, stroke));
  };
  const lift = () => {
    down.current = false;
    setState(drawLift);
  };
  const line = polyline(state.points);
  return (
    <div
      ref={box}
      role="img"
      aria-label="Draw here"
      className="kids-game cursor-crosshair"
      onPointerDown={(e) => {
        down.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e, false);
      }}
      onPointerMove={(e) => move(e, true)}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      <Sky />
      <Bar value={progress(state.length, DRAW_GOAL)} />
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <polyline
          points={line}
          fill="none"
          stroke={tileColor('transform')}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={line}
          fill="none"
          className="stroke-kids-text"
          strokeWidth="0.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {state.points.length === 0 && (
        <p className="kids-game-caption bottom-auto top-1/2">Draw here</p>
      )}
    </div>
  );
}

function ClimbGame({ onWin }: GameProps) {
  const [height, setHeight] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  useEffect(() => {
    const id = setInterval(() => setHeight(climbSlide), CLIMB_TICK_MS);
    return () => clearInterval(id);
  }, []);
  useWinOnce(height >= 100, onWin);
  const spot = climbSpot(height);
  const tap = () => {
    if (height >= 100) return;
    setHeight(climbTap);
    setBursts((b) => addBurst(b, spot.x, spot.y));
  };
  return (
    <button
      type="button"
      aria-label="Climb"
      onPointerDown={tap}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && tap()}
      className="kids-game block"
    >
      <Sky />
      <Bar value={progress(height, 100)} />
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <polygon
          points="0,100 50,18 100,100"
          className="fill-kids-discover-shade/55 stroke-kids-discover/50"
          strokeWidth="0.6"
        />
        <polygon points="42,31 50,18 58,31 54,28 50,32 46,28" className="fill-kids-text/80" />
        <line
          x1="14"
          y1="86"
          x2="50"
          y2="20"
          className="stroke-kids-streak/35"
          strokeWidth="0.6"
          strokeDasharray="2 2"
        />
        <line x1="50" y1="18" x2="50" y2="6" className="stroke-kids-streak" strokeWidth="0.8" />
        <polygon points="50,6 60,9 50,12" className="fill-kids-streak" />
      </svg>
      <Bursts list={bursts} />
      <span
        aria-hidden="true"
        className="kids-game-orb pointer-events-none h-[11%] w-[11%] transition-[left,top] duration-100 ease-linear"
        style={{ left: `${spot.x}%`, top: `${spot.y}%`, transform: 'translate(-50%, -80%)' }}
      />
      <span className="kids-game-caption">{height >= 100 ? 'Top!' : 'Tap tap tap!'}</span>
    </button>
  );
}

function VoiceGame({ onWin }: GameProps) {
  const holding = useRef(false);
  const [level, setLevel] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setLevel((v) => voiceStep(v, holding.current));
    }, VOICE_TICK_MS);
    return () => clearInterval(id);
  }, []);
  useWinOnce(level >= 100, onWin);
  const s = level / 100;
  const hold = (on: boolean) => {
    holding.current = on;
  };
  return (
    <button
      type="button"
      aria-label="Press and hold"
      onPointerDown={(e) => {
        hold(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={() => hold(false)}
      onPointerCancel={() => hold(false)}
      onKeyDown={(e) => e.key === ' ' && hold(true)}
      onKeyUp={(e) => e.key === ' ' && hold(false)}
      onContextMenu={(e) => e.preventDefault()}
      className="kids-game block"
    >
      <Bar value={s} />
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="kids-game-ring"
          style={{
            width: `${30 + s * 60 + i * 12}%`,
            height: `${30 + s * 60 + i * 12}%`,
            opacity: 1 - i * 0.28,
          }}
        />
      ))}
      <span
        aria-hidden="true"
        className="kids-game-orb pointer-events-none left-1/2 top-1/2 flex h-[26%] w-[26%] items-center justify-center"
        style={{ transform: `translate(-50%, -50%) scale(${1 + s * 0.25})` }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="h-1/2 w-1/2 stroke-kids-ink"
        >
          <path d={POWER_ICONS.voice} />
        </svg>
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[14%] left-1/2 flex h-[12%] -translate-x-1/2 items-end gap-1"
      >
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className="kids-game-wave"
            style={{
              height: `${10 + s * 90 * (0.4 + 0.6 * Math.abs(Math.sin(tick * 0.3 + i)))}%`,
            }}
          />
        ))}
      </span>
      <span className="kids-game-caption bottom-[4%]">
        {level >= 100 ? 'So loud!' : 'Press and hold'}
      </span>
    </button>
  );
}

function EnergyGame({ onWin }: GameProps) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [popped, setPopped] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const nextId = useRef(1);
  useEffect(() => {
    const id = setInterval(() => {
      setBubbles((list) => {
        const next = energyTick(list, nextId.current);
        nextId.current = next.nextId;
        return next.bubbles;
      });
    }, ENERGY_TICK_MS);
    return () => clearInterval(id);
  }, []);
  useWinOnce(popped >= ENERGY_GOAL, onWin);
  const pop = (b: Bubble) => {
    setBubbles((list) => list.filter((x) => x.id !== b.id));
    setBursts((list) => addBurst(list, b.x, b.y));
    setPopped((n) => n + 1);
  };
  return (
    <div className="kids-game">
      <Sky />
      <Bar value={progress(popped, ENERGY_GOAL)} />
      <Bursts list={bursts} />
      {bubbles.map((b) => (
        <button
          key={b.id}
          type="button"
          aria-label="A bubble"
          onPointerDown={() => pop(b)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && pop(b)}
          className="kids-game-bubble"
          style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.size}%`, height: `${b.size}%` }}
        />
      ))}
      <p className="kids-game-caption" aria-live="polite">
        {Math.min(popped, ENERGY_GOAL)} / {ENERGY_GOAL}
      </p>
    </div>
  );
}

const GAMES: Record<GameKey, ComponentType<GameProps>> = {
  focus: FocusGame,
  curious: CuriousGame,
  order: OrderGame,
  draw: DrawGame,
  climb: ClimbGame,
  voice: VoiceGame,
  energy: EnergyGame,
};

/** A power's game, by its `game`. */
export default function KidsGame({ game, onWin }: GameProps & { game: GameKey }) {
  const Game = GAMES[game];
  return <Game onWin={onWin} />;
}
