import { useRef, type CSSProperties } from 'react';
import { usePageTop } from '@/hooks/usePageTop';
import { cn } from '@/lib/utils';
import Spinner from './Spinner';

interface PageLoaderProps {
  /** The page's background and height (defaults: the app background, the full viewport). */
  className?: string;
  style?: CSSProperties;
  /** The spinner's own look, for a page with its own colours. */
  spinnerClassName?: string;
  spinnerStyle?: CSSProperties;
  durationSeconds?: number;
}

/**
 * The standard "page is loading" state: its spinner on the window's centre (50vh less the
 * loader's top on the page), wherever the loader starts (under the app bar, the Back row or a
 * page's own header), so it sits where the journey's orb and hub do.
 */
export default function PageLoader({
  className,
  style,
  spinnerClassName,
  spinnerStyle,
  durationSeconds,
}: PageLoaderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const top = usePageTop(ref, 112);
  return (
    <div ref={ref} className={cn('relative min-h-screen bg-background', className)} style={style}>
      {/* Shows after .3s (index.css .page-loader-spin): a quick load goes straight to the
          page, with no spinner blinking in between. */}
      <div
        className="page-loader-spin absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ top: `calc(50vh - ${top}px)` }}
      >
        <Spinner
          className={spinnerClassName}
          style={spinnerStyle}
          durationSeconds={durationSeconds}
        />
      </div>
    </div>
  );
}
