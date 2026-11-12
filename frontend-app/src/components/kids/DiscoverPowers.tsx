import React, { useMemo, useState } from 'react';
import { Image, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  cubicBezier,
  useReducedMotion,
  type CSSAnimationKeyframes,
  type CSSAnimationProperties,
  type CSSAnimationTimingFunction,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Pressable } from '@/components/ui/pressable';
import type { KidPowers } from '@/api/discover';
import type { KidActivity, KidEvent } from '@/api/kids';
import { getInitials } from '@/lib/avatarUtils';
import { POWER_SLOTS, powerSize } from '@/lib/kidsPowers';
import { font, rgb } from '@/theme';
import { POWER_ICONS } from '@/components/kids/icons';
import GameDialog from '@/components/kids/GameDialog';
import { enter } from '@/components/kids/enter';
import {
  color,
  discoverPage as d,
  orbitRing,
  power as powerStyle,
  spoke,
} from '@/components/kids/palette';

/** A box `n` in from every side of the orbit. */
const around = (n: number) => ({ top: n, left: n, right: n, bottom: n });
/** CSS `clamp(min, vw% of the window, max)`. */
const clamp = (min: number, value: number, max: number) =>
  Math.min(max, Math.max(min, value));

// The web's looping animations (index.css kids-twinkle, kids-float, the dashed ring's
// spin_60s, and the spokes' kids-grow-x entrance), only where motion is welcome.
const TWINKLE: CSSAnimationKeyframes = {
  '0%': { opacity: 0.25 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.25 },
};
const FLOAT: CSSAnimationKeyframes = {
  '0%': { transform: [{ translateY: 0 }] },
  '50%': { transform: [{ translateY: -8 }] },
  '100%': { transform: [{ translateY: 0 }] },
};
const SPIN: CSSAnimationKeyframes = {
  from: { transform: [{ rotate: '0deg' }] },
  to: { transform: [{ rotate: '360deg' }] },
};
const GROW_X: CSSAnimationKeyframes = {
  from: { transform: [{ scaleX: 0 }] },
  to: { transform: [{ scaleX: 1 }] },
};
const UNFOLD_EASE = cubicBezier(0.2, 1.5, 0.4, 1);

const loop = (
  name: CSSAnimationKeyframes,
  seconds: number,
  delay: number,
  timing: CSSAnimationTimingFunction,
  reduced: boolean,
): CSSAnimationProperties | null =>
  reduced
    ? null
    : {
        animationName: name,
        animationDuration: `${seconds}s`,
        animationDelay: `${delay}s`,
        animationTimingFunction: timing,
        animationIterationCount: 'infinite',
      };

/** The ring round the photo: web `.kids-photo-ring`'s conic gradient (cyan → its shade →
 * cyan, from 200deg), drawn as wedges of cyan over the shade, as RN has no conic-gradient. */
const WEDGES = 72;
function ConicRing({ size }: { size: number }) {
  const r = size / 2;
  const wedges = useMemo(
    () =>
      Array.from({ length: WEDGES }, (_, k) => {
        const deg = (n: number) => ((200 + (n / WEDGES) * 360) * Math.PI) / 180;
        // A hair wider than its slice, so no seam shows between two.
        const a = deg(k - 0.15);
        const b = deg(k + 1.15);
        const pt = (t: number) =>
          `${r + r * Math.sin(t)} ${r - r * Math.cos(t)}`;
        const t = (k + 0.5) / WEDGES;
        return {
          d: `M${r} ${r}L${pt(a)}A${r} ${r} 0 0 1 ${pt(b)}Z`,
          alpha: Math.abs(1 - 2 * t),
        };
      }),
    [r],
  );
  return (
    <Svg
      pointerEvents="none"
      width={size}
      height={size}
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      {wedges.map((w, k) => (
        <Path key={k} d={w.d} fill={color('discover')} fillOpacity={w.alpha} />
      ))}
    </Svg>
  );
}

interface DiscoverPowersProps {
  childName: string;
  avatarUrl?: string | null;
  powers: KidPowers;
  activity: KidActivity;
  send: (event: KidEvent) => Promise<KidActivity | null>;
}

/**
 * Discover in child view, as the prototype's (web components/kids/DiscoverPowers): the gold
 * eyebrow, "You are The <style>" and its line, the child's photo with their name in the middle
 * of their seven powers, and "7 superpowers unlocked". A power opens its mini game (+1 star
 * the first time; all seven earn the badge, which opens Grow in child view). The web's hover
 * tip ("Click here to enjoy the game") has no touch equivalent.
 */
