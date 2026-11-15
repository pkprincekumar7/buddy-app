import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useReducedMotion,
  type CSSAnimationKeyframes,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Check, X } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import { Portal } from '@/components/ui/portal';
import type { KidPower } from '@/api/discover';
import { GAME_PLAY, bestNote, gameSeconds, winLine } from '@/lib/kidsGames';
import { POWER_ICONS } from '@/components/kids/icons';
import KidsGame from '@/components/kids/KidsGames';
import {
  buttonGlow,
  buttonLine,
  color,
  dialog as d,
  game,
  growView,
} from '@/components/kids/palette';
import { enter, loop } from '@/components/kids/enter';

/** How long the finished game stays on screen before "You did it!". */
const WIN_PAUSE_MS = 500;

/** `.kids-dialog`: max-h-full w-full max-w-[540px], scrolling when it's taller. */
const DIALOG = {
  width: '100%',
  maxWidth: 540,
  maxHeight: '100%',
  alignSelf: 'center',
} as const;

/** The four twinkling dots round the win (web WIN_DOTS): where, how big, gold or cyan, and
 * their own pace. */
const WIN_DOTS = [
  {
    at: { left: '12%', top: '10%' },
    size: 10,
    gold: true,
    secs: 1.2,
    delay: 0,
  },
  {
    at: { right: '14%', top: '18%' },
    size: 8,
    gold: false,
    secs: 1,
    delay: 0.3,
  },
  {
    at: { left: '22%', top: '46%' },
    size: 6,
    gold: false,
    secs: 1.4,
    delay: 0.6,
  },
  {
    at: { right: '20%', top: '52%' },
    size: 9,
    gold: true,
    secs: 1.1,
    delay: 0.2,
  },
] as const;
/** web kids-twinkle. */
const TWINKLE: CSSAnimationKeyframes = {
  '0%': { opacity: 0.25 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.25 },
};
/** The medallion's glow breathing (web kids-pulse): a glow layer's opacity. */
const PULSE: CSSAnimationKeyframes = {
  '0%': { opacity: 0 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0 },
};

interface GameDialogProps {
  power: KidPower;
  /** The saved best time for this game, if any. */
  best: number | undefined;
  onClose: () => void;
  /** A finished round's time; the page saves it when it's a new best. */
  onFinish: (seconds: number) => void;
}

/**
 * A power's mini game (web components/kids/GameDialog) over the whole app, in a Portal (no
 * native Modal to dismiss when it closes): the game, then the time, "New best!" or the best
 * so far, and "Play again". ×, Android Back or a press on the backdrop closes it.
 */
