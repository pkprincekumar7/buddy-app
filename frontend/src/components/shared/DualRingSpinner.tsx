import { cn } from '@/lib/utils';

interface DualRingSpinnerProps {
  /** Tailwind size classes for the spinner's bounding box, e.g. "h-20 w-20". */
  size?: string;
  /** Static faint ring drawn beneath the spinning ones. */
  trackClassName?: string;
  /** Outer ring, spinning at the default `animate-spin` speed. */
  outerClassName?: string;
  /** Inner ring, spinning in reverse at its own speed for a counter-rotation effect. */
  innerClassName?: string;
  innerDurationSeconds?: number;
}

/** Two counter-rotating rings — used for the app's longer-running loading states. */
export default function DualRingSpinner({
  size = 'h-20 w-20',
  trackClassName = 'border-primary/20',
  outerClassName = 'border-t-primary-medium',
  innerClassName = 'border-t-success-bright',
  innerDurationSeconds = 0.75,
}: DualRingSpinnerProps) {
  return (
    <div className={cn('relative', size)}>
      <div className={cn('absolute inset-0 rounded-full border-4', trackClassName)} />
      <div
        className={cn(
          'absolute inset-0 animate-spin rounded-full border-4 border-transparent',
          outerClassName,
        )}
      />
      <div
        className={cn(
          'absolute inset-2 animate-spin rounded-full border-4 border-transparent',
          innerClassName,
        )}
        style={{ animationDuration: `${innerDurationSeconds}s`, animationDirection: 'reverse' }}
      />
    </div>
  );
}
