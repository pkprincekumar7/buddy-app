import React, { useState, type ReactNode } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import Animated, {
  useReducedMotion,
  type CSSAnimationKeyframes,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Check, ChevronLeft } from 'lucide-react-native';
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
  WORLD_ORBS,
  color,
  scoreBar,
  worldCard,
  worldOrb,
  worldPick as pick,
  reportCard,
  growView as v,
  stepDot,
  playOrb,
  buttonGlow,
  buttonLine,
} from '@/components/kids/palette';
import { FLOAT, SPIN, enter, loop } from '@/components/kids/enter';
import GrowGame from '@/components/kids/GrowGames';

/** The round Play's glow breathing (web kids-pulse, the prototype's kPulse): a glow layer's
 * opacity, as RN can't animate box-shadow. */
const PULSE: CSSAnimationKeyframes = {
  '0%': { opacity: 0 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0 },
};

/** The child view's type scale (matched to the parent pages at phone width), in px. */
const s = {
  // text-[11px] font-bold uppercase tracking-[0.2em] text-kids-muted
  label: {
    ...font('rajdhani', 700),
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 11 * 0.2,
    textTransform: 'uppercase',
    color: color('muted'),
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

/** The web's phone grid (`mt-7 grid grid-cols-2 gap-3`): rows of two equal cells, 12px apart. */
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
    <View className="mt-7 gap-3">
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
  const reduced = useReducedMotion();
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
        <Animated.View style={enter('up', 0, reduced)}>
          <Animated.View style={[pick.eyebrow, enter('pop', 0, reduced)]}>
            <Text style={pick.eyebrowText}>Grow</Text>
          </Animated.View>
          <Text accessibilityRole="header" className="mt-4" style={pick.title}>
            Pick a <Text style={pick.glowWord}>world</Text>
          </Text>
          <Text className="mt-3" style={pick.lead}>
            Play three quick games right here.
          </Text>
        </Animated.View>
        <TwoColumns items={worlds.worlds}>
          {(item, i) => {
            const runs = runsOf(worlds, i);
            const last = runs[runs.length - 1];
            return (
              <Animated.View
                className="flex-1"
                style={enter('unfoldY', i * 0.08, reduced)}
              >
                <Pressable
                  onPress={() => start(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${
                    last ? `completed, last ${last.total}` : '3 games'
                  }`}
                  className="flex-1"
                  style={({ pressed }) => worldCard(pressed)}
                >
                  <Animated.View
                    style={[
                      { width: 88, height: 88 },
                      loop(FLOAT, 4, i * 0.5, 'ease-in-out', reduced),
                    ]}
                  >
                    <Animated.View
                      style={[pick.ring, loop(SPIN, 18, 0, 'linear', reduced)]}
                    />
                    <View
                      style={worldOrb(
                        WORLD_ORBS[i % WORLD_ORBS.length] ?? 'cyan',
                      )}
                    >
                      <Svg
                        width={38}
                        height={38}
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <Path
                          d={item.icon}
                          stroke={pick.ink}
                          strokeWidth={1.9}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                    </View>
                    {last ? (
                      <Animated.View
                        style={[pick.done, enter('pop', 0, reduced)]}
                      >
                        <Check size={14} color={pick.ink} strokeWidth={3.2} />
                      </Animated.View>
                    ) : null}
                  </Animated.View>
                  <Text style={pick.name}>{item.name}</Text>
                  {last ? (
                    <View className="items-center gap-1">
                      <Text style={[pick.tag, pick.tagDone]}>Completed</Text>
                      <Text
                        style={[
                          s.rajdhani(14, 20, 700),
                          { color: color('muted') },
                        ]}
                      >
                        Last: {last.total}
                      </Text>
                    </View>
                  ) : (
                    <Text style={pick.tag}>3 games</Text>
                  )}
                </Pressable>
              </Animated.View>
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
      <Animated.View style={enter('pop', 0, reduced, 0.45)}>
        <Animated.View
          style={[pick.eyebrow, v.pillGold, enter('pop', 0, reduced)]}
        >
          <Text style={[pick.eyebrowText, v.pillGoldText]}>
            {W.name} report
          </Text>
        </Animated.View>
        <Text accessibilityRole="header" className="mt-4" style={pick.title}>
          World <Text style={v.goldGlow}>complete!</Text>
        </Text>
        <Animated.View
          className="mt-6 self-center"
          style={[
            { width: 128, height: 128 },
            loop(FLOAT, 3.4, 0, 'ease-in-out', reduced),
          ]}
        >
          <View
            style={[
              worldOrb(WORLD_ORBS[world % WORLD_ORBS.length] ?? 'cyan'),
              v.reportOrb,
            ]}
          >
            <Svg width={56} height={56} viewBox="0 0 24 24" fill="none">
              <Path
                d={W.icon}
                stroke={pick.ink}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
        </Animated.View>
        <View
          accessibilityLiveRegion="polite"
          className="mt-5 items-center"
          style={reportCard}
        >
          <Text style={[s.orbitron(48, 48), { color: color('streak') }]}>
            {report.total}
          </Text>
          {band ? (
            <Text
              className="mt-2"
              style={[
                s.orbitron(18, 24),
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
        <View className="mt-5 gap-3">
          {W.games.map((g, j) => {
            const r = results[j];
            const b = bandFor(r?.score ?? 0, worlds.bands);
            const bc = b ? BAND_COLOR[b.color] : 'discover';
            const bar = scoreBar(bc, r?.score ?? 0);
            return (
              <View key={g.title} style={reportCard}>
                <View className="flex-row items-baseline justify-between gap-3">
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
                <View className="mt-3" style={bar.track}>
                  <View style={bar.fill} />
                </View>
              </View>
            );
          })}
        </View>
        <View className="mt-5 gap-3">
          <View style={reportCard}>
            <Text style={s.label}>Strongest</Text>
            <Text className="mt-1" style={s.orbitron(16, 22)}>
              {strongest?.skill}
            </Text>
          </View>
          <View style={reportCard}>
            <Text style={s.label}>Keep practising</Text>
            <Text className="mt-1" style={s.orbitron(16, 22)}>
              {weakest?.skill}
            </Text>
            <Text className="mt-1" style={s.rajdhani(15, 21)}>
              {weakest?.tip}
            </Text>
          </View>
        </View>
        <View className="mt-5" style={reportCard}>
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
        <View className="mt-7 items-center gap-4">
          <Pressable
            onPress={() => start(world)}
            accessibilityRole="button"
            accessibilityLabel="Play again"
            className="h-11 items-center justify-center px-6"
            style={({ pressed }) => buttonLine(pressed)}
          >
            <Text style={[v.btnText, v.btnLineText]}>Play again</Text>
          </Pressable>
          <Pressable
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel="Pick another world"
            className="px-[18px] py-2"
          >
            <Text style={v.link}>Pick another world</Text>
          </Pressable>
        </View>
      </Animated.View>
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
    <Animated.View
      key={`${world}-${step}`}
      style={enter('up', 0, reduced, 0.4)}
    >
      <View className="flex-row items-center justify-center gap-3">
        <Pressable
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel="Back to worlds"
          style={v.back}
        >
          <ChevronLeft size={18} strokeWidth={2.4} color={v.backIcon} />
        </Pressable>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Game ${step + 1} of 3`}
          className="flex-row gap-3"
        >
          {[0, 1, 2].map(j => (
            <View
              key={j}
              style={stepDot(j < step ? 'done' : j === step ? 'now' : 'next')}
            />
          ))}
        </View>
      </View>
      <View className="mt-4 flex-row flex-wrap justify-center gap-2.5">
        <Animated.View style={[pick.eyebrow, enter('pop', 0, reduced)]}>
          <Text style={pick.eyebrowText}>{W.name}</Text>
        </Animated.View>
        <Animated.View
          style={[pick.eyebrow, v.pillGold, enter('pop', 0, reduced)]}
        >
          <Text style={[pick.eyebrowText, v.pillGoldText]}>
            Game {step + 1} of 3
          </Text>
        </Animated.View>
      </View>
      <Text accessibilityRole="header" className="mt-3.5" style={v.title}>
        {G.title}
      </Text>
      <Text className="mt-2.5" style={pick.lead}>
        {G.how}
      </Text>

      {phase === 'intro' ? (
        <Animated.View className="mt-6" style={enter('pop', 0, reduced, 0.45)}>
          <View style={v.intro}>
            <Text style={v.skill}>{G.skill}</Text>
            <View>
              <Animated.View
                pointerEvents="none"
                style={[
                  v.playGlow,
                  reduced ? { opacity: 0 } : null,
                  loop(PULSE, 1.6, 0, 'ease-in-out', reduced),
                ]}
              />
              <Pressable
                onPress={replay}
                accessibilityRole="button"
                accessibilityLabel="Play"
                style={({ pressed }) => playOrb(pressed)}
              >
                <Svg width={36} height={36} viewBox="0 0 24 24">
                  <Path d="M8 5.5v13l10.5-6.5z" fill={v.playInk} />
                </Svg>
                <Text style={v.playText}>Play</Text>
              </Pressable>
            </View>
            <Text style={v.note}>
              {playedBefore ? 'Played before' : 'New game'}
            </Text>
          </View>
        </Animated.View>
      ) : null}
      {phase === 'play' ? (
        <Animated.View className="mt-5" style={enter('up', 0, reduced, 0.4)}>
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
        </Animated.View>
      ) : null}
      {phase === 'result' && result ? (
        <>
          <Animated.View
            accessibilityLiveRegion="polite"
            className="mt-6"
            style={[v.result, enter('pop', 0, reduced, 0.45)]}
          >
            <Animated.View style={[v.checkOrb, enter('pop', 0, reduced)]}>
              <Check size={40} strokeWidth={3} color={pick.ink} />
            </Animated.View>
            <Text className="mt-4" style={[s.orbitron(28, 34), v.goldGlow]}>
              Well done!
            </Text>
            <Text className="mt-2" style={v.score}>
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
              style={[s.rajdhani(17, 23), { textAlign: 'center' }]}
            >
              {result.line}
            </Text>
          </Animated.View>
          <View className="mt-5 flex-row flex-wrap justify-center gap-3.5">
            {step < 2 ? (
              <Pressable
                onPress={() => {
                  setStep(step + 1);
                  setPhase('intro');
                }}
                accessibilityRole="button"
                accessibilityLabel="Next game"
                className="h-11 items-center justify-center px-7"
                style={({ pressed }) => buttonGlow(pressed)}
              >
                <Text style={[v.btnText, v.btnGlowText]}>Next game</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void finishWorld()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={saving ? 'Saving' : 'Finish world'}
                accessibilityState={{ disabled: saving }}
                className="h-11 items-center justify-center px-7"
                style={({ pressed }) => [
                  buttonGlow(pressed),
                  saving && { opacity: 0.6 },
                ]}
              >
                <Text style={[v.btnText, v.btnGlowText]}>
                  {saving ? 'Saving…' : 'Finish world'}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={replay}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              className="h-11 items-center justify-center px-6"
              style={({ pressed }) => buttonLine(pressed)}
            >
              <Text style={[v.btnText, v.btnLineText]}>Try again</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </Animated.View>
  );
}
