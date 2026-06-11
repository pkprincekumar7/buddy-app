import React, { forwardRef } from 'react';
import { TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/ThemeContext';

export interface InputProps extends TextInputProps {
  className?: string;
}

const Input = forwardRef<React.ElementRef<typeof TextInput>, InputProps>(
  ({ className, style, ...props }, ref) => {
    const { colors } = useTheme();
    return (
      <TextInput
        ref={ref}
        className={cn(
          'h-9 w-full rounded-md border px-3 py-1 text-base shadow-sm disabled:opacity-50',
          className,
        )}
        style={[
          {
            borderColor: colors.inputBorder,
            color: colors.text,
            backgroundColor: colors.surfaceElevated,
          },
          style,
        ]}
        placeholderTextColor={colors.textMuted}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
