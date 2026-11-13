import { House, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KidsHeaderProps {
  areaName: string;
  readAloud: boolean;
  onHome: () => void;
  onToggleReadAloud: () => void;
}

/**
 * The kids page's bar, as the prototype's: Home (back to the circles), the circle's chip, and
 * Read to me (lit while the page reads itself aloud).
 */
export default function KidsHeader({
  areaName,
  readAloud,
  onHome,
  onToggleReadAloud,
}: KidsHeaderProps) {
  return (
    <header className="sticky top-16 z-10 flex flex-wrap items-center justify-between gap-3 bg-kids-bg/80 px-4 py-3 backdrop-blur-md sm:px-7">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onHome}
          aria-label="Back to home"
          className="kids-btn kids-btn-off h-10 pl-3 pr-4 text-sm md:text-base"
        >
          <House className="h-[18px] w-[18px]" aria-hidden="true" />
          Home
        </button>
        <div className="kids-chip">
          <span
            aria-hidden="true"
            className="kids-glow-dot h-2.5 w-2.5 rounded-full bg-kids-area"
          />
          <span className="font-orbitron text-sm font-black uppercase tracking-wider text-kids-text">
            {areaName}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleReadAloud}
        aria-pressed={readAloud}
        className={cn(
          'h-10 px-4 text-sm md:text-base',
          readAloud ? 'kids-btn' : 'kids-btn kids-btn-off',
        )}
      >
        <Volume2 className="h-[18px] w-[18px]" aria-hidden="true" />
        Read to me
      </button>
    </header>
  );
}
