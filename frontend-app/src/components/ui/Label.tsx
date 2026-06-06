import React, { forwardRef } from 'react';
import { Text } from 'react-native';
import type { TextProps } from 'react-native';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/ThemeContext';

export interface LabelProps extends TextProps {
  className?: string;
}

const Label = forwardRef<React.ElementRef<typeof Text>, LabelProps>(
  ({ className, style, ...props }, ref) => {
    const { colors } = useTheme();
    return (
      <Text
        ref={ref}
        className={cn('text-sm font-medium leading-none', className)}
        style={[{ color: colors.text }, style]}
        {...props}
      />
    );
  },
);
Label.displayName = 'Label';

export { Label };
