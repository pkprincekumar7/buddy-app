import { useEffect, useId, useRef, useState, type ComponentType, type PointerEvent } from 'react';
import type { GrowGameType } from '@/api/kidWorlds';
import { useCountdown } from '@/hooks/useCountdown';
import {
  CATCH_SECONDS,
  CATCH_TICK_MS,
  DASH_SECONDS,
  DASH_TICK_MS,
  MEMORY_GAP_MS,
  MEMORY_LIT_MS,
  MEMORY_LIVES,
  MEMORY_START,
  MEMORY_TOP,
  SORT_PAUSE_MS,
  SPARK_SECONDS,
  TIMING_GAP_MS,
  TIMING_LEAD_MS,
  beatMissed,
  catchResult,
  catchTick,
  dashResult,
  dashTick,
  growPattern,
  judgeBeat,
  memoryResult,
  reactResult,
  reactSpot,
  reactWait,
  ringSize,
  sortCards,
  sortResult,
  sparkCell,
  sparkResult,
  timingResult,
  type Beat,
  type CatchTally,
  type DashItem,
  type Falling,
  type Flying,
  type GrowResult,
  type SortItem,
} from '@/lib/kidsGrow';
import { cn } from '@/lib/utils';
import { tileColor, tileVars, type KidsPair } from '@/components/kids/palette';
import { Bar, Bursts, Hud, Sky } from '@/components/kids/GamePieces';
import { addBurst, type Burst } from '@/lib/kidsBursts';

/**
 * Grow's seven game types (docs/child-view-build-plan.md, 3.5). The rules and scoring are
 * lib/kidsGrow; each view draws its state and reports once with `onDone`. Every colour is a
 * --kids-* token (.kids-game-* classes, or tileColor for SVG strokes).
 */
interface GrowGameProps {
  cfg: Record<string, unknown>;
  onDone: (result: GrowResult) => void;
}

/** The memory pads' colours and Spark's strokes, as the prototype's (gold, not Transform's). */
const PAD_COLORS: readonly KidsPair[] = ['discover', 'gold', 'teal', 'release'];
const SPARK_INKS: readonly KidsPair[] = ['gold', 'discover', 'teal', 'release', 'connect'];

function pointIn(e: PointerEvent<HTMLElement>, box: HTMLElement) {
  const r = box.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
}

/** setTimeout that does nothing once the game is gone. */
function useLater() {
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  return (fn: () => void, ms: number) => {
    timers.current.push(
      setTimeout(() => {
        if (alive.current) fn();
      }, ms),
    );
  };
}

// ── catch ──────────────────────────────────────────────────────────────────────

function CatchGame({ cfg, onDone }: GrowGameProps) {
  const box = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [basket, setBasket] = useState(50);
  const basketRef = useRef(50);
  const [state, setState] = useState<{
    items: Falling[];
    tally: CatchTally;
    nextId: number;
    bursts: Burst[];
  }>({ items: [], tally: { caught: 0, oops: 0, missed: 0 }, nextId: 1, bursts: [] });
  const tallyRef = useRef(state.tally);
  const left = useCountdown(CATCH_SECONDS, () => {
    done.current = true;
    onDone(catchResult(tallyRef.current));
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (done.current) return;
      setState((s) => {
        const { hits, ...next } = catchTick(s.items, basketRef.current, s.tally, s.nextId, cfg);
        tallyRef.current = next.tally;
        // A gold ring for a good word caught, a red one for a bad one.
        const bursts = hits.reduce(
          (l, h) => addBurst(l, h.x, 84, h.good ? 'gold' : 'wrong'),
          s.bursts,
        );
        return { ...next, bursts };
      });
    }, CATCH_TICK_MS);
    return () => clearInterval(id);
  }, [cfg]);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!box.current) return;
    const x = Math.max(10, Math.min(90, pointIn(e, box.current).x));
    basketRef.current = x;
    setBasket(x);
  };
  const nudge = (by: number) => {
    const x = Math.max(10, Math.min(90, basketRef.current + by));
    basketRef.current = x;
    setBasket(x);
  };
  return (
    <div
      ref={box}
      role="application"
      aria-label="Move the basket with your finger, or the arrow keys"
      tabIndex={0}
      onPointerMove={move}
      onPointerDown={move}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') nudge(-8);
        if (e.key === 'ArrowRight') nudge(8);
      }}
      className="kids-game kids-game-grow cursor-ew-resize"
    >
      <Sky />
      <Bar value={left / CATCH_SECONDS} />
      <Hud left={`★ ${state.tally.caught}`} right={`${Math.ceil(left)}s`} />
      <Bursts list={state.bursts} />
      {state.items.map((o) => (
        <span
          key={o.id}
          className="kids-game-pill pointer-events-none"
          style={{ left: `${o.x}%`, top: `${o.y}%` }}
        >
          {o.label}
        </span>
      ))}
      <span className="kids-game-basket" style={{ left: `${basket}%` }} />
      {left > CATCH_SECONDS - 3 && (
        <p className="kids-game-caption bottom-auto top-1/2">Slide to move</p>
      )}
    </div>
  );
}

