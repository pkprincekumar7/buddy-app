import React, { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { font, rgb } from '@/theme';
import BuddyOrb from './BuddyOrb';
import {
  HEADING_ENTER,
  ORB_ENTER,
  dotBounce,
  fadeIn,
  preEnter,
} from './animations';
import type { JourneyViewport } from './viewport';

const HEADING_SIZE = 28; // clamp(28px, 4vw, 42px) at phone width
/** The heading's gap above the orb, and its least room below the screen's top (web). */
const HEADING_GAP = 20;
const HEADING_MARGIN = 4;
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
  /** How far the window's centre (the warp's) lies below this screen's top: the orb's centre. */
  centerY: number;
}

/** The eyebrow and the heading over the orb, at `fontSize` (the heading's own size). */
function OrbHeading({
  childName,
  isAnalyzing,
  fontSize,
  onEyebrowLayout,
  onTitleLayout,
}: {
  childName: string;
  isAnalyzing: boolean;
  fontSize: number;
  onEyebrowLayout?: (e: LayoutChangeEvent) => void;
  onTitleLayout?: (e: LayoutChangeEvent) => void;
}) {
  const title = [
    font('orbitron', 700),
    { fontSize, lineHeight: fontSize * 1.25 },
  ];
  return (
    <>
      {/* The prototype's eyebrow over the heading (web). */}
      <Text
        onLayout={onEyebrowLayout}
        className="mb-4 text-center uppercase text-constellation-cyan-bright"
        style={[
          font('rajdhani', 700),
          // The spacing trails the last letter too; as much on the left keeps it centred.
          { fontSize: 12, letterSpacing: 12 * 0.4, paddingLeft: 12 * 0.4 },
        ]}
      >
        Your child&apos;s next chapter
      </Text>
      {isAnalyzing ? (
        <View className="items-center gap-4">
          <Text
            accessibilityRole="header"
            className="text-center text-white"
            style={title}
            onLayout={onTitleLayout}
          >
            Preparing <Text style={{ color: CYAN }}>{childName}&apos;s</Text>{' '}
            profile
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
          style={title}
          onLayout={onTitleLayout}
        >
          Click here to begin your child&apos;s{' '}
          <Text style={{ color: CYAN }}>transformation</Text>
        </Text>
      )}
    </>
  );
}

/** A copy of the heading that's laid out but never seen or read (the sizer, the probe). */
const UNSEEN = {
  // As wide as the heading shown (its px-6), in plain style: a className passed in a spread
  // object isn't applied, and a wider copy would take fewer lines.
  style: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 24,
    opacity: 0,
  },
  pointerEvents: 'none',
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/** Phase 1 — the Buddy orb: heading above, tappable core, hint below. */
export default function BuddyOrbScreen({
  childName,
  isAnalyzing,
  onTap,
  viewport,
  centerY,
}: BuddyOrbScreenProps) {
  const { vh, orbRadius } = viewport;
  // Transparent until each entrance takes hold (animations.preEnter).
  const hidden = preEnter(useReducedMotion());
  // The radius (viewport.orbRadius) also leaves the heading room above it: 20px
  // over the orb and 4px inside the screen, now that the orb sits on the window's centre.
  // That room is the block's at HEADING_SIZE, measured on an unseen copy (the sizer), so the
  // orb keeps its size and place. It starts at three heading lines, its usual height at phone
  // width, so the first frame doesn't show a larger orb that then shrinks.
  const [headingH, setHeadingH] = useState(HEADING_SIZE * 1.25 * 3);
  // The block shown is at least one eyebrow shorter, so the eyebrow sits that much lower, clear
  // of the screen's top (it was cut there on a short Android phone), and its bottom stays 20px
  // over the orb: its heading is the largest that fits the copy's height less the eyebrow's.
  // Text is measured a layout at a time, so the size is found over a few frames on a second
  // copy (the probe), from one sure to fit (`fit`, the copy's lines each shorter by as much)
  // up to HEADING_SIZE. A heading shrinks a line at a time, so where a smaller one takes fewer
  // lines the eyebrow comes down further.
  const [eyebrowH, setEyebrowH] = useState(0);
  const [titleH, setTitleH] = useState(0);
  const room = titleH - eyebrowH;
  const lines = Math.max(1, Math.round(titleH / (HEADING_SIZE * 1.25)));
  const fit = HEADING_SIZE - eyebrowH / (lines * 1.25);
  // The search: sizes up to `lo` fit, from `hi` they don't; the probe tries the middle.
  const [search, setSearch] = useState<{
    room: number;
    lo: number;
    hi: number;
  } | null>(null);
  if (eyebrowH > 0 && titleH > 0 && search?.room !== room) {
    setSearch({ room, lo: fit, hi: HEADING_SIZE });
  }
  const searching = search !== null && search.hi - search.lo > 0.25;
  const probeSize = search ? (search.lo + search.hi) / 2 : HEADING_SIZE;
  const titleSize = search ? search.lo : HEADING_SIZE;
  const onProbe = (e: LayoutChangeEvent) => {
    if (!search || !searching) return;
    const fits = e.nativeEvent.layout.height <= search.room;
    setSearch({ ...search, [fits ? 'lo' : 'hi']: probeSize });
  };
  const r = Math.max(
    100,
    Math.min(orbRadius, centerY - headingH - HEADING_GAP - HEADING_MARGIN),
  );
  const orbSize = r * 2;
  const orbTop = centerY - r;
  // web: the heading's bottom HEADING_GAP above the orb's top
  const headingBottom = vh - (orbTop - HEADING_GAP);

  return (
    <View style={{ minHeight: vh, width: '100%' }}>
      {/* The sizer: the block at HEADING_SIZE, for the orb's room (above). */}
      <View
        {...UNSEEN}
        onLayout={e => setHeadingH(e.nativeEvent.layout.height)}
      >
        <OrbHeading
          childName={childName}
          isAnalyzing={isAnalyzing}
          fontSize={HEADING_SIZE}
          onEyebrowLayout={e => setEyebrowH(e.nativeEvent.layout.height)}
          onTitleLayout={e => setTitleH(e.nativeEvent.layout.height)}
        />
      </View>
      {/* The probe: the heading at the size being tried, until it's found (above). */}
      {searching ? (
        <View {...UNSEEN} key={probeSize}>
          <OrbHeading
            childName={childName}
            isAnalyzing={isAnalyzing}
            fontSize={probeSize}
            onTitleLayout={onProbe}
          />
        </View>
      ) : null}
      {/* Text above: the eyebrow and heading, their bottom HEADING_GAP above the orb */}
      <View
        className="absolute left-0 right-0 px-6"
        style={{ bottom: headingBottom }}
      >
        <Animated.View style={[hidden, HEADING_ENTER]}>
          <OrbHeading
            childName={childName}
            isAnalyzing={isAnalyzing}
            fontSize={titleSize}
          />
        </Animated.View>
      </View>

      {/* Orb centered at device vertical center (50vh) */}
      <View
        className="absolute"
        style={{ top: orbTop, left: 0, right: 0, alignItems: 'center' }}
      >
        <Animated.View style={[hidden, ORB_ENTER]}>
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
          style={[{ top: centerY + r + 32 }, hidden, HINT_FADE]}
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
