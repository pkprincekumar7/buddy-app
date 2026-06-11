import React, { forwardRef, useState } from 'react';
import { Pressable } from 'react-native';
import type { PressableProps } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/ThemeContext';

export const toggleVariants = cva(
  'flex-row items-center justify-center rounded-md gap-2',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border bg-transparent shadow-sm',
      },
      size: {
        default: 'h-9 px-2 min-w-[36px]',
        sm: 'h-8 px-1.5 min-w-[32px]',
        lg: 'h-10 px-2.5 min-w-[40px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ToggleProps
  extends Omit<PressableProps, 'children'>,
    VariantProps<typeof toggleVariants> {
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

const Toggle = forwardRef<React.ElementRef<typeof Pressable>, ToggleProps>(
  (
    {
      className,
      variant,
      size,
      pressed: controlledPressed,
      onPressedChange,
      children,
      disabled,
      style,
      ...props
    },
    ref,
  ) => {
    const { colors } = useTheme();
    const [internalPressed, setInternalPressed] = useState(false);
    const isPressed = controlledPressed ?? internalPressed;

    const handlePress = () => {
      const next = !isPressed;
      setInternalPressed(next);
      onPressedChange?.(next);
    };

    const variantStyle =
      variant === 'outline'
        ? { borderWidth: 1, borderColor: colors.border }
        : undefined;
    const pressedStyle = isPressed
      ? { backgroundColor: colors.muted }
      : undefined;

    return (
      <Pressable
        ref={ref}
        disabled={disabled}
        onPress={handlePress}
        className={cn(
          toggleVariants({ variant, size }),
          disabled && 'opacity-50',
          className,
        )}
        style={[variantStyle, pressedStyle, style as any]}
        {...props}
      >
        {children}
      </Pressable>
    );
  },
);
Toggle.displayName = 'Toggle';

export { Toggle };
