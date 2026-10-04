import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
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

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const EASE = Easing.bezier(0.25, 0.1, 0.25, 1); // CSS `ease`
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1); // CSS `ease-in-out`
const CYAN_BRIGHT = rgb('constellation-cyan-bright');
const BOX = 700;

const spokePath = (k: SpokeKey) =>
  `M350 350 L${SPOKE_END[k].x} ${SPOKE_END[k].y}`;

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

function InactiveSpoke({
  k,
  delay,
}: {
  k: Exclude<SpokeKey, 'startAgain'>;
  delay: number;
}) {
  const offset = useSpokeDraw(delay);
  const props = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  return (
    <AnimatedPath
      d={spokePath(k)}
      fill="none"
      stroke={CYAN_BRIGHT}
      strokeWidth={1.6}
      strokeDasharray={`${SPOKE_DASH}`}
      opacity={0.4}
      animatedProps={props}
    />
  );
}

/**
 * The frontier spoke: `spokeDrawSm .8s ease {delay}s both, lineGlow 3.4s
 * ease-in-out 1.1s infinite`. lineGlow pulses opacity .45 ↔ .85 and the
 * drop-shadow 3px ↔ 8px; on RN the two glow sizes are two filtered copies of
 * the path cross-faded by the same phase value (`glow`: -1 before 1.1s).
 */
function ActiveSpoke({
  k,
  delay,
}: {
  k: Exclude<SpokeKey, 'startAgain'>;
  delay: number;
}) {
  const offset = useSpokeDraw(delay);
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

  const plain = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
    opacity: glow.value < 0 ? 1 : 0,
  }));
  const small = useAnimatedProps(() => {
    const g = glow.value;
    return {
      strokeDashoffset: offset.value,
      opacity: g < 0 ? 0 : (0.45 + 0.4 * g) * (1 - g),
    };
  });
  const large = useAnimatedProps(() => {
    const g = glow.value;
    return {
      strokeDashoffset: offset.value,
      opacity: g < 0 ? 0 : (0.45 + 0.4 * g) * g,
    };
  });

  const common = {
    d: spokePath(k),
    fill: 'none',
    stroke: CYAN_BRIGHT,
    strokeWidth: 3.4,
    strokeDasharray: `${SPOKE_DASH}`,
  } as const;

  return (
    <>
      <AnimatedPath {...common} animatedProps={plain} />
      <AnimatedPath
        {...common}
        filter="url(#spokeGlowSm)"
        animatedProps={small}
      />
      <AnimatedPath
        {...common}
        filter="url(#spokeGlowLg)"
        animatedProps={large}
      />
    </>
  );
}

function StartAgainSpoke() {
  const offset = useSpokeDraw(0.6);
  const props = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  return (
    <AnimatedPath
      d={spokePath('startAgain')}
      fill="none"
      stroke={rgb('constellation-slate-deep')}
      strokeWidth={1.1}
      strokeDasharray={`${SPOKE_DASH}`}
      opacity={0.22}
      animatedProps={props}
    />
  );
}

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
  target: Exclude<SpokeKey, 'startAgain'>;
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
  const props = useAnimatedProps(() => {
    const p = Math.max(0, t.value);
    return {
      cx: 350 + (end.x - 350) * p,
      cy: 350 + (end.y - 350) * p,
      opacity: t.value < 0 ? 0 : 1,
    };
  });
  return (
    <AnimatedCircle
      r={r}
      fill={rgb('constellation-cyan-pale')}
      filter="url(#spokeDotGlow)"
      animatedProps={props}
    />
  );
}

const SPOKES: { k: Exclude<SpokeKey, 'startAgain'>; delay: number }[] = [
  { k: 'connect', delay: 0.35 },
  { k: 'transform', delay: 0.45 },
  { k: 'release', delay: 0.55 },
  { k: 'grow', delay: 0.5 },
];

/** The six hub spokes plus the two traveling dots toward the frontier circle (700×700 box). */
export default function Spokes({ current }: { current: ActiveDimension }) {
  const renderSpoke = (k: Exclude<SpokeKey, 'startAgain'>, delay: number) =>
    current === k ? (
      <ActiveSpoke key={k} k={k} delay={delay} />
    ) : (
      <InactiveSpoke key={k} k={k} delay={delay} />
    );

  return (
    <Svg
      pointerEvents="none"
      width={BOX}
      height={BOX}
      viewBox={`0 0 ${BOX} ${BOX}`}
      style={StyleSheet.absoluteFill}
    >
      <Defs>
        <Filter
          id="spokeGlowSm"
          filterUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={BOX}
          height={BOX}
        >
          <FeDropShadow
            dx={0}
            dy={0}
            stdDeviation={1.5}
            floodColor={rgb('constellation-cyan')}
            floodOpacity={0.75}
          />
        </Filter>
        <Filter
          id="spokeGlowLg"
          filterUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={BOX}
          height={BOX}
        >
          <FeDropShadow
            dx={0}
            dy={0}
            stdDeviation={4}
            floodColor={rgb('constellation-cyan')}
            floodOpacity={1}
          />
        </Filter>
        <Filter
          id="spokeDotGlow"
          filterUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={BOX}
          height={BOX}
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
      {SPOKES.map(s => renderSpoke(s.k, s.delay))}
      <StartAgainSpoke />
      {renderSpoke('discover', 0.3)}
      {current && (
        // Keyed by target so the dots restart when the frontier moves; prefixed so
        // it never collides with the spoke keyed by the same dimension name.
        <React.Fragment key={`dots-${current}`}>
          <TravelDot target={current} begin={1.2} r={3.2} />
          <TravelDot target={current} begin={2.05} r={2.8} />
        </React.Fragment>
      )}
    </Svg>
  );
}
