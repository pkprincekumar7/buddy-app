import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  useReducedMotion,
  type CSSAnimationKeyframes,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Ellipse,
  Line,
  Path,
  Polygon,
  Polyline,
} from 'react-native-svg';
import { Pressable } from '@/components/ui/pressable';
import { rgb } from '@/theme';
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
import { POWER_ICONS } from '@/components/kids/icons';
import { color, game, gameBox, gameNode } from '@/components/kids/palette';
import {
  Bar,
  CAPTION_TEXT,
  Caption,
  Frame,
  Sky,
  at,
  useFrameWidth,
} from '@/components/kids/GamePieces';

/**
 * The seven games' views (web components/kids/KidsGames; docs/child-view-build-plan.md,
 * 2.6). The rules are lib/kidsGames. Every piece is sized from the frame's measured width;
 * what moves each tick moves by `transform` only, and every colour is a --kids-* token.
 */
export interface GameProps {
  onWin: () => void;
}

// ── shared pieces ──────────────────────────────────────────────────────────────

interface Burst {
  key: number;
  x: number;
  y: number;
}
/** `.kids-game-burst`'s kids-burst: a gold ring that grows and fades where a thing was hit. */
const BURST: CSSAnimationKeyframes = {
  from: { opacity: 1, transform: [{ scale: 0.3 }] },
  to: { opacity: 0, transform: [{ scale: 1.6 }] },
};
const BURST_RING = {
  position: 'absolute',
  borderRadius: 9999,
  borderWidth: 3,
  borderColor: rgb('kids-streak'),
} as const;
/** The bursts in a `size`-wide frame (none when the device asks for reduced motion, as the
 * web hides them). */
function Bursts({ list, size }: { list: Burst[]; size: number }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const d = 0.16 * size;
  return list.map(b => (
    <Animated.View
      key={b.key}
      pointerEvents="none"
      style={[
        BURST_RING,
        {
          width: d,
          height: d,
          left: (b.x / 100) * size - d / 2,
          top: (b.y / 100) * size - d / 2,
          animationName: BURST,
          animationDuration: '0.6s',
          animationTimingFunction: 'ease-out',
          animationFillMode: 'forwards',
        },
      ]}
    />
  ));
}
const addBurst = (list: Burst[], x: number, y: number) => [
  ...list.slice(-3),
  { key: Date.now() + Math.random(), x, y },
];

/** The glows the shared game styles leave out (web .kids-game-bubble, -wave, -box-found). */
const BUBBLE_GLOW = {
  boxShadow: `0 0 18px ${rgb('kids-discover', 0.35)}`,
} as const;
const WAVE_GLOW = {
  boxShadow: `0 0 8px ${rgb('kids-discover', 0.7)}`,
  transformOrigin: 'bottom',
} as const;
const FOUND_GLOW = {
  boxShadow: `0 0 26px ${rgb('kids-streak', 0.35)}`,
} as const;

// ── the games ──────────────────────────────────────────────────────────────────

function FocusGame({ onWin }: GameProps) {
  const [caught, setCaught] = useState(0);
  const [spot, setSpot] = useState({ x: 50, y: 55 });
  const [bursts, setBursts] = useState<Burst[]>([]);
  const reduced = useReducedMotion();
  useEffect(() => {
    const id = setInterval(() => setSpot(focusSpot()), FOCUS_MOVE_MS);
    return () => clearInterval(id);
  }, []);
  useWinOnce(caught >= FOCUS_GOAL, onWin);
  const catchIt = () => {
    if (caught >= FOCUS_GOAL) return;
    setBursts(b => addBurst(b, spot.x, spot.y));
    setCaught(n => n + 1);
    setSpot(focusSpot());
  };
  return (
    <Frame>
      {size => (
        <>
          <Sky />
          <Bar value={progress(caught, FOCUS_GOAL)} />
          <Bursts list={bursts} size={size} />
          {/* Glides to its next spot over a second (web transition-[left,top]). */}
          <Animated.View
            style={[
              game.orb,
              at(size, spot.x, spot.y, 17),
              !reduced && {
                transitionProperty: 'transform',
                transitionDuration: 1000,
                transitionTimingFunction: 'ease-in-out',
              },
            ]}
          >
            <Pressable
              onPressIn={catchIt}
              accessibilityRole="button"
              accessibilityLabel="The light"
              style={[StyleSheet.absoluteFill, { borderRadius: 9999 }]}
            />
          </Animated.View>
          <Caption>
            {caught} / {FOCUS_GOAL}
          </Caption>
        </>
      )}
    </Frame>
  );
}