export default function DiscoverPowers({
  childName,
  avatarUrl,
  powers,
  activity,
  send,
}: DiscoverPowersProps) {
  const [playing, setPlaying] = useState<number | null>(null);
  const [box, setBox] = useState(0);
  const opened = new Set(activity.flipped_powers);
  const game = playing === null ? null : powers.powers[playing] ?? null;
  const firstName = childName.trim().split(/\s+/)[0] ?? childName;
  const at = (percent: number) => (percent / 100) * box;
  const reduced = useReducedMotion();
  // The web's clamp(…vw…) type sizes, from the window's width.
  const vw = useWindowDimensions().width / 100;
  const eyebrowSize = clamp(11, 2.2 * vw, 16);
  const nameSize = clamp(12, 2 * vw, 15);
  const countSize = clamp(14, 2.4 * vw, 18);
  const labelSize = clamp(10, 1.8 * vw, 14);
  const iconSize = clamp(18, 3.8 * vw, 30);
  const initialSize = clamp(40, 8 * vw, 64);
  // `.kids-name-pill`: its top at 66%, raised a fifth of its own height (6px padding, a
  // 1.5 line and a 1px border on each side).
  const pillHeight = nameSize * 1.5 + 14;

  // Each power unfolds from the centre of the orbit to its place (web kids-unfold).
  const unfold = useMemo(
    () =>
      POWER_SLOTS.map(
        (slot): CSSAnimationKeyframes => ({
          from: {
            opacity: 0,
            transform: [
              { translateX: ((50 - slot.x) / 100) * box },
              { translateY: ((50 - slot.y) / 100) * box },
              { scale: 0.15 },
            ],
          },
          to: {
            opacity: 1,
            transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }],
          },
        }),
      ),
    [box],
  );

  const open = (i: number) => {
    setPlaying(i);
    if (!opened.has(i)) void send({ type: 'flip_power', power: i });
  };

  return (
    <View>
      <Animated.View style={enter('up', 0, reduced)}>
        <View style={[d.eyebrow, EYEBROW]}>
          <Animated.View
            style={[
              d.twinkle,
              TWINKLE_DOT,
              loop(TWINKLE, 1, 0, 'ease-in-out', reduced),
            ]}
          />
          <Text
            numberOfLines={1}
            className="shrink"
            style={[
              d.eyebrowText,
              {
                fontSize: eyebrowSize,
                lineHeight: eyebrowSize * 1.5,
                letterSpacing: clamp(
                  0.04 * eyebrowSize,
                  0.6 * vw,
                  0.12 * eyebrowSize,
                ),
              },
            ]}
          >
            Hey {firstName}, your superpowers are here!
          </Text>
          <Animated.View
            style={[
              d.twinkle,
              TWINKLE_DOT,
              loop(TWINKLE, 1, 0.5, 'ease-in-out', reduced),
            ]}
          />
        </View>
        <Text
          accessibilityRole="header"
          className="mt-3.5"
          style={[d.title, TITLE]}
        >
          You are{' '}
          <Text style={{ color: color('discover') }}>The {powers.style}</Text>
        </Text>
        {powers.style_line ? (
          <Text className="mt-4" style={[d.line, LINE]}>
            {powers.style_line}
          </Text>
        ) : null}
      </Animated.View>

      <View
        testID="kids-orbit"
        className="aspect-square w-full self-center"
        style={ORBIT}
        onLayout={e => setBox(e.nativeEvent.layout.width)}
      >
        {box > 0 ? (
          <>
            <View pointerEvents="none" style={d.glow} />
            <View
              pointerEvents="none"
              style={[orbitRing('discover'), around(at(14))]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                orbitRing('discover', true),
                around(at(6)),
                loop(SPIN, 60, 0, 'linear', reduced),
              ]}
            />
            <View
              pointerEvents="none"
              style={[orbitRing('discover'), around(at(24)), FAINT_RING]}
            />
            {POWER_SLOTS.map((_, i) => (
              <View
                key={i}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: box / 2,
                  top: box / 2,
                  width: at(39),
                  height: 1,
                  transformOrigin: 'left center',
                  transform: [
                    { rotate: `${-90 + (i * 360) / POWER_SLOTS.length}deg` },
                  ],
                }}
              >
                <Animated.View
                  style={[
                    spoke(at(39), playing === i),
                    SPOKE_LINE,
                    reduced
                      ? null
                      : {
                          animationName: GROW_X,
                          animationDuration: '0.7s',
                          animationDelay: `${0.6 + i * 0.22}s`,
                          animationTimingFunction: 'ease-out',
                          animationFillMode: 'backwards',
                        },
                  ]}
                />
              </View>
            ))}
            <Animated.View
              importantForAccessibility="no-hide-descendants"
              style={[
                d.photoRing,
                PHOTO_RING,
                around(at(34)),
                enter('pop', 0, reduced),
              ]}
            >
              <ConicRing size={at(32)} />
              <View style={d.photo}>
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    accessibilityIgnoresInvertColors
                    className="h-full w-full"
                  />
                ) : (
                  <Text style={[INITIAL, { fontSize: initialSize }]}>
                    {getInitials(childName).charAt(0)}
                  </Text>
                )}
              </View>
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[
                d.namePill,
                NAME_PILL,
                { top: at(66) - 0.2 * pillHeight },
                enter('fade', 0.5, reduced),
              ]}
            >
              <Text
                style={[
                  d.nameText,
                  {
                    fontSize: nameSize,
                    lineHeight: nameSize * 1.5,
                    letterSpacing: nameSize * 0.18,
                  },
                ]}
              >
                {firstName}
              </Text>
            </Animated.View>
            {powers.powers.map((p, i) => {
              const size = at(powerSize(p.level));
              const slot = POWER_SLOTS[i];
              const from = unfold[i];
              if (!slot || !from) return null;
              const on = playing === i;
              const ink = on ? color('text') : color('discover');
              return (
                <Animated.View
                  key={p.game}
                  style={[
                    {
                      position: 'absolute',
                      width: size,
                      height: size,
                      left: at(slot.x) - size / 2,
                      top: at(slot.y) - size / 2,
                    },
                    reduced
                      ? null
                      : {
                          animationName: from,
                          animationDuration: '0.8s',
                          animationDelay: `${0.6 + i * 0.22}s`,
                          animationTimingFunction: UNFOLD_EASE,
                          animationFillMode: 'backwards',
                        },
                  ]}
                >
                  <Pressable
                    onPress={() => open(i)}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name}: play its game${
                      opened.has(i) ? '' : ' (not opened yet)'
                    }`}
                    style={({ pressed }) => [
                      powerStyle(opened.has(i), on, pressed),
                      { left: 0, top: 0, width: size, height: size },
                    ]}
                  >
                    <Animated.View
                      style={[
                        FLOATING,
                        loop(FLOAT, 4, i * 0.8, 'ease-in-out', reduced),
                      ]}
                    >
                      <Svg
                        width={iconSize}
                        height={iconSize}
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <Path
                          d={POWER_ICONS[p.game]}
                          stroke={ink}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                      <Text
                        style={[
                          d.powerLabel,
                          {
                            fontSize: labelSize,
                            lineHeight: labelSize,
                            letterSpacing: labelSize * 0.1,
                            color: ink,
                          },
                        ]}
                      >
                        {p.name}
                      </Text>
                    </Animated.View>
                  </Pressable>
                </Animated.View>
              );
            })}
          </>
        ) : null}
      </View>

      <Animated.View
        className="mt-1.5"
        style={[d.countPill, COUNT_PILL, enter('pop', 2.4, reduced)]}
      >
        <Text
          style={[
            d.countText,
            {
              fontSize: countSize,
              lineHeight: countSize * 1.5,
              letterSpacing: countSize * 0.08,
            },
          ]}
        >
          {powers.powers.length} superpowers unlocked
        </Text>
      </Animated.View>

      {game ? (
        <GameDialog
          power={game}
          best={activity.best_times[game.game]}
          onClose={() => setPlaying(null)}
          onFinish={seconds =>
            void send({ type: 'game_best', game: game.game, seconds })
          }
        />
      ) : null}
    </View>
  );
}

// The web's sizes at phone width, over the shared discoverPage styles.
/** `.kids-eyebrow`: px-[18px] py-2 gap-2.5. */
const EYEBROW = { paddingHorizontal: 18, paddingVertical: 8, gap: 10 } as const;
/** `.kids-twinkle`: h-2 w-2. */
const TWINKLE_DOT = { width: 8, height: 8, borderRadius: 4 } as const;
/** clamp(34px, 5.4vw, 56px) is 34 below 630px; leading 1.08. */
const TITLE = {
  fontSize: 34,
  lineHeight: 34 * 1.08,
  letterSpacing: 34 * 0.02,
} as const;
/** text-[22px] leading-snug, max-w-[540px]. */
const LINE = {
  fontSize: 22,
  lineHeight: 22 * 1.375,
  maxWidth: 540,
  alignSelf: 'center',
} as const;
/** mt-[30px] max-w-[660px]. */
const ORBIT = { marginTop: 30, maxWidth: 660 } as const;
/** `.kids-orbit-ring-faint`. */
const FAINT_RING = { borderColor: rgb('kids-discover', 0.12) } as const;
/** The spoke's line inside its rotated holder, grown from the centre. */
const SPOKE_LINE = {
  left: 0,
  top: 0,
  transformOrigin: 'left center',
} as const;
/** `.kids-photo-ring`: p-1.5, the conic gradient's shade under its cyan wedges. */
const PHOTO_RING = {
  padding: 6,
  backgroundColor: rgb('kids-discover-shade'),
} as const;
/** `.kids-photo`'s letter: Orbitron bold. */
const INITIAL = { ...font('orbitron', 700), color: rgb('kids-text') } as const;
/** `.kids-name-pill`: px-[18px] py-1.5. */
const NAME_PILL = { paddingHorizontal: 18, paddingVertical: 6 } as const;
/** A power's icon and name (gap-[5px]), the label at most 90% across. */
const FLOATING = {
  alignItems: 'center',
  gap: 5,
  maxWidth: '90%',
} as const;
/** `.kids-count-pill`: px-[22px] py-2.5. */
const COUNT_PILL = { paddingHorizontal: 22, paddingVertical: 10 } as const;
