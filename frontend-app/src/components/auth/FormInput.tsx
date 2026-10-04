import React, { useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';
import { color, hsl } from '@/theme';

export interface FormInputProps extends TextInputProps {
  className?: string;
}

const FOCUS_RING = `0 0 0 2px ${color['primary-medium']}`;
const FOCUS_BORDER = hsl('primary-medium', 0.5);

/**
 * The web's `.form-input` (`border-edge-md w-full rounded-lg bg-surface-input
 * px-3 py-2 text-foreground ring-primary-medium focus:border-primary-medium/50
 * focus:ring-2`) as a TextInput, including the focus ring.
 */
const FormInput = React.forwardRef<TextInput, FormInputProps>(
  ({ className, onFocus, onBlur, style, editable, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    return (
      <TextInput
        ref={ref}
        editable={editable}
        placeholderTextColor={color['muted-foreground']}
        selectionColor={color['primary-medium']}
        className={cn(
          'h-[42px] w-full rounded-lg border border-edge-md bg-surface-input px-3 py-0 text-[16px] text-foreground',
          editable === false && 'opacity-50',
          className,
        )}
        style={[
          focused && { borderColor: FOCUS_BORDER, boxShadow: FOCUS_RING },
          style,
        ]}
        onFocus={e => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={e => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
    );
  },
);
FormInput.displayName = 'FormInput';
export default FormInput;