/** Box `i` of web's 3×3 grid (gap-[4%] px-[7%] pt-[14%] pb-[7%]) in a `size` square: the
 * gaps are 4% of the content box across (86%) and down (79%). */
function boxCell(i: number, size: number) {
  const colGap = 0.04 * 0.86 * size;
  const rowGap = 0.04 * 0.79 * size;
  const width = (0.86 * size - 2 * colGap) / 3;
  const height = (0.79 * size - 2 * rowGap) / 3;
  return {
    position: 'absolute',
    aspectRatio: undefined,
    width,
    height,
    left: 0.07 * size + (i % 3) * (width + colGap),
    top: 0.14 * size + Math.floor(i / 3) * (height + rowGap),
  } as const;
}

function CuriousGame({ onWin }: GameProps) {
  const [planets] = useState(() => hidePlanets());
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const found = planetsFound(planets, opened);
  useWinOnce(found >= CURIOUS_GOAL, onWin);
  return (
    <Frame>
      {size => (
        <>
          <Bar value={progress(found, CURIOUS_GOAL)} />
          {Array.from({ length: CURIOUS_BOXES }, (_, i) => {
            const open = opened.has(i);
            const planet = planets.includes(i);
            const cell = boxCell(i, size);
            return (
              <Pressable
                key={i}
                disabled={open}
                onPressIn={() => setOpened(new Set(opened).add(i))}
                accessibilityRole="button"
                accessibilityLabel={
                  open ? (planet ? 'A planet!' : 'Empty') : `Box ${i + 1}`
                }
                style={[
                  gameBox(open, open && planet),
                  cell,
                  open && planet && FOUND_GLOW,
                ]}
              >
                {!open ? (
                  <Text style={[game.number, { fontSize: 30 }]}>?</Text>
                ) : planet ? (
                  <Svg width="62%" height="62%" viewBox="0 0 40 40">
                    <Ellipse
                      cx={20}
                      cy={20}
                      rx={18}
                      ry={6}
                      fill="none"
                      stroke={color('streak')}
                      strokeWidth={2}
                      transform="rotate(-20 20 20)"
                    />
                    <Circle cx={20} cy={20} r={10} fill={color('streak')} />
                  </Svg>
                ) : (
                  <View
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: color('off') }}
                  />
                )}
              </Pressable>
            );
          })}
        </>
      )}
    </Frame>
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
    <Frame>
      {size => (
        <>
          <Sky />
          <Bar value={progress(done, ORDER_STARS.length)} />
          <Svg
            pointerEvents="none"
            width={size}
            height={size}
            viewBox="0 0 100 100"
            style={{ position: 'absolute' }}
          >
            <Polyline
              points={polyline(ORDER_STARS.slice(0, done))}
              fill="none"
              stroke={color('discover')}
              strokeWidth={0.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          {ORDER_STARS.map((s, i) => {
            const d = (14 / 100) * size;
            return (
              <Pressable
                key={i}
                onPressIn={() => tap(i)}
                accessibilityRole="button"
                accessibilityLabel={`Star ${i + 1}`}
                style={[
                  gameNode(
                    i < done
                      ? 'done'
                      : i === wrong
                      ? 'wrong'
                      : i === done
                      ? 'next'
                      : 'waiting',
                  ),
                  {
                    width: d,
                    height: d,
                    left: (s.x / 100) * size - d / 2,
                    top: (s.y / 100) * size - d / 2,
                  },
                ]}
              >
                <Text
                  style={[game.number, i < done && { color: color('ink') }]}
                >
                  {i + 1}
                </Text>
              </Pressable>
            );
          })}
        </>
      )}
    </Frame>
  );
}