export default function GameDialog({
  power,
  best,
  onClose,
  onFinish,
}: GameDialogProps) {
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<{
    secs: number;
    previous: number | undefined;
  } | null>(null);
  const startedAt = useRef(Date.now());
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pause.current), []);

  const win = () => {
    const secs = gameSeconds(startedAt.current, Date.now());
    const previous = best;
    if (bestNote(secs, previous).isBest) onFinish(secs);
    pause.current = setTimeout(
      () => setResult({ secs, previous }),
      WIN_PAUSE_MS,
    );
  };

  const again = () => {
    startedAt.current = Date.now();
    setResult(null);
    setRound(r => r + 1);
  };

  const note = result ? bestNote(result.secs, result.previous) : null;
  // "New best!" (gold) beats a time from before; a first try is no record yet.
  const newBest = !!note?.isBest && result?.previous !== undefined;
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  return (
    <Portal onRequestClose={onClose}>
      {/* The veil rises in (.25 s), the panel pops (.35 s). */}
      <Animated.View style={[{ flex: 1 }, enter('up', 0, reduced, 0.25)]}>
        {/* Closes only for a press that starts on the backdrop itself: the dialog takes every
            touch that starts on it, so a drag out of the game never closes it. */}
        <Pressable
          testID="kids-dialog-backdrop"
          onPress={onClose}
          accessible={false}
          style={[
            game.backdrop,
            {
              paddingTop: 20 + insets.top,
              paddingBottom: 20 + insets.bottom,
            },
          ]}
        >
          <Animated.View
            accessibilityViewIsModal
            accessibilityLabel={power.name}
            onStartShouldSetResponder={() => true}
            style={[game.dialog, DIALOG, enter('pop', 0, reduced, 0.35)]}
          >
            <ScrollView bounces={false}>
              <View className="flex-row items-center gap-3.5">
                <View style={d.icon}>
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                    <Path
                      d={POWER_ICONS[power.game]}
                      stroke={color('discover')}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>
                <Text
                  accessibilityRole="header"
                  style={[d.title, { flexShrink: 1 }]}
                >
                  {power.name}
                </Text>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={d.close}
                >
                  <X size={20} strokeWidth={2.4} color={d.ink} />
                </Pressable>
              </View>

              {result && note ? (
                <View
                  accessibilityLiveRegion="polite"
                  className="px-1.5 pb-1 pt-3"
                >
                  {WIN_DOTS.map((dot, i) => (
                    <Animated.View
                      key={i}
                      pointerEvents="none"
                      style={[
                        {
                          position: 'absolute',
                          ...dot.at,
                          width: dot.size,
                          height: dot.size,
                          borderRadius: dot.size / 2,
                          backgroundColor: color(
                            dot.gold ? 'gold' : 'discover',
                          ),
                        },
                        loop(
                          TWINKLE,
                          dot.secs,
                          dot.delay,
                          'ease-in-out',
                          reduced,
                        ),
                      ]}
                    />
                  ))}
                  <Animated.View
                    className="self-center"
                    style={enter('pop', 0, reduced, 0.5)}
                  >
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        d.medalGlow,
                        reduced ? { opacity: 0 } : null,
                        loop(PULSE, 1.6, 0, 'ease-in-out', reduced),
                      ]}
                    />
                    <View style={d.medal}>
                      <Check size={36} strokeWidth={2.6} color={d.ink} />
                    </View>
                  </Animated.View>
                  <Text className="mt-3 text-center" style={d.won}>
                    You did it!
                  </Text>
                  <View className="mt-2.5 flex-row items-baseline justify-center gap-2">
                    <Text style={d.time}>{result.secs.toFixed(1)}</Text>
                    <Text style={d.sec}>sec</Text>
                  </View>
                  <View className="mt-2 min-h-[26px] flex-row justify-center">
                    {newBest ? (
                      // Pops in a moment after the rest (web .3 s delay).
                      <Animated.View
                        style={[
                          d.pill,
                          d.pillBest,
                          enter('pop', 0.3, reduced, 0.5),
                        ]}
                      >
                        <Text style={[d.pillText, d.pillBestText]}>
                          {note.text}
                        </Text>
                      </Animated.View>
                    ) : (
                      <View style={d.pill}>
                        <Text style={d.pillText}>{note.text}</Text>
                      </View>
                    )}
                  </View>
                  <View className="mt-3" style={d.line}>
                    <Text style={d.lineText}>
                      {winLine(power.game, result.secs)}
                    </Text>
                  </View>
                  <View className="mt-3 flex-row flex-wrap justify-center gap-2.5">
                    <Pressable
                      onPress={again}
                      accessibilityRole="button"
                      accessibilityLabel="Play again"
                      className="h-11 items-center justify-center px-5"
                      style={({ pressed }) => [
                        buttonLine(pressed),
                        { borderColor: color('discover') },
                      ]}
                    >
                      <Text style={[growView.btnText, growView.btnLineText]}>
                        Play again
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={onClose}
                      accessibilityRole="button"
                      accessibilityLabel="Done"
                      className="h-11 items-center justify-center px-6"
                      style={({ pressed }) => buttonGlow(pressed)}
                    >
                      <Text style={[growView.btnText, growView.btnGlowText]}>
                        Done
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <Text className="mb-4 mt-3.5" style={d.play}>
                    {GAME_PLAY[power.game]}
                  </Text>
                  <KidsGame key={round} game={power.game} onWin={win} />
                </>
              )}
            </ScrollView>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Portal>
  );
}
