import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  FeDropShadow,
  Filter,
  Path,
} from 'react-native-svg';
import { rgb } from '@/theme';
import {
  SPOKE_DASH,
  SPOKE_END,
  type ActiveDimension,
  type SpokeKey,
} from './geometry';

/*
 * Performance: react-native-svg redraws a whole <Svg> (in software on Android)
 * whenever any animated prop inside it changes, re-running every filter in it.
 * The web draws these spokes in one SVG, but on RN a looping glow / traveling
 * dot inside a 700×700 filtered SVG re-blurs the full canvas every frame
 * (~400ms/frame on Android). So each looping effect lives in its own layer
 * whose SVG is drawn once, and the loop animates the layer *view* (opacity /
 * translate) — composited by the GPU, the SVG never redraws. Only the one-off
 * 0.8s draw-in animates SVG props, in a filter-free layer.
 */

const AnimatedPath = Animated.createAnimatedComponent(Path);

const EASE = Easing.bezier(0.25, 0.1, 0.25, 1); // CSS `ease`
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1); // CSS `ease-in-out`
const CYAN_BRIGHT = rgb('constellation-cyan-bright');
const BOX = 700;
const VIEWBOX = `0 0 ${BOX} ${BOX}`;

type DimKey = Exclude<SpokeKey, 'startAgain'>;

const spokePath = (k: SpokeKey) =>
  `M350 350 L${SPOKE_END[k].x} ${SPOKE_END[k].y}`;

/** A full-box layer (same 700×700 viewBox as the web SVG). */
function Layer({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.ComponentProps<typeof Animated.View>['style'];
}) {
  return (
    <Animated.View
      pointerEvents="none"
      // Cache the drawn SVG as a GPU texture so opacity / transform loops only composite.
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={[StyleSheet.absoluteFill, { width: BOX, height: BOX }, style]}
    >
      <Svg width={BOX} height={BOX} viewBox={VIEWBOX}>
        {children}
      </Svg>
    </Animated.View>
  );
}

/** Filter region hugging one spoke (plus the blur margin), not the whole box. */
function spokeFilterRegion(k: SpokeKey, margin: number) {
  const e = SPOKE_END[k];
  const x = Math.min(350, e.x) - margin;
  const y = Math.min(350, e.y) - margin;
  return {
    x,
    y,
    width: Math.abs(e.x - 350) + margin * 2,
    height: Math.abs(e.y - 350) + margin * 2,
  };
}

/** `spokeDrawSm .8s ease {delay}s both` — stroke-dashoffset 200 → 0. */
function useSpokeDraw(delay: number) {
  const offset = useSharedValue(SPOKE_DASH);
  useEffect(() => {
    offset.value = withDelay(
      delay * 1000,
      withTiming(0, { duration: 800, easing: EASE }),
    );
  }, [offset, delay]);
  return offset;
}

function DrawnPath({
  k,
  delay,
  stroke,
  strokeWidth,
  opacity,
}: {
  k: SpokeKey;
  delay: number;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}) {
  const offset = useSpokeDraw(delay);
  const props = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  return (
    <AnimatedPath
      d={spokePath(k)}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={`${SPOKE_DASH}`}
      opacity={opacity}
      animatedProps={props}
    />
  );
}

/**
 * lineGlow phase: -1 before its 1.1s start, then 0 ↔ 1 (3.4s ease-in-out
 * alternate). The web pulses opacity .45 ↔ .85 and drop-shadow 3px ↔ 8px; here
 * the two glow sizes are two pre-drawn layers cross-faded by this phase.
 */
function useLineGlow(): SharedValue<number> {
  const glow = useSharedValue(-1);
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    const wait = Math.max(0, 1100 - (Date.now() - mountedAt.current));
    glow.value = withDelay(
      wait,
      withSequence(
        withTiming(0, { duration: 0 }),
        withRepeat(
          withSequence(
            withTiming(1, { duration: 1700, easing: EASE_IN_OUT }),
            withTiming(0, { duration: 1700, easing: EASE_IN_OUT }),
          ),
          -1,
        ),
      ),
    );
  }, [glow]);
  return glow;
}

/**
 * The frontier spoke: `spokeDrawSm .8s ease {delay}s both, lineGlow 3.4s
 * ease-in-out 1.1s infinite` — a plain drawn-in line until the glow starts,
 * then two filtered copies cross-faded by the glow phase.
 */