function DrawGame({ onWin }: GameProps) {
  const [state, setState] = useState<DrawState>(DRAW_START);
  const width = useFrameWidth();
  const size = useRef(0);
  useWinOnce(state.length >= DRAW_GOAL, onWin);
  const point = (e: GestureResponderEvent) => ({
    x: (e.nativeEvent.locationX / size.current) * 100,
    y: (e.nativeEvent.locationY / size.current) * 100,
  });
  const line = polyline(state.points);
  return (
    <View
      testID="kids-game"
      accessibilityLabel="Draw here"
      style={[game.frame, width]}
      onLayout={e => {
        size.current = e.nativeEvent.layout.width;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={e => {
        const p = point(e);
        setState(s => drawTo(s, p, false));
      }}
      onResponderMove={e => {
        const p = point(e);
        setState(s => drawTo(s, p));
      }}
      onResponderRelease={() => setState(drawLift)}
      onResponderTerminate={() => setState(drawLift)}
    >
      <Sky />
      <Bar value={progress(state.length, DRAW_GOAL)} />
      <Svg
        pointerEvents="none"
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        style={{ position: 'absolute' }}
      >
        <Polyline
          points={line}
          fill="none"
          stroke={color('transform')}
          strokeWidth={2.2}
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
      </Svg>
      {state.points.length === 0 ? <Caption top>Draw here</Caption> : null}
    </View>
  );
}

function ClimbGame({ onWin }: GameProps) {
  const [height, setHeight] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const width = useFrameWidth();
  const reduced = useReducedMotion();
  useEffect(() => {
    const id = setInterval(() => setHeight(climbSlide), CLIMB_TICK_MS);
    return () => clearInterval(id);
  }, []);
  useWinOnce(height >= 100, onWin);
  const spot = climbSpot(height);
  const tap = () => {
    if (height >= 100) return;
    setHeight(climbTap);
    setBursts(b => addBurst(b, spot.x, spot.y));
  };
  return (
    <Pressable
      onPressIn={tap}
      accessibilityRole="button"
      accessibilityLabel="Climb"
      style={width}
    >
      <Frame>
        {size => (
          <>
            <Sky />
            <Bar value={progress(height, 100)} />
            <Svg
              pointerEvents="none"
              width={size}
              height={size}
              viewBox="0 0 100 100"
              style={{ position: 'absolute' }}
            >
              <Polygon
                points="0,100 50,18 100,100"
                fill={color('discover-shade')}
                fillOpacity={0.55}
                stroke={color('discover')}
                strokeOpacity={0.5}
                strokeWidth={0.6}
              />
              <Polygon
                points="42,31 50,18 58,31 54,28 50,32 46,28"
                fill={color('text')}
                fillOpacity={0.8}
              />
              <Line
                x1={14}
                y1={86}
                x2={50}
                y2={20}
                stroke={color('streak')}
                strokeOpacity={0.35}
                strokeWidth={0.6}
                strokeDasharray="2 2"
              />
              <Line
                x1={50}
                y1={18}
                x2={50}
                y2={6}
                stroke={color('streak')}
                strokeWidth={0.8}
              />
              <Polygon points="50,6 60,9 50,12" fill={color('streak')} />
            </Svg>
            <Bursts list={bursts} size={size} />
            {/* Web translate(-50%, -80%): 30% of its own height above centre. */}
            <Animated.View
              pointerEvents="none"
              style={[
                game.orb,
                at(size, spot.x, spot.y - 0.3 * 11, 11),
                !reduced && {
                  transitionProperty: 'transform',
                  transitionDuration: 100,
                  transitionTimingFunction: 'linear',
                },
              ]}
            />
            <Caption>{height >= 100 ? 'Top!' : 'Tap tap tap!'}</Caption>
          </>
        )}
      </Frame>
    </Pressable>
  );
}

function VoiceGame({ onWin }: GameProps) {
  const holding = useRef(false);
  const [level, setLevel] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1);
      setLevel(v => voiceStep(v, holding.current));
    }, VOICE_TICK_MS);
    return () => clearInterval(id);
  }, []);
  useWinOnce(level >= 100, onWin);
  const s = level / 100;
  const width = useFrameWidth();
  return (
    <Pressable
      style={width}
      onPressIn={() => {
        holding.current = true;
      }}
      onPressOut={() => {
        holding.current = false;
      }}
      accessibilityRole="button"
      accessibilityLabel="Press and hold"
    >
      <Frame>
        {size => {
          const ringBase = 0.3 * size;
          const mic = 0.26 * size;
          return (
            <>
              <Bar value={s} />
              {[0, 1, 2].map(i => {
                const d = ringBase + 0.12 * i * size;
                return (
                  <View
                    key={i}
                    pointerEvents="none"
                    style={[
                      game.ring,
                      {
                        width: d,
                        height: d,
                        left: (size - d) / 2,
                        top: (size - d) / 2,
                        opacity: 1 - i * 0.28,
                        // Grows by scale only (a transform, not a layout change).
                        transform: [{ scale: 1 + (s * 0.6 * size) / d }],
                      },
                    ]}
                  />
                );
              })}
              <View
                pointerEvents="none"
                className="items-center justify-center"
                style={[
                  game.orb,
                  {
                    width: mic,
                    height: mic,
                    transform: [
                      { translateX: (size - mic) / 2 },
                      { translateY: (size - mic) / 2 },
                      { scale: 1 + s * 0.25 },
                    ],
                  },
                ]}
              >
                <Svg
                  width={mic / 2}
                  height={mic / 2}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <Path
                    d={POWER_ICONS.voice}
                    stroke={color('ink')}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </Svg>
              </View>
              <View
                pointerEvents="none"
                className="absolute left-0 right-0 flex-row items-end justify-center gap-1"
                style={{ bottom: '14%', height: '12%' }}
              >
                {Array.from({ length: 9 }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      game.wave,
                      WAVE_GLOW,
                      {
                        height: '100%',
                        transform: [
                          {
                            scaleY:
                              0.1 +
                              s *
                                0.9 *
                                (0.4 +
                                  0.6 * Math.abs(Math.sin(tick * 0.3 + i))),
                          },
                        ],
                      },
                    ]}
                  />
                ))}
              </View>
              <View
                pointerEvents="none"
                className="absolute left-0 right-0 items-center"
                style={{ bottom: '4%' }}
              >
                <Text style={[game.caption, CAPTION_TEXT]}>
                  {level >= 100 ? 'So loud!' : 'Press and hold'}
                </Text>
              </View>
            </>
          );
        }}
      </Frame>
    </Pressable>
  );
}

