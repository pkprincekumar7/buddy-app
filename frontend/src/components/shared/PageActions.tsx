import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageActionsProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}

export default function PageActions({ left, center, right, className }: PageActionsProps) {
  return (
    <div className={cn('grid w-full grid-cols-1 gap-3 sm:grid-cols-3 sm:items-center', className)}>
      <div className="flex w-full sm:justify-start">{left}</div>
      <div className="flex w-full sm:justify-center">{center}</div>
      <div className="flex w-full sm:justify-end">{right}</div>
    </div>
  );
}
