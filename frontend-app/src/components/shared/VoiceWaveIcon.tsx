import React from 'react';
import Svg, { Rect } from 'react-native-svg';

/** The web VoiceInput's five-bar waveform glyph (16×16). */
export default function VoiceWaveIcon({
  color,
  size = 16,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
      <Rect x="1" y="5" width="2" height="6" rx="1" />
      <Rect x="4" y="2" width="2" height="12" rx="1" />
      <Rect x="7" y="0" width="2" height="16" rx="1" />
      <Rect x="10" y="3" width="2" height="10" rx="1" />
      <Rect x="13" y="5" width="2" height="6" rx="1" />
    </Svg>
  );
}
