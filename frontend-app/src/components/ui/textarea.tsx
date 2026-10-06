import React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';
import { color } from '@/theme';

export interface TextareaProps extends TextInputProps {
  className?: string;
  /** web `rows` — sets the minimum visible height (≈24px per row + padding). */
  rows?: number;
}

/** RN port of the web's shadcn textarea. */
const Textarea = React.forwardRef<TextInput, TextareaProps>(
  ({ className, rows, style, editable, ...props }, ref) => (
    <TextInput
      ref={ref}
      multiline
      textAlignVertical="top"
      editable={editable}
      placeholderTextColor={color['muted-foreground']}
      selectionColor={color.ring}
      className={cn(
        'min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base text-foreground',
        editable === false && 'opacity-50',
        className,
      )}
      style={[rows ? { minHeight: rows * 24 + 16 } : null, style]}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
