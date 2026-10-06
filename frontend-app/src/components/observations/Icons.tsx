import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { rgb } from '@/theme';

/** Tick inside the watch checkbox (web CheckIcon). */
export function CheckIcon({ opacity }: { opacity: number }) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke={rgb('constellation-ink')}
      strokeWidth={3.2}
      opacity={opacity}
    >
      <Path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}

/** Privacy-note shield (web ShieldIcon). */
export function ShieldIcon() {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke={rgb('constellation-slate-dim')}
      strokeWidth={1.9}
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <Path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />
    </Svg>
  );
}

/** Tracking-started clock (web ClockIcon). */
export function ClockIcon() {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={28}
      height={28}
      fill="none"
      stroke={rgb('constellation-cyan')}
      strokeWidth={2.2}
    >
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

/** Observation card glyph — one path from OBSERVATION_ICONS. */
export function ObservationGlyph({ d }: { d: string }) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke={rgb('constellation-gold')}
      strokeWidth={1.8}
    >
      <Path d={d} />
    </Svg>
  );
}