function ActiveSpoke({ k, delay }: { k: DimKey; delay: number }) {
  const glow = useLineGlow();

  const plainStyle = useAnimatedStyle(() => ({
    opacity: glow.value < 0 ? 1 : 0,
  }));
  const smallStyle = useAnimatedStyle(() => {
    const g = glow.value;
    return { opacity: g < 0 ? 0 : (0.45 + 0.4 * g) * (1 - g) };
  });
  const largeStyle = useAnimatedStyle(() => {
    const g = glow.value;
    return { opacity: g < 0 ? 0 : (0.45 + 0.4 * g) * g };
  });

  const line = {
    d: spokePath(k),
    fill: 'none',
    stroke: CYAN_BRIGHT,
    strokeWidth: 3.4,
  } as const;

  return (
    <>
      <Layer style={plainStyle}>
        <DrawnPath
          k={k}
          delay={delay}
          stroke={CYAN_BRIGHT}
          strokeWidth={3.4}
          opacity={1}
        />
      </Layer>
      <Layer style={smallStyle}>
        <Defs>
          <Filter
            id={`spokeGlowSm-${k}`}
            filterUnits="userSpaceOnUse"
            {...spokeFilterRegion(k, 8)}
          >
            <FeDropShadow
              dx={0}
              dy={0}
              stdDeviation={1.5}
              floodColor={rgb('constellation-cyan')}
              floodOpacity={0.75}
            />
          </Filter>
        </Defs>
        <Path {...line} filter={`url(#spokeGlowSm-${k})`} />
      </Layer>
      <Layer style={largeStyle}>
        <Defs>
          <Filter
            id={`spokeGlowLg-${k}`}
            filterUnits="userSpaceOnUse"
            {...spokeFilterRegion(k, 16)}
          >
            <FeDropShadow
              dx={0}
              dy={0}
              stdDeviation={4}
              floodColor={rgb('constellation-cyan')}
              floodOpacity={1}
            />
          </Filter>
        </Defs>
        <Path {...line} filter={`url(#spokeGlowLg-${k})`} />
      </Layer>
    </>
  );
}

// A traveling dot is a small pre-drawn glowing circle translated along the spoke.
const DOT_BOX = 24;
const DOT_C = DOT_BOX / 2;

/**
 * A dot traveling hub → frontier circle — SVG `<animateMotion dur="1.7s"
 * repeatCount="indefinite" begin={begin}>` along the straight spoke. Hidden
 * until its begin time (the web draws it at the SVG origin until then).
 */
function TravelDot({
  target,
  begin,
  r,
}: {
  target: DimKey;
  begin: number;
  r: number;
}) {
  const t = useSharedValue(-1);
  const end = SPOKE_END[target];
  useEffect(() => {
    t.value = withDelay(
      begin * 1000,
      withSequence(
        withTiming(0, { duration: 0 }),
        withRepeat(
          withTiming(1, { duration: 1700, easing: Easing.linear }),
          -1,
        ),
      ),
    );
  }, [t, begin]);
  const style = useAnimatedStyle(() => {
    const p = Math.max(0, t.value);
    return {
      opacity: t.value < 0 ? 0 : 1,
      transform: [
        { translateX: (end.x - 350) * p },
        { translateY: (end.y - 350) * p },
      ],
    };
  });
  const id = `spokeDotGlow-${r}`;
  return (
    <Animated.View
      pointerEvents="none"
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={[
        {
          position: 'absolute',
          left: 350 - DOT_C,
          top: 350 - DOT_C,
          width: DOT_BOX,
          height: DOT_BOX,
        },
        style,
      ]}
    >
      <Svg
        width={DOT_BOX}
        height={DOT_BOX}
        viewBox={`0 0 ${DOT_BOX} ${DOT_BOX}`}
      >
        <Defs>
          <Filter
            id={id}
            filterUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={DOT_BOX}
            height={DOT_BOX}
          >
            <FeDropShadow
              dx={0}
              dy={0}
              stdDeviation={2}
              floodColor={rgb('constellation-cyan')}
              floodOpacity={1}
            />
          </Filter>
        </Defs>
        <Circle
          cx={DOT_C}
          cy={DOT_C}
          r={r}
          fill={rgb('constellation-cyan-pale')}
          filter={`url(#${id})`}
        />
      </Svg>
    </Animated.View>
  );
}

const SPOKES: { k: DimKey; delay: number }[] = [
  { k: 'connect', delay: 0.35 },
  { k: 'transform', delay: 0.45 },
  { k: 'release', delay: 0.55 },
  { k: 'grow', delay: 0.5 },
  { k: 'discover', delay: 0.3 },
];

/** The six hub spokes plus the two traveling dots toward the frontier circle (700×700 box). */
export default function Spokes({ current }: { current: ActiveDimension }) {
  const active = SPOKES.find(s => s.k === current);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { width: BOX, height: BOX }]}
    >
      {/* Inactive spokes + the Start Again spoke: drawn in once, then static. */}
      <Layer>
        {SPOKES.filter(s => s.k !== current).map(s => (
          <DrawnPath
            key={s.k}
            k={s.k}
            delay={s.delay}
            stroke={CYAN_BRIGHT}
            strokeWidth={1.6}
            opacity={0.4}
          />
        ))}
        <DrawnPath
          k="startAgain"
          delay={0.6}
          stroke={rgb('constellation-slate-deep')}
          strokeWidth={1.1}
          opacity={0.22}
        />
      </Layer>
      {active && (
        <ActiveSpoke key={active.k} k={active.k} delay={active.delay} />
      )}
      {current && (
        // Keyed by target so the dots restart when the frontier moves.
        <React.Fragment key={`dots-${current}`}>
          <TravelDot target={current} begin={1.2} r={3.2} />
          <TravelDot target={current} begin={2.05} r={2.8} />
        </React.Fragment>
      )}
    </View>
  );
}
