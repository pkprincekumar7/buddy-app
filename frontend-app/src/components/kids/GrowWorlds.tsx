import React, { useState, type ReactNode } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ArrowLeft, Check, Play } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import { font } from '@/theme';
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
import {
  POWER_COLORS,
  button,
  buttonOff,
  card,
  color,
  scoreBar,
  tile,
} from '@/components/kids/palette';
import GrowGame from '@/components/kids/GrowGames';

const worldColor = (i: number) =>
  POWER_COLORS[i % POWER_COLORS.length] ?? 'discover';

/** Grow's circle colour: the web's --kids-area on this tab (.kids-btn, .kids-card, text-kids-area). */
const AREA = 'grow';

/** The child view's type scale (matched to the parent pages at phone width), in px. */
const s = {
  // text-xs font-bold uppercase tracking-[0.3em] text-kids-area
  eyebrow: {
    ...font('rajdhani', 700),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 12 * 0.3,
    textTransform: 'uppercase',
    textAlign: 'center',
    color: color(AREA),
  },
  // font-orbitron text-3xl font-black leading-tight
  title: {
    ...font('orbitron', 900),
    fontSize: 30,
    lineHeight: 30 * 1.25,
    textAlign: 'center',
    color: color('text'),
  },
  // max-w-xl text-[17px] font-semibold leading-snug text-kids-body
  lead: {
    ...font('rajdhani', 600),
    fontSize: 17,
    lineHeight: 17 * 1.375,
    maxWidth: 576,
    alignSelf: 'center',
    textAlign: 'center',
    color: color('body'),
  },
  // text-[11px] font-bold uppercase tracking-[0.2em] text-kids-muted
  label: {
    ...font('rajdhani', 700),
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 11 * 0.2,
    textTransform: 'uppercase',
    color: color('muted'),
  },
  // .kids-btn text-sm
  btn: {
    ...font('orbitron', 900),
    fontSize: 14,
    lineHeight: 20,
    color: color('ink'),
  },
  // .kids-btn-off text-sm
  btnOff: {
    ...font('rajdhani', 700),
    fontSize: 14,
    lineHeight: 20,
    color: color('text'),
  },
  orbitron: (size: number, lineHeight: number) =>
    ({
      ...font('orbitron', 900),
      fontSize: size,
      lineHeight,
      color: color('text'),
    } satisfies TextStyle),
  rajdhani: (size: number, lineHeight: number, weight = 600) =>
    ({
      ...font('rajdhani', weight),
      fontSize: size,
      lineHeight,
      color: color('body'),
    } satisfies TextStyle),
} satisfies Record<string, TextStyle | ((...a: number[]) => TextStyle)>;

