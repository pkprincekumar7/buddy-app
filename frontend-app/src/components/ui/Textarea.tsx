import React, { forwardRef } from 'react';
import { TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';

export interface TextareaProps extends TextInputProps {
  className?: string;
}

const Textarea = forwardRef<React.ElementRef<typeof TextInput>, TextareaProps>(
  ({ className, ...props }, ref) => (
    <TextInput
      ref={ref}
      multiline
      textAlignVertical="top"
      className={cn(
        'min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base text-foreground shadow-sm placeholder:text-muted-foreground disabled:opacity-50',
        className,
      )}
      placeholderTextColor="hsl(var(--muted-foreground))"
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
