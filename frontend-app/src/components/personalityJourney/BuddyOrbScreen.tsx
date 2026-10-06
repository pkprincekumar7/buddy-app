import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { font, rgb } from '@/theme';
import BuddyOrb from './BuddyOrb';
import { HEADING_ENTER, ORB_ENTER, dotBounce, fadeIn } from './animations';
import type { JourneyViewport } from './viewport';

const HEADING_SIZE = 28; // clamp(28px, 4vw, 42px) at phone width
const CYAN = rgb('constellation-cyan');
const DOT_DELAYS = [0, 0.15, 0.3] as const;
const DOTS = DOT_DELAYS.map(d => dotBounce(d));
const HINT_FADE = fadeIn(0.7, 0.5);
const TAP_TRANSITION = {
  transitionProperty: 'transform',
  transitionDuration: '0.15s',
} as const;

interface BuddyOrbScreenProps {
  childName: string;
  isAnalyzing: boolean;
  onTap: () => void;
  viewport: JourneyViewport;
}

/** Phase 1 — the Buddy 360 orb: heading above, tappable core, hint below. */
export default function BuddyOrbScreen({
  childName,
  isAnalyzing,
  onTap,
  viewport,
}: BuddyOrbScreenProps) {
  const { vh, orbRadius: r } = viewport;
  const orbSize = r * 2;
  // web: orb top = calc(50vh - 64px - clamp(100px, 36vmin, 150px))
  const orbTop = vh / 2 - 64 - r;
  // web: heading bottom pinned 32px above the orb top (top: …-32px + translateY(-100%))
  const headingBottom = vh - (orbTop - 32);

  return (
    <View style={{ minHeight: vh, width: '100%' }}>
      {/* Text above — heading bottom pinned 32px above orb top */}
      <View
        className="absolute left-0 right-0 px-6"
        style={{ bottom: headingBottom }}
      >
        <Animated.View style={HEADING_ENTER}>
          {isAnalyzing ? (
            <View className="items-center gap-4">
              <Text
                accessibilityRole="header"
                className="text-center text-white"
                style={[
                  font('orbitron', 700),
                  { fontSize: HEADING_SIZE, lineHeight: HEADING_SIZE * 1.25 },
                ]}
              >
                Preparing{' '}
                <Text style={{ color: CYAN }}>{childName}&apos;s</Text> profile
              </Text>
              <View className="flex-row gap-2">
                {DOTS.map((anim, i) => (
                  <Animated.View
                    key={i}
                    className="h-2 w-2 rounded-full bg-constellation-cyan-bright"
                    style={anim}
                  />
                ))}
              </View>
            </View>
          ) : (
            <Text
              accessibilityRole="header"
              className="text-center text-white"
              style={[
                font('orbitron', 900),
                { fontSize: HEADING_SIZE, lineHeight: HEADING_SIZE * 1.25 },
              ]}
            >
              Click here to begin your child&apos;s{' '}
              <Text style={{ color: CYAN }}>transformation</Text>
            </Text>
          )}
        </Animated.View>
      </View>

      {/* Orb centered at device vertical center (50vh) */}
      <View
        className="absolute"
        style={{ top: orbTop, left: 0, right: 0, alignItems: 'center' }}
      >
        <Animated.View style={ORB_ENTER}>
          <Pressable
            onPress={isAnalyzing ? undefined : onTap}
            disabled={isAnalyzing}
            accessibilityRole="button"
            accessibilityLabel={
              isAnalyzing
                ? 'Preparing profile'
                : 'Tap the core to enter the zone'
            }
            accessibilityState={{ disabled: isAnalyzing, busy: isAnalyzing }}
          >
            {({ pressed }) => (
              <Animated.View
                style={[
                  TAP_TRANSITION,
                  {
                    transform: [{ scale: pressed && !isAnalyzing ? 0.94 : 1 }],
                  },
                ]}
              >
                <BuddyOrb size={orbSize} />
              </Animated.View>
            )}
          </Pressable>
        </Animated.View>
      </View>

      {/* Text below orb — 32px gap below orb bottom */}
      {!isAnalyzing && (
        <Animated.View
          pointerEvents="none"
          className="absolute left-0 right-0 items-center"
          style={[{ top: vh / 2 - 64 + r + 32 }, HINT_FADE]}
        >
          <Text
            numberOfLines={1}
            className="font-bold uppercase text-constellation-slate-dark"
            style={{ fontSize: 12.5, letterSpacing: 12.5 * 0.22 }}
          >
            Tap the core to enter the zone
          </Text>
        </Animated.View>
      )}
    </View>
  );
}
