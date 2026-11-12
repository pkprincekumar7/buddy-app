import React, { useEffect, useRef, useState } from 'react';
import { Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { G, Polyline } from 'react-native-svg';
import { Pressable } from '@/components/ui/pressable';
import { css, font } from '@/theme';
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
  SPARK_COLORS,
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
  type CatchCfg,
  type CatchTally,
  type DashItem,
  type Falling,
  type Flying,
  type GrowResult,
  type SortItem,
} from '@/lib/kidsGrow';
import {
  chip,
  color,
  game,
  grow,
  memoryPad,
  sortCard,
  sortSide,
  timingTarget,
} from '@/components/kids/palette';
import {
  Bar,
  Caption,
  Frame,
  Hud,
  Sky,
  at,
} from '@/components/kids/GamePieces';

/**
 * Grow's seven game types (web components/kids/GrowGames; docs/child-view-build-plan.md, 3.5).
 * The rules and scoring are lib/kidsGrow; each view reports once with `onDone`. Pieces are
 * sized from the frame's measured width and what moves each tick moves by `transform`.
 */
interface GrowGameProps {
  cfg: Record<string, unknown>;
  onDone: (result: GrowResult) => void;
}

const PAD_COLORS = ['discover', 'transform', 'teal', 'release'] as const;

/** Where the web's .kids-game-* pieces differ from the shared ones at phone width. */
const piece = {
  // .kids-game-pill: px-4 py-2.5, text-sm, and its glow.
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    boxShadow: css('0 0 18px rgb(var(--kids-discover-rgb) / 0.35)'),
  },
  pillText: { fontSize: 14, lineHeight: 20 },
  // .kids-game-card: px-5 py-6, text-lg leading-snug.
  card: { paddingHorizontal: 20, paddingVertical: 24 },
  cardText: { fontSize: 18, lineHeight: 24.75 },
  // .kids-game-side: min-h-16, text-base tracking-[0.12em].
  side: { minHeight: 64 },
  sideText: { fontSize: 16, lineHeight: 24, letterSpacing: 16 * 0.12 },
  // .kids-game-pad / -target / -light: text-sm, text-base, text-base black.
  padText: { ...font('orbitron', 700), fontSize: 14, lineHeight: 20 },
  targetText: { ...font('orbitron', 700), fontSize: 16, lineHeight: 24 },
  lightText: { ...font('orbitron', 900), fontSize: 16, lineHeight: 24 },
  // .kids-game-target's gradient, .kids-game-closing's glow.
  target: {
    backgroundColor: 'transparent',
    experimental_backgroundImage: css(
      'radial-gradient(circle, rgb(var(--kids-streak-rgb) / 0.3), rgb(var(--kids-streak-rgb) / 0.05))',
    ),
  },
  closing: { boxShadow: css('0 0 24px rgb(var(--kids-discover-rgb) / 0.7)') },
  // .kids-chip px-2.5 py-1 font-rajdhani text-sm font-bold text-kids-streak (Grow's circle).
  chip: { paddingHorizontal: 10, paddingVertical: 4 },
  chipText: {
    ...font('rajdhani', 700),
    fontSize: 14,
    lineHeight: 20,
    color: color('streak'),
  },
} as const;

