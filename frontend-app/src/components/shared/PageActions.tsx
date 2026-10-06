import React from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { cn } from '@/lib/utils';

interface PageActionsProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/** Phone layout of the web PageActions: one column, gap-3 (the sm: 3-column grid never applies). */
export default function PageActions({
  left,
  center,
  right,
  className,
}: PageActionsProps) {
  return (
    <View className={cn('w-full gap-3', className)}>
      {left ? <View className="w-full flex-row">{left}</View> : null}
      {center ? <View className="w-full flex-row">{center}</View> : null}
      {right ? <View className="w-full flex-row">{right}</View> : null}
    </View>
  );
}