function EnergyGame({ onWin }: GameProps) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [popped, setPopped] = useState(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const nextId = useRef(1);
  useEffect(() => {
    const id = setInterval(() => {
      setBubbles(list => {
        const next = energyTick(list, nextId.current);
        nextId.current = next.nextId;
        return next.bubbles;
      });
    }, ENERGY_TICK_MS);
    return () => clearInterval(id);
  }, []);
  useWinOnce(popped >= ENERGY_GOAL, onWin);
  const pop = (b: Bubble) => {
    setBubbles(list => list.filter(x => x.id !== b.id));
    setBursts(list => addBurst(list, b.x, b.y));
    setPopped(n => n + 1);
  };
  return (
    <Frame>
      {size => (
        <>
          <Sky />
          <Bar value={progress(popped, ENERGY_GOAL)} />
          <Bursts list={bursts} size={size} />
          {bubbles.map(b => (
            <Pressable
              key={b.id}
              onPressIn={() => pop(b)}
              accessibilityRole="button"
              accessibilityLabel="A bubble"
              style={[game.bubble, BUBBLE_GLOW, at(size, b.x, b.y, b.size)]}
            />
          ))}
          <Caption>
            {Math.min(popped, ENERGY_GOAL)} / {ENERGY_GOAL}
          </Caption>
        </>
      )}
    </Frame>
  );
}

const GAMES: Record<GameKey, React.ComponentType<GameProps>> = {
  focus: FocusGame,
  curious: CuriousGame,
  order: OrderGame,
  draw: DrawGame,
  climb: ClimbGame,
  voice: VoiceGame,
  energy: EnergyGame,
};

/** A power's game, by its `game`. */
export default function KidsGame({
  game: key,
  onWin,
}: GameProps & { game: GameKey }) {
  const Game = GAMES[key];
  return <Game onWin={onWin} />;
}