// ── sort ───────────────────────────────────────────────────────────────────────

function SortGame({ cfg, onDone }: GrowGameProps) {
  const [cards] = useState(() => sortCards(cfg.items as SortItem[]));
  const [i, setI] = useState(0);
  const [feedback, setFeedback] = useState<{ ok: boolean; side: boolean } | null>(null);
  const right = useRef(0);
  const times = useRef<number[]>([]);
  const shownAt = useRef(Date.now());
  const locked = useRef(false);
  const later = useLater();
  const card = cards[Math.min(i, cards.length - 1)];

  const pick = (side: boolean) => {
    if (locked.current || i >= cards.length || !card) return;
    locked.current = true;
    const ok = card.right === side;
    if (ok) right.current += 1;
    times.current.push(Date.now() - shownAt.current);
    setFeedback({ ok, side });
    later(() => {
      locked.current = false;
      setFeedback(null);
      shownAt.current = Date.now();
      if (i + 1 >= cards.length) onDone(sortResult(right.current, cards.length, times.current));
      else setI(i + 1);
    }, SORT_PAUSE_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') pick(false);
      if (e.key === 'ArrowRight') pick(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="kids-game kids-game-grow">
      <Sky />
      <Bar value={i / cards.length} />
      <Hud
        left={`★ ${right.current}`}
        right={`${Math.min(i + 1, cards.length)} / ${cards.length}`}
      />
      <div
        key={i}
        aria-live="polite"
        className={cn(
          'kids-game-card',
          feedback?.ok === true && 'kids-game-card-right',
          feedback?.ok === true &&
            (feedback.side ? 'kids-game-card-fly-right' : 'kids-game-card-fly-left'),
          feedback?.ok === false && 'kids-game-card-wrong',
        )}
      >
        {card?.text}
      </div>
      <div className="absolute bottom-[5%] left-[5%] right-[5%] flex gap-3">
        <button type="button" onClick={() => pick(false)} className="kids-game-side">
          ← {String(cfg.left)}
        </button>
        <button
          type="button"
          onClick={() => pick(true)}
          className="kids-game-side kids-game-side-cyan"
        >
          {String(cfg.right)} →
        </button>
      </div>
    </div>
  );
}

// ── memory ─────────────────────────────────────────────────────────────────────

function MemoryGame({ cfg, onDone }: GrowGameProps) {
  const pads = cfg.pads as string[];
  const pattern = useRef<number[]>([]);
  const typed = useRef(0);
  const best = useRef(0);
  const lives = useRef(MEMORY_LIVES);
  const level = useRef(MEMORY_START);
  const [lit, setLit] = useState(-1);
  const [phase, setPhase] = useState<'wait' | 'show' | 'input'>('wait');
  const [oops, setOops] = useState(false);
  const later = useLater();

  const show = (n: number) => {
    pattern.current = growPattern(pattern.current, n);
    setPhase('show');
    let k = 0;
    const step = () => {
      if (k >= n) {
        setLit(-1);
        typed.current = 0;
        setPhase('input');
        return;
      }
      setLit(pattern.current[k] ?? -1);
      later(() => {
        setLit(-1);
        k += 1;
        later(step, MEMORY_GAP_MS);
      }, MEMORY_LIT_MS);
    };
    later(step, 700);
  };
  // Starts the first pattern once, on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => show(MEMORY_START), []);

  const finish = () => onDone(memoryResult(best.current));
  const tap = (j: number) => {
    if (phase !== 'input') return;
    setLit(j);
    later(() => setLit(-1), 180);
    if (pattern.current[typed.current] === j) {
      typed.current += 1;
      if (typed.current >= level.current) {
        best.current = level.current;
        setPhase('wait');
        if (level.current >= MEMORY_TOP) return later(finish, 500);
        level.current += 1;
        later(() => show(level.current), 600);
      }
    } else {
      lives.current -= 1;
      setOops(true);
      later(() => setOops(false), 400);
      setPhase('wait');
      if (lives.current <= 0) later(finish, 700);
      else later(() => show(level.current), 900);
    }
  };
  const caption =
    phase === 'show'
      ? 'Watch…'
      : phase === 'input'
        ? 'Your turn!'
        : oops
          ? 'Oops! Watch again'
          : 'Nice!';
  return (
    <div className={cn('kids-game kids-game-grow', oops && 'kids-game-flash')}>
      <Sky />
      <Bar value={best.current / MEMORY_TOP} />
      <Hud left={`Level ${level.current}`} right={'♥'.repeat(Math.max(0, lives.current))} />
      <div className="absolute bottom-[16%] left-[12%] right-[12%] top-[18%] grid grid-cols-2 place-items-center gap-[6%]">
        {pads.map((p, j) => (
          <button
            key={p}
            type="button"
            disabled={phase !== 'input'}
            onClick={() => tap(j)}
            style={tileVars(PAD_COLORS[j % PAD_COLORS.length] ?? 'discover')}
            className={cn('kids-game-pad', lit === j && 'kids-game-pad-lit')}
          >
            {p}
          </button>
        ))}
      </div>
      <p
        aria-live="polite"
        className={cn('kids-game-caption', phase === 'input' && 'text-kids-gold')}
      >
        {caption}
      </p>
    </div>
  );
}

// ── timing ─────────────────────────────────────────────────────────────────────

function TimingGame({ cfg, onDone }: GrowGameProps) {
  const total = Number(cfg.n) || 10;
  const per = Number(cfg.per) || 1300;
  const beat = useRef({ start: Date.now() + TIMING_LEAD_MS, beats: [] as Beat[] });
  const done = useRef(false);
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<{ beat: Beat; key: number } | null>(null);

  const record = (b: Beat) => {
    const B = beat.current;
    B.beats.push(b);
    B.start = Date.now() + TIMING_GAP_MS;
    setFlash({ beat: b, key: Date.now() });
    if (B.beats.length >= total && !done.current) {
      done.current = true;
      setTimeout(() => onDone(timingResult(B.beats, total)), 450);
    }
  };
  useEffect(() => {
    const id = setInterval(() => {
      if (done.current) return;
      if (beatMissed(Date.now() - beat.current.start, per)) record('miss');
      setNow(Date.now());
    }, 30);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [per]);
  const tap = () => {
    if (done.current) return;
    const b = judgeBeat(Date.now() - beat.current.start, per);
    if (b) record(b);
  };
  const ms = now - beat.current.start;
  const near = Math.abs(ms / per - 1) < 0.1;
  const hits = beat.current.beats.filter((b) => b !== 'miss').length;
  return (
    <button
      type="button"
      aria-label={`${String(cfg.label)}: tap when the rings meet`}
      onPointerDown={tap}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && tap()}
      className="kids-game kids-game-grow block"
    >
      <Sky />
      <Bar value={beat.current.beats.length / total} />
      <Hud
        left={`★ ${hits}`}
        right={`${Math.min(beat.current.beats.length + 1, total)} / ${total}`}
      />
      <span className={cn('kids-game-target', near && 'kids-game-target-near')}>
        {String(cfg.label)}
      </span>
      {ms / per < 1.3 && (
        <span
          className="kids-game-closing"
          style={{
            width: `${ringSize(ms, per)}%`,
            height: `${ringSize(ms, per)}%`,
            opacity: ms > per ? 0.4 : 1,
          }}
        />
      )}
      {flash && (
        <span
          key={flash.key}
          className={cn(
            'kids-game-word',
            flash.beat === 'miss' ? 'text-kids-wrong' : 'text-kids-gold',
          )}
        >
          {flash.beat === 'perfect' ? 'Perfect!' : flash.beat === 'good' ? 'Good' : 'Miss'}
        </span>
      )}
      <span className="kids-game-caption">Tap when the rings meet</span>
    </button>
  );
}

// ── dash ───────────────────────────────────────────────────────────────────────

function DashGame({ cfg, onDone }: GrowGameProps) {
  const pool = cfg.items as DashItem[];
  const done = useRef(false);
  const picked = useRef<DashItem[]>([]);
  const [state, setState] = useState<{ items: Flying[]; nextId: number }>({
    items: [],
    nextId: 1,
  });
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [count, setCount] = useState(0);
  const left = useCountdown(DASH_SECONDS, () => {
    done.current = true;
    onDone(dashResult(picked.current));
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (!done.current) setState((s) => dashTick(s.items, pool, s.nextId));
    }, DASH_TICK_MS);
    return () => clearInterval(id);
  }, [pool]);
  const grab = (o: Flying) => {
    if (done.current) return;
    setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== o.id) }));
    picked.current = [...picked.current, { text: o.text, kind: o.kind }];
    setBursts((list) => addBurst(list, o.x, o.y));
    setCount(picked.current.length);
  };
  return (
    <div className="kids-game kids-game-grow">
      <Sky />
      <Bar value={left / DASH_SECONDS} />
      <Bursts list={bursts} />
      <Hud left={`★ ${count}`} right={`${Math.ceil(left)}s`} />
      {state.items.map((o) => (
        <button
          key={o.id}
          type="button"
          onPointerDown={() => grab(o)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && grab(o)}
          className="kids-game-pill"
          style={{ left: `${o.x}%`, top: `${o.y}%` }}
        >
          {o.text}
        </button>
      ))}
      <div className="pointer-events-none absolute bottom-[5%] left-[5%] right-[5%] flex flex-wrap justify-center gap-1.5">
        {picked.current.slice(-5).map((p, j) => (
          <span key={`${j}-${p.text}`} className="kids-game-chip">
            {p.text}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── react ──────────────────────────────────────────────────────────────────────

function ReactGame({ cfg, onDone }: GrowGameProps) {
  const total = Number(cfg.n) || 5;
  const times = useRef<number[]>([]);
  const shownAt = useRef(0);
  const early = useRef(0);
  const [st, setSt] = useState<{
    phase: 'wait' | 'go' | 'done';
    x: number;
    y: number;
    msg: string;
  }>({ phase: 'wait', x: 50, y: 50, msg: '' });
  const later = useLater();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const arm = (msg = '') => {
    clearTimeout(timer.current);
    setSt((s) => ({ ...s, phase: 'wait', msg }));
    timer.current = setTimeout(() => {
      shownAt.current = Date.now();
      setSt({ phase: 'go', ...reactSpot(), msg: '' });
    }, reactWait());
  };
  useEffect(() => {
    arm();
    return () => clearTimeout(timer.current);
  }, []);
  const tooSoon = () => {
    if (st.phase !== 'wait' || times.current.length >= total) return;
    early.current += 1;
    arm('Too soon!');
  };
  const hit = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    const rt = Date.now() - shownAt.current;
    times.current.push(rt);
    if (times.current.length >= total) {
      setSt((s) => ({ ...s, phase: 'done', msg: `${(rt / 1000).toFixed(2)}s` }));
      later(() => onDone(reactResult(times.current, early.current)), 500);
    } else arm(`${(rt / 1000).toFixed(2)}s`);
  };
  return (
    <div className="kids-game kids-game-grow" onPointerDown={tooSoon}>
      <Sky />
      <Bar value={times.current.length / total} />
      <Hud left={`★ ${times.current.length}`} right={`${times.current.length} / ${total}`} />
      {st.phase === 'go' && (
        <button
          key={times.current.length}
          type="button"
          onPointerDown={hit}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && hit(e)}
          className="kids-game-light"
          style={{ left: `${st.x}%`, top: `${st.y}%` }}
        >
          {String(cfg.label)}
        </button>
      )}
      {st.msg && (
        <span
          key={`${st.msg}-${times.current.length}`}
          className={cn(
            'kids-game-word kids-game-word-mid kids-game-word-quick',
            st.msg === 'Too soon!' ? 'text-kids-wrong' : 'text-kids-discover',
          )}
        >
          {st.msg}
        </span>
      )}
      <p className="kids-game-caption" aria-live="polite">
        {st.phase === 'wait' ? 'Wait for it…' : st.phase === 'go' ? 'Now!' : 'Done!'}
      </p>
    </div>
  );
}

// ── spark ──────────────────────────────────────────────────────────────────────

function SparkGame({ cfg, onDone }: GrowGameProps) {
  const seconds = Number(cfg.time) || SPARK_SECONDS;
  // useId's colons aren't safe in url(#…).
  const glowId = `spark-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const box = useRef<HTMLDivElement>(null);
  const down = useRef(false);
  const ended = useRef(false);
  const cells = useRef(new Set<string>());
  const [strokes, setStrokes] = useState<{ x: number; y: number }[][]>([]);
  const left = useCountdown(seconds, () => {
    ended.current = true;
    down.current = false;
    onDone(sparkResult(cells.current.size, strokesRef.current));
  });
  const strokesRef = useRef(0);
  const add = (e: PointerEvent<HTMLDivElement>) => {
    if (!down.current || ended.current || !box.current) return;
    const p = pointIn(e, box.current);
    const cell = sparkCell(p);
    if (cell) cells.current.add(cell);
    setStrokes((all) => {
      const last = all[all.length - 1];
      if (!last) return all;
      const prev = last[last.length - 1];
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1.2) return all;
      return [...all.slice(0, -1), [...last, p]];
    });
  };
  return (
    <div
      ref={box}
      role="img"
      aria-label="Paint here"
      className="kids-game kids-game-grow cursor-crosshair"
      onPointerDown={(e) => {
        if (ended.current) return;
        down.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        strokesRef.current += 1;
        setStrokes((all) => [...all, []]);
        add(e);
      }}
      onPointerMove={add}
      onPointerUp={() => {
        down.current = false;
      }}
      onPointerCancel={() => {
        down.current = false;
      }}
    >
      <Sky />
      <Bar value={left / seconds} />
      <Hud left={`${cells.current.size}%`} right={`${Math.ceil(left)}s`} />
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <defs>
          {/* Each stroke glows in its own colour: its blur under it. */}
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.6" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {strokes.map((points, j) => {
          const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          return (
            <g key={j}>
              <polyline
                points={line}
                fill="none"
                stroke={tileColor(SPARK_INKS[j % SPARK_INKS.length] ?? 'gold')}
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={`url(#${glowId})`}
              />
              <polyline
                points={line}
                fill="none"
                className="stroke-kids-white"
                strokeWidth="0.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      </svg>
      <p className={cn('kids-game-caption', strokes.length === 0 && 'bottom-auto top-1/2')}>
        {strokes.length === 0 ? 'Paint here' : 'New stroke, new colour'}
      </p>
    </div>
  );
}

const GAMES: Record<GrowGameType, ComponentType<GrowGameProps>> = {
  catch: CatchGame,
  sort: SortGame,
  memory: MemoryGame,
  timing: TimingGame,
  dash: DashGame,
  react: ReactGame,
  spark: SparkGame,
};

/** A world's game, by its `type`. */
export default function GrowGame({ type, cfg, onDone }: GrowGameProps & { type: GrowGameType }) {
  const Game = GAMES[type];
  return <Game cfg={cfg} onDone={onDone} />;
}
