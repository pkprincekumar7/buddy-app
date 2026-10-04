import React from 'react';
import { Text, type TextProps } from 'react-native';
import { cn } from '@/lib/utils';

export interface LabelProps extends TextProps {
  className?: string;
  /**
   * web `htmlFor`. RN has no label↔input association, so pair this with the
   * input's `accessibilityLabel` (or `accessibilityLabelledBy` on Android).
   */
  nativeID?: string;
}

/** RN port of the web's shadcn label. */
export function Label({ className, ...props }: LabelProps) {
  return (
    <Text
      className={cn(
        'text-sm font-medium leading-none text-foreground',
        className,
      )}
      {...props}
    />
  );
}
