/**
 * The avatar orb + hexagon of six traits (web PersonalityProfile "Trait
 * diagram"), scaled proportionally to the measured container width
 * (748px = design width) exactly like the web's ResizeObserver version.
 */
import React, { useState } from 'react';
import {
  Image,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { css, rgb } from '@/theme';
import { PP } from './palette';
import { enterScale } from './animations';
import { AVATAR_MAP } from './ProfileAvatars';
import { TraitIcon } from './ProfileIcons';
import { SERIF } from './styles';

const RING_GRADIENT = `linear-gradient(150deg, ${PP.avatarRing1}, ${PP.avatarRing2} 55%, ${PP.avatarRing3})`;
const RING_GLOW = css(
  '0 0 34px rgb(var(--constellation-blue-electric-rgb) / .4)',
);
const INITIALS_BG = css(
  `radial-gradient(circle at 38% 32%, ${PP.initialsGlow}, rgb(var(--constellation-navy-glow-rgb) / 0.96))`,
);
const TRAIT_ANGLES_DEG = [0, -60, 60, -120, 120, 180] as const;

/**
 * `object-fit: cover; object-position: 50% 15%` — RN Image has no
 * object-position, so cover is computed by hand from the loaded image size.
 */
function AvatarPhoto({
  uri,
  size,
  alt,
}: {
  uri: string;
  size: number;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  if (failed) return null;
  let w = size;
  let h = size;
  let top = 0;
  let left = 0;
  if (natural && natural.w > 0 && natural.h > 0) {
    const s = Math.max(size / natural.w, size / natural.h);
    w = natural.w * s;
    h = natural.h * s;
    left = (size - w) * 0.5;
    top = (size - h) * 0.15;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
      }}
    >
      <Image
        source={{ uri }}
        accessibilityLabel={alt}
        resizeMode="cover"
        style={{ position: 'absolute', top, left, width: w, height: h }}
        onLoad={e => {
          const src = e.nativeEvent.source;
          if (src?.width && src.height)
            setNatural({ w: src.width, h: src.height });
        }}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

export interface TraitDiagramProps {
  traits: string[];
  childName: string;
  initials: string;
  avatarId: string;
  avatarUrl: string;
}

export default function TraitDiagram({
  traits,
  childName,
  initials,
  avatarId,
  avatarUrl,
}: TraitDiagramProps) {
  const { width: windowW } = useWindowDimensions();
  const [diagAvailW, setDiagAvailW] = useState(() =>
    Math.min(windowW - 68, 748),
  );
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - diagAvailW) > 0.5) setDiagAvailW(w);
  };

  // Diagram scale — proportional to available container width (748px = design width)
  const dScale = Math.min(1, diagAvailW / 748);
  // The orb shrinks faster than the rest of the diagram on narrow screens.
  const orbShrink = Math.pow(dScale, 1.5);
  const circleD = Math.round(272 * orbShrink);
  // Ring scales with dScale so it stays in lockstep with the trait orbit radius.
  const ringD = Math.round(432 * dScale);
  const diagH = Math.round(520 * dScale);
  const iconContainerSize = Math.max(28, Math.round(46 * dScale));
  const traitFontSize = Math.max(11, Math.round(14 * dScale));
  const traitGap = Math.max(4, Math.round(8 * dScale));
  const ringPad = Math.max(3, Math.round(7 * dScale));
  // Six items 60° apart; each icon sits just outside the ring.
  const traitOrbitR = ringD / 2 + iconContainerSize / 2;
  const traitWidth = Math.round(180 * dScale);
  const cx = diagAvailW / 2;
  const cy = diagH / 2;
  const traitPos = TRAIT_ANGLES_DEG.map(deg => {
    const rad = (deg * Math.PI) / 180;
    const dx = traitOrbitR * Math.sin(rad);
    const dy = -traitOrbitR * Math.cos(rad);
    return {
      left: cx + dx - traitWidth / 2,
      top: cy + dy - iconContainerSize / 2,
      width: traitWidth,
    };
  });
  const inner = circleD - ringPad * 2;
  const preset = AVATAR_MAP[avatarId];

  return (
    <View onLayout={onLayout} style={{ position: 'relative', height: diagH }}>
      {/* Outer ring */}
      <View
        style={{
          position: 'absolute',
          left: cx - ringD / 2,
          top: cy - ringD / 2,
          width: ringD,
          height: ringD,
          borderWidth: 1,
          borderColor: rgb('constellation-blue-haze', 0.16),
          borderRadius: ringD / 2,
        }}
      />
      {/* Profile circle with gradient border */}
      <View
        style={{
          position: 'absolute',
          left: cx - circleD / 2,
          top: cy - circleD / 2,
          width: circleD,
          height: circleD,
          borderRadius: circleD / 2,
          padding: ringPad,
          experimental_backgroundImage: RING_GRADIENT,
          boxShadow: RING_GLOW,
        }}
      >
        {avatarUrl ? (
          <AvatarPhoto uri={avatarUrl} size={inner} alt={childName} />
        ) : preset ? (
          <View
            style={{
              width: '100%',
              height: '100%',
              borderRadius: inner / 2,
              backgroundColor: preset.bg,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {preset.svg}
          </View>
        ) : (
          <View
            style={{
              width: '100%',
              height: '100%',
              borderRadius: inner / 2,
              experimental_backgroundImage: INITIALS_BG,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={[
                SERIF,
                {
                  fontSize: Math.max(24, Math.round(72 * dScale)),
                  fontWeight: '700',
                  color: rgb('constellation-blue-pale'),
                },
              ]}
            >
              {initials}
            </Text>
          </View>
        )}
      </View>
      {/* 6 trait items */}
      {traits.slice(0, 6).map((trait, i) => (
        <Animated.View
          key={i}
          entering={enterScale(0.25 + i * 0.1, 0.8)}
          style={[
            { position: 'absolute', alignItems: 'center', gap: traitGap },
            traitPos[i],
          ]}
        >
          <TraitIcon index={i} containerSize={iconContainerSize} />
          <Text
            style={{
              fontSize: traitFontSize,
              lineHeight: traitFontSize * 1.3,
              textAlign: 'center',
              color: rgb('constellation-blue-soft'),
            }}
          >
            {trait}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}
