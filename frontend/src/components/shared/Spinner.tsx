import { motion } from 'framer-motion';
import type { AriaAttributes, CSSProperties } from 'react';
import { SPINNER } from '@/lib/animations';
import { cn } from '@/lib/utils';

interface SpinnerProps {
  className?: string;
  /** Overrides SPINNER's default 2s rotation — some loading states want a faster spin. */
  durationSeconds?: number;
  /** Overrides the default `border-primary` ring color, e.g. for a page-specific token. */
  style?: CSSProperties;
  'aria-hidden'?: AriaAttributes['aria-hidden'];
}

export default function Spinner({ className, durationSeconds, style, ...rest }: SpinnerProps) {
  return (
    <motion.div
      animate={SPINNER.animate}
      transition={
        durationSeconds ? { ...SPINNER.transition, duration: durationSeconds } : SPINNER.transition
      }
      className={cn(
        'h-10 w-10 rounded-full border-2 border-primary border-t-transparent',
        className,
      )}
      style={style}
      {...rest}
    />
  );
}
