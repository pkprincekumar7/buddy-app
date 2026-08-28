import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PhaseEntry {
  num: number;
  label: string;
  status: 'done' | 'active' | 'upcoming';
  progress?: number; // 0–100, used when status === 'active'
}

interface Props {
  phases: PhaseEntry[];
  stepLabel?: string;
  rightLabel?: string;
}

export default function OnboardingProgressHeader({ phases, stepLabel, rightLabel }: Props) {
  return (
    <div className="border-b-edge-faint sticky top-0 z-30 w-full bg-sidebar/95 backdrop-blur-xl">
      {/* Phase row */}
      <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
        {phases.map((phase, i) => (
          <div
            key={phase.label}
            className={cn(
              'flex items-center',
              i < phases.length - 1
                ? ['min-w-0', phase.status === 'active' ? 'flex-[2]' : 'flex-1']
                : 'shrink-0',
            )}
          >
            {/* Circle badge */}
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-500',
                phase.status === 'done'
                  ? 'border border-success/40 bg-success/20 text-success-bright'
                  : phase.status === 'active'
                    ? 'glow-teal-sm bg-primary text-primary-foreground'
                    : 'border-edge bg-surface-elevated text-muted-foreground/40',
              )}
            >
              {phase.status === 'done' ? <Check className="h-3.5 w-3.5" /> : phase.num}
            </div>

            {/* Label — always visible on sm+; on mobile only the active phase shows its label */}
            <span
              className={cn(
                'ml-2 shrink-0 whitespace-nowrap text-xs font-medium transition-colors duration-500',
                phase.status !== 'active' && 'hidden sm:inline',
                phase.status === 'done'
                  ? 'text-success-bright'
                  : phase.status === 'active'
                    ? 'text-foreground'
                    : 'text-muted-foreground/35',
              )}
            >
              {phase.label}
            </span>

            {/* Progress bar segment (not after last item) */}
            {i < phases.length - 1 && (
              <div className="bg-ghost-strong relative mx-3 h-[2px] min-w-[24px] flex-1 overflow-hidden rounded-full">
                {phase.status === 'done' && (
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                    style={{ originX: 0 }}
                    className="absolute inset-0 rounded-full bg-gradient-to-r from-success to-primary"
                  />
                )}
                {phase.status === 'active' && (
                  <motion.div
                    initial={{ width: '0%' }}
                    animate={{ width: `${Math.max(2, phase.progress ?? 0)}%` }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                    className="absolute bottom-0 left-0 top-0 rounded-full bg-gradient-to-r from-primary to-primary/30"
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Step label row */}
      {(stepLabel ?? rightLabel) && (
        <div className="border-t-edge-xs mx-auto flex max-w-5xl items-center justify-between px-4 py-1.5">
          {stepLabel && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {stepLabel}
            </span>
          )}
          {rightLabel && (
            <span className="text-[10px] italic text-muted-foreground/50">{rightLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
