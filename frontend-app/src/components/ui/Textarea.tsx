import React, { forwardRef } from 'react';
import { TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/ThemeContext';

export interface TextareaProps extends TextInputProps {
  className?: string;
}

const Textarea = forwardRef<React.ElementRef<typeof TextInput>, TextareaProps>(
  ({ className, style, ...props }, ref) => {
    const { colors } = useTheme();
    return (
      <TextInput
        ref={ref}
        multiline
        textAlignVertical="top"
        className={cn(
          'min-h-[60px] w-full rounded-md border px-3 py-2 text-base shadow-sm disabled:opacity-50',
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
Textarea.displayName = 'Textarea';

export { Textarea };
