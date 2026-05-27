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

/**
 * Three-slot action bar: left / center / right.
 *
 * Layout:
 *  - right (the primary CTA) spans the full width on top.
 *  - left + center share a row below, each taking half the width (flex-1).
 *  - If only one of left/center is present it takes the full row width.
 */
export default function PageActions({ left, center, right, className }: PageActionsProps) {
  const bothBottomSlots = left && center;
  const hasBottomRow = left || center;

  return (
    <View className={cn('w-full gap-3', className)}>
      {right ? <View className="w-full">{right}</View> : null}
      {hasBottomRow && (
        bothBottomSlots ? (
          <View className="flex-row gap-3">
            <View style={{ flex: 1 }}>{left}</View>
            <View style={{ flex: 1 }}>{center}</View>
          </View>
        ) : (
          <>
            {left   ? <View className="w-full">{left}</View>   : null}
            {center ? <View className="w-full">{center}</View> : null}
          </>
        )
      )}
    </View>
  );
}
