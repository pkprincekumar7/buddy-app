import React, { useCallback, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { Circle, Path } from 'react-native-svg';
import { font, rgb } from '@/theme';
import DimensionNode from './DimensionNode';
import HubOrb from './HubOrb';
import Spokes from './Spokes';
import { PHASE2_ENTER, SCOPE_FOCUS, fadeIn } from './animations';
import { NODE_CENTER, ringScaleFor, type ActiveDimension } from './geometry';
import type { JourneyViewport } from './viewport';

const FOOTER_FADE = fadeIn(0.8, 1.2, 'ease');

interface DimensionCirclesScreenProps {
  childName: string;
  mergedData: Record<string, unknown>;
  onConnect: () => void;
  onDiscover: () => void;
  onGoHome: () => void;
  onGrow: () => void;
  onTransform: () => void;
  onRelease: () => void;
  onStartAgain: () => void;
  enabled: {
    grow: boolean;
    transform: boolean;
    release: boolean;
    connect: boolean;
  };
  current: ActiveDimension;
  viewport: JourneyViewport;
}

/** Phase 2 — the seven-circle constellation around the center HUD. */
export default function DimensionCirclesScreen({
  onConnect,
  onDiscover,
  onGoHome,
  onGrow,
  onTransform,
  onRelease,
  onStartAgain,
  enabled,
  current,
  viewport,
}: DimensionCirclesScreenProps) {
  const { width, vh } = viewport;
  const [ringScale, setRingScale] = useState(1);

  // web watchRing: scale the 700px ring box to fit the ring area.
  const onRingAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (!w || !h) return;
    const s = ringScaleFor(w, h);
    setRingScale(prev => (Math.abs(s - prev) > 0.005 ? s : prev));
  }, []);

  return (
    <Animated.View style={PHASE2_ENTER}>
      <Animated.View
        style={[
          {
            height: vh,
            width,
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 18,
          },
          SCOPE_FOCUS,
        ]}
      >
        {/* Ring area */}
        <View
          onLayout={onRingAreaLayout}
          style={{ flex: 1, minHeight: 0, width: '100%' }}
        >
          <View
            style={{
              position: 'absolute',
              left: width / 2 - 350,
              top: vh / 2 - 64 - 350,
              width: 700,
              height: 700,
              transform: [{ scale: ringScale }],
              zIndex: 1,
            }}
          >
            <Spokes current={current} />

            {/* Center Hub */}
            <HubOrb onPress={onGoHome} />

            {/* Connect — top-left */}
            <DimensionNode
              center={NODE_CENTER.connect}
              delay={0.55}
              onPress={onConnect}
              locked={!enabled.connect}
              highlighted={current === 'connect'}
              label="Connect"
              icon={
                <Path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
              }
            />

            {/* Discover — top-center (CTA) */}
            <DimensionNode
              center={NODE_CENTER.discover}
              delay={0.45}
              onPress={onDiscover}
              highlighted={current === 'discover'}
              label="Discover"
              labelColor={rgb('constellation-cyan-paler')}
              startHereBadge
              icon={
                <>
                  <Circle cx={12} cy={8.5} r={3.2} />
                  <Path d="M5 20c1.5-4 4-6 7-6s5.5 2 7 6" />
                </>
              }
            />

            {/* Transform — top-right */}
            <DimensionNode
              center={NODE_CENTER.transform}
              delay={0.65}
              onPress={onTransform}
              locked={!enabled.transform}
              highlighted={current === 'transform'}
              label="Transform"
              icon={
                <>
                  <Circle cx={11} cy={11} r={7} />
                  <Path d="M20 20l-4-4" />
                </>
              }
            />

            {/* Release — bottom-right */}
            <DimensionNode
              center={NODE_CENTER.release}
              delay={0.75}
              onPress={onRelease}
              locked={!enabled.release}
              highlighted={current === 'release'}
              label="Release"
              icon={
                <>
                  <Circle cx={12} cy={8} r={3.4} />
                  <Path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
                </>
              }
            />

            {/* Grow — bottom-left */}
            <DimensionNode
              center={NODE_CENTER.grow}
              delay={0.8}
              onPress={onGrow}
              locked={!enabled.grow}
              highlighted={current === 'grow'}
              label="Grow"
              icon={<Path d="M4 20V10M11 20V4M18 20v-7" />}
            />

            {/* Start Again — bottom-center (always enabled) */}
            <DimensionNode
              center={NODE_CENTER.startAgain}
              delay={0.85}
              onPress={onStartAgain}
              highlighted={false}
              label="Start Again"
              icon={
                <>
                  <Path d="M4 4v6h6M20 20v-6h-6" />
                  <Path d="M5 15a8 8 0 0013.5 3.5M19 9A8 8 0 005.5 5.5" />
                </>
              }
            />
          </View>
        </View>

        {/* Footer */}
        <Animated.View style={FOOTER_FADE}>
          <Text
            className="text-center uppercase text-constellation-slate-dark"
            style={[
              font('rajdhani', 600),
              { fontSize: 12, letterSpacing: 12 * 0.18 },
            ]}
          >
            Tap the center HUD to return home
          </Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}
