import type { KidMoodKey } from '@/api/kids';
import { MOODS } from '@/lib/kidsMoods';
import { tileColor } from '@/components/kids/palette';

/** A mood's face: a ring, two eyes and the mood's mouth, in the mood's kids colour. */
export default function MoodFace({ mood, className }: { mood: KidMoodKey; className?: string }) {
  const m = MOODS.find((x) => x.key === mood);
  if (!m) return null;
  const stroke = tileColor(m.color);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="9" cy="10" r=".9" fill={stroke} />
      <circle cx="15" cy="10" r=".9" fill={stroke} />
      <path d={m.mouth} />
    </svg>
  );
}
