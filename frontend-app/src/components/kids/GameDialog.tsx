import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { X } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import { Portal } from '@/components/ui/portal';
import { font, rgb } from '@/theme';
import type { KidPower } from '@/api/discover';
import { GAME_PLAY, bestNote, gameSeconds, winLine } from '@/lib/kidsGames';
import { POWER_ICONS } from '@/components/kids/icons';
import KidsGame from '@/components/kids/KidsGames';
import {
  button,
  buttonOff,
  color,
  game,
  text,
} from '@/components/kids/palette';

/** How long the finished game stays on screen before "You did it!". */
const WIN_PAUSE_MS = 500;

/** `.kids-dialog-backdrop`'s veil (kids-bg / .8). */
const VEIL = { backgroundColor: rgb('kids-bg', 0.8) } as const;
/** `.kids-dialog`: max-h-full w-full max-w-xl p-5, scrolling when it's taller. */
const DIALOG = {
  width: '100%',
  maxWidth: 576,
  maxHeight: '100%',
  alignSelf: 'center',
  padding: 20,
} as const;
/** Orbitron bold (the dialog's headings and the time; web font-bold, not black). */
/** The how-to-play line: text-[15px] font-bold leading-snug text-kids-body. */
const PLAY_LINE = { color: rgb('kids-body'), lineHeight: 15 * 1.375 } as const;
const BOLD = { ...font('orbitron', 700), color: rgb('kids-text') } as const;

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
  const insets = useSafeAreaInsets();

  return (
    <Portal onRequestClose={onClose}>
      {/* Closes only for a press that starts on the backdrop itself: the dialog takes every
          touch that starts on it, so a drag out of the game never closes it. */}
      <Pressable
        testID="kids-dialog-backdrop"
        onPress={onClose}
        accessible={false}
        style={[
          game.backdrop,
          VEIL,
          {
            paddingTop: 16 + insets.top,
            paddingBottom: 16 + insets.bottom,
          },
        ]}
      >
        <View
          accessibilityViewIsModal
          accessibilityLabel={power.name}
          onStartShouldSetResponder={() => true}
          style={[game.dialog, DIALOG]}
        >
          <ScrollView bounces={false}>
            <View className="flex-row items-center gap-2.5">
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path
                  d={POWER_ICONS[power.game]}
                  stroke={color('discover')}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text
                accessibilityRole="header"
                className="flex-1 text-lg"
                style={BOLD}
              >
                {power.name}
              </Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="h-10 w-10 items-center justify-center"
                style={({ pressed }) => buttonOff(pressed)}
              >
                <X size={18} color={color('text')} />
              </Pressable>
            </View>

            {result && note ? (
              <View
                accessibilityLiveRegion="polite"
                className="items-center py-3"
              >
                <Text className="text-2xl" style={BOLD}>
                  You did it!
                </Text>
                <View className="mt-2.5 flex-row items-baseline gap-1.5">
                  <Text
                    className="text-4xl"
                    style={[BOLD, { color: color('streak') }]}
                  >
                    {result.secs.toFixed(1)}
                  </Text>
                  <Text
                    className="text-base uppercase"
                    style={[
                      text.label,
                      { color: color('streak'), letterSpacing: 16 * 0.18 },
                    ]}
                  >
                    sec
                  </Text>
                </View>
                <Text
                  className="mt-2 text-[15px]"
                  style={[text.label, { color: color('teal') }]}
                >
                  {note.text}
                </Text>
                <Text
                  className="mt-2.5 text-center text-[15px]"
                  style={text.body}
                >
                  {winLine(power.game, result.secs)}
                </Text>
                <View className="mt-5 flex-row flex-wrap justify-center gap-2.5">
                  <Pressable
                    onPress={again}
                    accessibilityRole="button"
                    accessibilityLabel="Play again"
                    className="h-11 items-center justify-center px-6"
                    style={({ pressed }) => button('discover', pressed)}
                  >
                    <Text
                      className="text-sm"
                      style={[text.heading, { color: color('ink') }]}
                    >
                      Play again
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Done"
                    className="h-11 items-center justify-center px-6"
                    style={({ pressed }) => buttonOff(pressed)}
                  >
                    {/* `.kids-btn-off`: Rajdhani bold. */}
                    <Text className="text-sm" style={text.label}>
                      Done
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <Text
                  className="my-3 text-[15px]"
                  style={[text.label, PLAY_LINE]}
                >
                  {GAME_PLAY[power.game]}
                </Text>
                <KidsGame key={round} game={power.game} onWin={win} />
              </>
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Portal>
  );
}