/** The web's `grid grid-cols-2 gap-3`: rows of two equal cells, 12px apart. */
function TwoColumns<T>({
  items,
  children,
}: {
  items: readonly T[];
  children: (item: T, i: number) => ReactNode;
}) {
  const rows: number[][] = [];
  items.forEach((_, i) => {
    if (i % 2 === 0) rows.push([i]);
    else rows[rows.length - 1]?.push(i);
  });
  return (
    <View className="mt-6 gap-3">
      {rows.map(row => (
        <View key={row[0]} className="flex-row gap-3">
          {row.map(i => {
            const item = items[i];
            return item === undefined ? null : (
              <View key={i} className="flex-1">
                {children(item, i)}
              </View>
            );
          })}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}

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
 * Grow in child view (web components/kids/GrowWorlds): pick a world, play its three games,
 * then the world's report, saved as a run (grow keeps the last 10).
 */
export default function GrowWorlds({
  worlds,
  saving,
  addRun,
  awaitProgress,
}: GrowWorldsProps) {
  const [world, setWorld] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<GrowResult[]>([]);
  const [report, setReport] = useState<{
    total: number;
    previous: number | null;
  } | null>(null);

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
      <View>
        <Text style={s.eyebrow}>Grow</Text>
        <Text accessibilityRole="header" className="mt-2.5" style={s.title}>
          Pick a <Text style={{ color: color(AREA) }}>world</Text>
        </Text>
        <Text className="mt-3" style={s.lead}>
          Play three quick games right here.
        </Text>
        <TwoColumns items={worlds.worlds}>
          {(w, i) => {
            const runs = runsOf(worlds, i);
            const last = runs[runs.length - 1];
            const c = worldColor(i);
            return (
              <Pressable
                onPress={() => start(i)}
                accessibilityRole="button"
                accessibilityLabel={w.name}
                className="min-h-[120px] flex-1 items-center justify-center gap-2 px-3"
                style={({ pressed }) => tile(c, false, pressed)}
              >
                <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
                  <Path
                    d={w.icon}
                    stroke={color(c)}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
                <Text style={[s.orbitron(16, 22), { textAlign: 'center' }]}>
                  {w.name}
                </Text>
                <Text
                  style={[s.rajdhani(15, 21, 700), { color: color('muted') }]}
                >
                  {last ? `Last: ${last.total}` : '3 games'}
                </Text>
                {last ? (
                  <View
                    accessible
                    accessibilityLabel="Played"
                    className="absolute right-2.5 top-2.5"
                  >
                    <Check size={20} color={color('teal')} />
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        </TwoColumns>
      </View>
    );
  }

  const W = worlds.worlds[world];
  if (!W) return null;

  if (report) {
    const order = rankedGames(results.map(r => r.score));
    const strongest = W.games[order[0] ?? 0];
    const weakest = W.games[order[order.length - 1] ?? 0];
    const band = bandFor(report.total, worlds.bands);
    return (
      <View>
        <Text style={s.eyebrow}>{W.name} report</Text>
        <Text accessibilityRole="header" className="mt-2.5" style={s.title}>
          World <Text style={{ color: color(AREA) }}>complete!</Text>
        </Text>
        <View
          accessibilityLiveRegion="polite"
          className="mt-6 items-center"
          style={card(AREA)}
        >
          <Text style={[s.orbitron(48, 48), { color: color('streak') }]}>
            {report.total}
          </Text>
          {band ? (
            <Text
              className="mt-2"
              style={[
                s.orbitron(16, 22),
                { color: color(BAND_COLOR[band.color]) },
              ]}
            >
              {band.label}
            </Text>
          ) : null}
          <Text
            className="mt-2"
            style={[s.rajdhani(15, 21, 700), { textAlign: 'center' }]}
          >
            {trendLine(report.total, report.previous)}
          </Text>
        </View>
        <View className="mt-5 gap-2.5">
          {W.games.map((g, j) => {
            const r = results[j];
            const b = bandFor(r?.score ?? 0, worlds.bands);
            const bc = b ? BAND_COLOR[b.color] : 'discover';
            const bar = scoreBar(bc, r?.score ?? 0);
            return (
              <View key={g.title} style={card(AREA)}>
                <View className="flex-row items-baseline justify-between gap-2.5">
                  <Text className="flex-1" style={s.orbitron(16, 22)}>
                    {g.title}
                  </Text>
                  <Text style={[s.orbitron(20, 26), { color: color(bc) }]}>
                    {r?.score ?? 0}
                  </Text>
                </View>
                <Text
                  className="mt-1"
                  style={[s.rajdhani(15, 21), { color: color('muted') }]}
                >
                  {r?.line}
                </Text>
                <View className="mt-2.5" style={bar.track}>
                  <View style={bar.fill} />
                </View>
              </View>
            );
          })}
        </View>
        <View className="mt-5 gap-2.5">
          <View style={card(AREA)}>
            <Text style={s.label}>Strongest</Text>
            <Text className="mt-1" style={s.orbitron(16, 22)}>
              {strongest?.skill}
            </Text>
          </View>
          <View style={card(AREA)}>
            <Text style={s.label}>Keep practising</Text>
            <Text className="mt-1" style={s.orbitron(16, 22)}>
              {weakest?.skill}
            </Text>
            <Text className="mt-1" style={s.rajdhani(15, 21)}>
              {weakest?.tip}
            </Text>
          </View>
        </View>
        <View className="mt-5" style={card(AREA)}>
          <Text style={s.label}>Your mission</Text>
          <Text
            className="mt-1"
            style={[s.rajdhani(16, 22, 700), { color: color('text') }]}
          >
            {W.mission}
          </Text>
          <Text className="mt-1" style={s.rajdhani(15, 21)}>
            {W.hint}
          </Text>
        </View>
        <View className="mt-6 flex-row flex-wrap justify-center gap-2.5">
          <Pressable
            onPress={() => start(world)}
            accessibilityRole="button"
            accessibilityLabel="Play again"
            className="h-11 items-center justify-center px-6"
            style={({ pressed }) => button(AREA, pressed)}
          >
            <Text style={s.btn}>Play again</Text>
          </Pressable>
          <Pressable
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel="Pick another world"
            className="h-11 items-center justify-center px-6"
            style={({ pressed }) => buttonOff(pressed)}
          >
            <Text style={s.btnOff}>Pick another world</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const G = W.games[step];
  if (!G) return null;
  const result = results[step];
  const resultBand = result ? bandFor(result.score, worlds.bands) : null;

  const finishWorld = async () => {
    const runs = runsOf(worlds, world);
    const previous = runs[runs.length - 1]?.total ?? null;
    const scores = results.map(r => r.score);
    const saved = await addRun(world, scores);
    if (saved) awaitProgress(activity => activity.circles_done.grow);
    const mine = saved ? runsOf(saved, world) : [];
    setReport({
      total:
        mine[mine.length - 1]?.total ??
        Math.round(scores.reduce((a, b) => a + b, 0) / 3),
      previous,
    });
  };
  const replay = () => {
    setRound(r => r + 1);
    setPhase('play');
  };

  return (
    <View>
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel="Back to worlds"
          className="h-10 w-10 items-center justify-center"
          style={({ pressed }) => buttonOff(pressed)}
        >
          <ArrowLeft size={18} color={color('text')} />
        </Pressable>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Game ${step + 1} of 3`}
          className="flex-row gap-2"
        >
          {[0, 1, 2].map(j => (
            <View
              key={j}
              className="h-2.5 w-8 rounded-full"
              style={{
                backgroundColor:
                  j < step
                    ? color('streak')
                    : j === step
                    ? color('discover')
                    : color('off'),
              }}
            />
          ))}
        </View>
      </View>
      <Text
        className="mt-5"
        style={[
          s.eyebrow,
          {
            fontSize: 11,
            lineHeight: 16,
            letterSpacing: 11 * 0.25,
            textAlign: 'left',
          },
        ]}
      >
        {W.name} · Game {step + 1} of 3
      </Text>
      <Text
        accessibilityRole="header"
        className="mt-2"
        style={s.orbitron(24, 30)}
      >
        {G.title}
      </Text>
      <Text className="mt-2.5" style={s.rajdhani(15, 21)}>
        {G.how}
      </Text>

      {phase === 'intro' ? (
        <View className="mt-5 items-center" style={card(AREA)}>
          <Text style={[s.label, { textAlign: 'center' }]}>{G.skill}</Text>
          <Pressable
            onPress={replay}
            accessibilityRole="button"
            accessibilityLabel="Play"
            className="mt-3 h-11 flex-row items-center justify-center gap-1.5 px-6"
            style={({ pressed }) => button(AREA, pressed)}
          >
            <Play size={16} color={color('ink')} />
            <Text style={s.btn}>Play</Text>
          </Pressable>
        </View>
      ) : null}
      {phase === 'play' ? (
        <View className="mt-5">
          <GrowGame
            key={round}
            type={G.type}
            cfg={G.cfg}
            onDone={r => {
              setResults(all => {
                const next = [...all];
                next[step] = r;
                return next;
              });
              setPhase('result');
            }}
          />
        </View>
      ) : null}
      {phase === 'result' && result ? (
        <View
          accessibilityLiveRegion="polite"
          className="mt-5 items-center"
          style={card(AREA)}
        >
          <Text style={s.orbitron(20, 26)}>Well done!</Text>
          <Text
            className="mt-2"
            style={[s.orbitron(36, 36), { color: color('streak') }]}
          >
            {result.score}
          </Text>
          {resultBand ? (
            <Text
              className="mt-1"
              style={[
                s.orbitron(16, 22),
                { color: color(BAND_COLOR[resultBand.color]) },
              ]}
            >
              {resultBand.label}
            </Text>
          ) : null}
          <Text
            className="mt-2"
            style={[s.rajdhani(15, 21), { textAlign: 'center' }]}
          >
            {result.line}
          </Text>
          <View className="mt-4 flex-row flex-wrap justify-center gap-2.5">
            {step < 2 ? (
              <Pressable
                onPress={() => {
                  setStep(step + 1);
                  setPhase('intro');
                }}
                accessibilityRole="button"
                accessibilityLabel="Next game"
                className="h-11 items-center justify-center px-6"
                style={({ pressed }) => button(AREA, pressed)}
              >
                <Text style={s.btn}>Next game</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void finishWorld()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={saving ? 'Saving' : 'Finish world'}
                accessibilityState={{ disabled: saving }}
                className="h-11 items-center justify-center px-6"
                style={({ pressed }) => [
                  button(AREA, pressed),
                  saving && { opacity: 0.5 },
                ]}
              >
                <Text style={s.btn}>{saving ? 'Saving…' : 'Finish world'}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={replay}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              className="h-11 items-center justify-center px-6"
              style={({ pressed }) => buttonOff(pressed)}
            >
              <Text style={s.btnOff}>Try again</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