/** A word centred at (x%, y%) of a `size`-wide frame, by transform only. */
const pillAt = (size: number, x: number, y: number) => ({
  transform: [
    { translateX: (x / 100) * size },
    { translateY: (y / 100) * size },
    { translateX: '-50%' as const },
    { translateY: '-50%' as const },
  ],
});

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
  const done = useRef(false);
  const width = useRef(0);
  const basketRef = useRef(50);
  const [basket, setBasket] = useState(50);
  const [state, setState] = useState<{
    items: Falling[];
    tally: CatchTally;
    nextId: number;
  }>({ items: [], tally: { caught: 0, oops: 0, missed: 0 }, nextId: 1 });
  const tallyRef = useRef(state.tally);
  const left = useCountdown(CATCH_SECONDS, () => {
    done.current = true;
    onDone(catchResult(tallyRef.current));
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (done.current) return;
      setState(s => {
        const next = catchTick(
          s.items,
          basketRef.current,
          s.tally,
          s.nextId,
          cfg as CatchCfg,
        );
        tallyRef.current = next.tally;
        return next;
      });
    }, CATCH_TICK_MS);
    return () => clearInterval(id);
  }, [cfg]);
  const move = (e: GestureResponderEvent) => {
    if (!width.current) return;
    const x = Math.max(
      10,
      Math.min(90, (e.nativeEvent.locationX / width.current) * 100),
    );
    basketRef.current = x;
    setBasket(x);
  };
  return (
    <View
      accessibilityLabel="Move the basket with your finger"
      onLayout={e => {
        width.current = e.nativeEvent.layout.width;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={move}
      onResponderMove={move}
    >
      <Frame>
        {size => (
          <>
            <Sky />
            <Bar value={left / CATCH_SECONDS} />
            <Hud
              left={`★ ${state.tally.caught}`}
              right={`${Math.ceil(left)}s`}
            />
            {state.items.map(o => (
              <View
                key={o.id}
                pointerEvents="none"
                style={[grow.pill, piece.pill, pillAt(size, o.x, o.y)]}
              >
                <Text numberOfLines={1} style={[grow.pillText, piece.pillText]}>
                  {o.label}
                </Text>
              </View>
            ))}
            <View
              pointerEvents="none"
              style={[
                grow.basket,
                {
                  width: size * 0.28,
                  height: size * 0.08,
                  top: size * 0.83,
                  transform: [
                    { translateX: (basket / 100) * size - size * 0.14 },
                  ],
                },
              ]}
            />
            {left > CATCH_SECONDS - 3 ? (
              <Caption top>Slide to move</Caption>
            ) : null}
          </>
        )}
      </Frame>
    </View>
  );
}

// ── sort ───────────────────────────────────────────────────────────────────────

function SortGame({ cfg, onDone }: GrowGameProps) {
  const [cards] = useState(() => sortCards(cfg.items as SortItem[]));
  const [i, setI] = useState(0);
  const [feedback, setFeedback] = useState<boolean | null>(null);
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
    setFeedback(ok);
    later(() => {
      locked.current = false;
      setFeedback(null);
      shownAt.current = Date.now();
      if (i + 1 >= cards.length)
        onDone(sortResult(right.current, cards.length, times.current));
      else setI(i + 1);
    }, SORT_PAUSE_MS);
  };

  return (
    <Frame>
      {size => (
        <>
          <Sky />
          <Bar value={i / cards.length} />
          <Hud
            left={`★ ${right.current}`}
            right={`${Math.min(i + 1, cards.length)} / ${cards.length}`}
          />
          {/* Centred on 44% of the frame, 78% wide (web left-1/2 top-[44%] w-[78%]). */}
          <View
            pointerEvents="box-none"
            className="absolute justify-center"
            style={{ left: '11%', right: '11%', top: 0, height: '88%' }}
          >
            <View
              accessibilityLiveRegion="polite"
              style={[
                sortCard(
                  feedback === true
                    ? 'right'
                    : feedback === false
                    ? 'wrong'
                    : 'shown',
                ),
                piece.card,
                {
                  position: 'relative',
                  left: 0,
                  right: 0,
                  top: 0,
                  minHeight: size * 0.34,
                },
              ]}
            >
              <Text style={[grow.cardText, piece.cardText]}>{card?.text}</Text>
            </View>
          </View>
          <View
            className="absolute flex-row gap-3"
            style={{ left: '5%', right: '5%', bottom: '5%' }}
          >
            <Pressable
              onPress={() => pick(false)}
              accessibilityRole="button"
              accessibilityLabel={String(cfg.left)}
              style={({ pressed }) => [
                sortSide('transform', pressed),
                piece.side,
              ]}
            >
              <Text style={[grow.sideText, piece.sideText]}>
                ← {String(cfg.left)}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => pick(true)}
              accessibilityRole="button"
              accessibilityLabel={String(cfg.right)}
              style={({ pressed }) => [
                sortSide('discover', pressed),
                piece.side,
              ]}
            >
              <Text style={[grow.sideText, piece.sideText]}>
                {String(cfg.right)} →
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </Frame>
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
    <Frame>
      {size => (
        <>
          <Sky />
          <Bar value={best.current / MEMORY_TOP} />
          <Hud
            left={`Level ${level.current}`}
            right={'♥'.repeat(Math.max(0, lives.current))}
          />
          {/* Web: a 2-column grid over left/right 12%, top 18%, bottom 16%, gap 6% (of its
              width across, its height down); each pad fills its column. */}
          <View
            className="absolute flex-row flex-wrap justify-center"
            style={{
              left: '12%',
              right: '12%',
              top: '18%',
              bottom: '16%',
              columnGap: size * 0.76 * 0.06,
              rowGap: size * 0.66 * 0.06,
            }}
          >
            {pads.map((p, j) => (
              <Pressable
                key={p}
                disabled={phase !== 'input'}
                onPress={() => tap(j)}
                accessibilityRole="button"
                accessibilityLabel={p}
                style={[
                  memoryPad(
                    PAD_COLORS[j % PAD_COLORS.length] ?? 'discover',
                    lit === j,
                  ),
                  { width: (size * 0.76 * 0.94) / 2 },
                ]}
              >
                <Text
                  style={[
                    game.number,
                    piece.padText,
                    lit === j && { color: color('ink') },
                  ]}
                >
                  {p}
                </Text>
              </Pressable>
            ))}
          </View>
          <Caption>
            {phase === 'input' ? (
              <Text style={{ color: color('streak') }}>{caption}</Text>
            ) : (
              caption
            )}
          </Caption>
        </>
      )}
    </Frame>
  );
}

// ── timing ─────────────────────────────────────────────────────────────────────

function TimingGame({ cfg, onDone }: GrowGameProps) {
  const total = Number(cfg.n) || 10;
  const per = Number(cfg.per) || 1300;
  const beat = useRef({
    start: Date.now() + TIMING_LEAD_MS,
    beats: [] as Beat[],
  });
  const done = useRef(false);
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<Beat | null>(null);

  const record = (b: Beat) => {
    const B = beat.current;
    B.beats.push(b);
    B.start = Date.now() + TIMING_GAP_MS;
    setFlash(b);
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
  const hits = beat.current.beats.filter(b => b !== 'miss').length;
  return (
    <Pressable
      onPressIn={tap}
      accessibilityRole="button"
      accessibilityLabel={`${String(cfg.label)}: tap when the rings meet`}
    >
      <Frame>
        {size => {
          const ring = (ringSize(ms, per) / 100) * size;
          return (
            <>
              <Sky />
              <Bar value={beat.current.beats.length / total} />
              <Hud
                left={`★ ${hits}`}
                right={`${Math.min(
                  beat.current.beats.length + 1,
                  total,
                )} / ${total}`}
              />
              <View
                pointerEvents="none"
                style={[timingTarget(near), piece.target]}
              >
                <Text
                  style={[
                    game.number,
                    piece.targetText,
                    { color: color('streak') },
                  ]}
                >
                  {String(cfg.label)}
                </Text>
              </View>
              {ms / per < 1.3 ? (
                <View
                  pointerEvents="none"
                  style={[
                    grow.closing,
                    piece.closing,
                    {
                      width: size,
                      height: size,
                      opacity: ms > per ? 0.4 : 1,
                      // Shrinks by scale only (a transform, not a layout change).
                      transform: [{ scale: ring / size }],
                    },
                  ]}
                />
              ) : null}
              {flash ? (
                <View
                  pointerEvents="none"
                  className="absolute left-0 right-0 items-center"
                  style={{ top: '22%' }}
                >
                  <Text
                    style={[
                      grow.word,
                      {
                        color:
                          flash === 'miss' ? color('connect') : color('streak'),
                      },
                    ]}
                  >
                    {flash === 'perfect'
                      ? 'Perfect!'
                      : flash === 'good'
                      ? 'Good'
                      : 'Miss'}
                  </Text>
                </View>
              ) : null}
              <Caption>Tap when the rings meet</Caption>
            </>
          );
        }}
      </Frame>
    </Pressable>
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
  const [count, setCount] = useState(0);
  const left = useCountdown(DASH_SECONDS, () => {
    done.current = true;
    onDone(dashResult(picked.current));
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (!done.current) setState(s => dashTick(s.items, pool, s.nextId));
    }, DASH_TICK_MS);
    return () => clearInterval(id);
  }, [pool]);
  const grab = (o: Flying) => {
    if (done.current) return;
    setState(s => ({ ...s, items: s.items.filter(x => x.id !== o.id) }));
    picked.current = [...picked.current, { text: o.text, kind: o.kind }];
    setCount(picked.current.length);
  };
  return (
    <Frame>
      {size => (
        <>
          <Sky />
          <Bar value={left / DASH_SECONDS} />
          <Hud left={`★ ${count}`} right={`${Math.ceil(left)}s`} />
          {state.items.map(o => (
            <Pressable
              key={o.id}
              onPressIn={() => grab(o)}
              accessibilityRole="button"
              accessibilityLabel={o.text}
              style={[grow.pill, piece.pill, pillAt(size, o.x, o.y)]}
            >
              <Text numberOfLines={1} style={[grow.pillText, piece.pillText]}>
                {o.text}
              </Text>
            </Pressable>
          ))}
          <View
            pointerEvents="none"
            className="absolute flex-row flex-wrap justify-center gap-1.5"
            style={{ left: '5%', right: '5%', bottom: '5%' }}
          >
            {picked.current.slice(-5).map((p, j) => (
              <View key={`${j}-${p.text}`} style={[chip('grow'), piece.chip]}>
                <Text style={piece.chipText}>{p.text}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </Frame>
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
    setSt(s => ({ ...s, phase: 'wait', msg }));
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
  const hit = () => {
    const rt = Date.now() - shownAt.current;
    times.current.push(rt);
    if (times.current.length >= total) {
      setSt(s => ({ ...s, phase: 'done', msg: `${(rt / 1000).toFixed(2)}s` }));
      later(() => onDone(reactResult(times.current, early.current)), 500);
    } else arm(`${(rt / 1000).toFixed(2)}s`);
  };
  return (
    <Pressable
      onPressIn={tooSoon}
      accessibilityRole="button"
      accessibilityLabel="Wait for the light"
    >
      <Frame>
        {size => (
          <>
            <Sky />
            <Bar value={times.current.length / total} />
            <Hud
              left={`★ ${times.current.length}`}
              right={`${times.current.length} / ${total}`}
            />
            {st.phase === 'go' ? (
              <Pressable
                onPressIn={hit}
                accessibilityRole="button"
                accessibilityLabel={String(cfg.label)}
                style={[grow.light, at(size, st.x, st.y, 22)]}
              >
                <Text
                  style={[
                    game.number,
                    piece.lightText,
                    { color: color('ink') },
                  ]}
                >
                  {String(cfg.label)}
                </Text>
              </Pressable>
            ) : null}
            {st.msg ? (
              <View
                pointerEvents="none"
                className="absolute inset-0 items-center justify-center"
              >
                <Text
                  style={[
                    grow.word,
                    {
                      color:
                        st.msg === 'Too soon!'
                          ? color('connect')
                          : color('discover'),
                    },
                  ]}
                >
                  {st.msg}
                </Text>
              </View>
            ) : null}
            <Caption>
              {st.phase === 'wait'
                ? 'Wait for it…'
                : st.phase === 'go'
                ? 'Now!'
                : 'Done!'}
            </Caption>
          </>
        )}
      </Frame>
    </Pressable>
  );
}

// ── spark ──────────────────────────────────────────────────────────────────────

function SparkGame({ cfg, onDone }: GrowGameProps) {
  const seconds = Number(cfg.time) || SPARK_SECONDS;
  const width = useRef(0);
  const ended = useRef(false);
  const cells = useRef(new Set<string>());
  const strokeCount = useRef(0);
  const [strokes, setStrokes] = useState<{ x: number; y: number }[][]>([]);
  const left = useCountdown(seconds, () => {
    ended.current = true;
    onDone(sparkResult(cells.current.size, strokeCount.current));
  });
  const point = (e: GestureResponderEvent) => ({
    x: (e.nativeEvent.locationX / width.current) * 100,
    y: (e.nativeEvent.locationY / width.current) * 100,
  });
  const add = (p: { x: number; y: number }) => {
    if (ended.current) return;
    const cell = sparkCell(p);
    if (cell) cells.current.add(cell);
    setStrokes(all => {
      const last = all[all.length - 1];
      if (!last) return all;
      const prev = last[last.length - 1];
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1.2) return all;
      return [...all.slice(0, -1), [...last, p]];
    });
  };
  return (
    <View
      testID="kids-grow-spark"
      accessibilityLabel="Paint here"
      onLayout={e => {
        width.current = e.nativeEvent.layout.width;
      }}
      onStartShouldSetResponder={() => !ended.current}
      onMoveShouldSetResponder={() => !ended.current}
      onResponderTerminationRequest={() => false}
      onResponderGrant={e => {
        if (ended.current || !width.current) return;
        strokeCount.current += 1;
        const p = point(e);
        setStrokes(all => [...all, []]);
        add(p);
      }}
      onResponderMove={e => {
        if (width.current) add(point(e));
      }}
    >
      <Frame>
        {size => (
          <>
            <Sky />
            <Bar value={left / seconds} />
            <Hud
              left={`${cells.current.size}%`}
              right={`${Math.ceil(left)}s`}
            />
            <Svg
              pointerEvents="none"
              width={size}
              height={size}
              viewBox="0 0 100 100"
              style={{ position: 'absolute' }}
            >
              {strokes.map((points, j) => {
                const line = points
                  .map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                  .join(' ');
                return (
                  <G key={j}>
                    <Polyline
                      points={line}
                      fill="none"
                      stroke={color(
                        SPARK_COLORS[j % SPARK_COLORS.length] ?? 'transform',
                      )}
                      strokeWidth={2.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <Polyline
                      points={line}
                      fill="none"
                      stroke={color('text')}
                      strokeWidth={0.7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </G>
                );
              })}
            </Svg>
            <Caption top={strokes.length === 0}>
              {strokes.length === 0 ? 'Paint here' : 'New stroke, new colour'}
            </Caption>
          </>
        )}
      </Frame>
    </View>
  );
}

const GAMES: Record<GrowGameType, React.ComponentType<GrowGameProps>> = {
  catch: CatchGame,
  sort: SortGame,
  memory: MemoryGame,
  timing: TimingGame,
  dash: DashGame,
  react: ReactGame,
  spark: SparkGame,
};

/** A world's game, by its `type`. */
export default function GrowGame({
  type,
  cfg,
  onDone,
}: GrowGameProps & { type: GrowGameType }) {
  const Game = GAMES[type];
  return <Game cfg={cfg} onDone={onDone} />;
}
