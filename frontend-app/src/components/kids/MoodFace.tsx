import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import type { KidMoodKey } from '@/api/kids';
import { MOODS } from '@/lib/kidsMoods';
import { color } from '@/components/kids/palette';

/** A mood's face (web components/kids/MoodFace): a ring, two eyes and the mood's mouth. */
export default function MoodFace({
  mood,
  size,
}: {
  mood: KidMoodKey;
  size: number;
}) {
  const m = MOODS.find(x => x.key === mood);
  if (!m) return null;
  const stroke = color(m.color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9.5} stroke={stroke} strokeWidth={2.2} />
      <Circle cx={9} cy={10} r={0.9} fill={stroke} />
      <Circle cx={15} cy={10} r={0.9} fill={stroke} />
      <Path
        d={m.mouth}
        stroke={stroke}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
