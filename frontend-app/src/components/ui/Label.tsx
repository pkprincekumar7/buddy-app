import React, { forwardRef } from 'react';
import { Text } from 'react-native';
import type { TextProps } from 'react-native';
import { cn } from '@/lib/utils';

export interface LabelProps extends TextProps {
  className?: string;
}

const Label = forwardRef<React.ElementRef<typeof Text>, LabelProps>(
  ({ className, ...props }, ref) => (
    <Text
      ref={ref}
      className={cn(
        'text-sm font-medium leading-none text-foreground',
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = 'Label';

export { Label };
