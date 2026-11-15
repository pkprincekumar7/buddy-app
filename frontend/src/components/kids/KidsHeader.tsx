import { Volume2 } from 'lucide-react';
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
          className="kids-btn kids-btn-off h-10 pl-4 pr-[22px] text-sm md:text-base"
        >
          {/* The prototype's house: a roof and walls, no door. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-[18px] w-[18px] md:h-5 md:w-5"
          >
            <path d="M3 11l9-7 9 7" />
            <path d="M5 10v10h14V10" />
          </svg>
          Home
        </button>
        <div className="kids-chip px-[18px]">
          <span
            aria-hidden="true"
            className="kids-glow-dot h-2.5 w-2.5 rounded-full bg-kids-area"
          />
          <span className="font-orbitron text-sm font-black uppercase tracking-[0.08em] text-kids-text">
            {areaName}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleReadAloud}
        aria-pressed={readAloud}
        className={cn(
          'h-10 gap-2.5 px-4 text-sm md:px-5 md:text-base',
          readAloud ? 'kids-read-on' : 'kids-btn kids-btn-off',
        )}
      >
        <Volume2 className="h-5 w-5 md:h-[22px] md:w-[22px]" aria-hidden="true" />
        Read to me
      </button>
    </header>
  );
}
