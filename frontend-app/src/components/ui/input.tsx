import React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';
import { color } from '@/theme';

export interface InputProps extends TextInputProps {
  className?: string;
}

/**
 * RN port of the web's shadcn input — same border/size/placeholder tokens.
 * Font size is `text-[16px]`, not `text-base`: `text-base` also sets a 24px
 * lineHeight, and a single-line iOS TextInput with a lineHeight shifts its
 * baseline and clips descenders (g, y, p). Don't put line-height classes on
 * single-line inputs.
 */
const Input = React.forwardRef<TextInput, InputProps>(
  ({ className, editable, ...props }, ref) => (
    <TextInput
      ref={ref}
      editable={editable}
      placeholderTextColor={color['muted-foreground']}
      selectionColor={color.ring}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-[16px] text-foreground',
        editable === false && 'opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
