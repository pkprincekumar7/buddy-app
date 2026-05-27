import React, { forwardRef } from 'react';
import { TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';

export interface InputProps extends TextInputProps {
  className?: string;
}

const Input = forwardRef<React.ElementRef<typeof TextInput>, InputProps>(
  ({ className, ...props }, ref) => (
    <TextInput
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base text-foreground shadow-sm placeholder:text-muted-foreground disabled:opacity-50',
        className,
      )}
      placeholderTextColor="hsl(var(--muted-foreground))"
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
