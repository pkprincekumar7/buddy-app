import React, { forwardRef } from 'react';
import { Pressable, Text, ActivityIndicator } from 'react-native';
import type { PressableProps } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/ThemeContext';

const buttonVariants = cva(
  'flex-row items-center justify-center rounded-md gap-2 select-none',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        destructive: 'bg-destructive',
        outline: 'border',
        secondary: 'bg-secondary',
        ghost: 'bg-transparent',
        link: 'bg-transparent',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        lg: 'h-10 px-8',
        xl: 'h-12 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

const textSizeClass = cva('font-medium', {
  variants: {
    size: {
      default: 'text-sm',
      sm: 'text-xs',
      lg: 'text-sm',
      xl: 'text-base',
      icon: 'text-sm',
    },
  },
  defaultVariants: { size: 'default' },
});

export interface ButtonProps
  extends Omit<PressableProps, 'children'>,
    VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  className?: string;
  textClassName?: string;
  loading?: boolean;
}

const Button = forwardRef<React.ElementRef<typeof Pressable>, ButtonProps>(
  (
    {
      className,
      textClassName,
      variant,
      size,
      children,
      disabled,
      loading,
      style,
      ...props
    },
    ref,
  ) => {
    const { colors } = useTheme();
    const isDisabled = disabled || loading;

    // Variant-specific style overrides — always use JS styles for backgrounds so
    // light mode works (NativeWind tailwind.config only has dark-mode HSL values).
    const variantStyle = (() => {
      switch (variant) {
        case 'default':
        case 'destructive':
          return {
            backgroundColor:
              variant === 'destructive' ? colors.error : colors.primaryAction,
          };
        case 'secondary':
          return { backgroundColor: colors.muted };
        case 'outline':
          return {
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
          };
        case 'ghost':
        case 'link':
          return { backgroundColor: 'transparent' as const };
        default:
          return { backgroundColor: colors.primaryAction };
      }
    })();

    const textColor = (() => {
      switch (variant) {
        case 'default':
          return colors.primaryForeground;
        case 'outline':
        case 'ghost':
        case 'secondary':
          return colors.text;
        case 'link':
          return colors.primary;
        case 'destructive':
          return colors.primaryForeground;
        default:
          return colors.primaryForeground;
      }
    })();

    return (
      <Pressable
        ref={ref}
        disabled={isDisabled}
        className={cn(
          buttonVariants({ variant, size }),
          isDisabled && 'opacity-50',
          className,
        )}
        style={variantStyle ? [variantStyle, style as any] : style}
        {...props}
      >
        {loading && <ActivityIndicator size="small" color={textColor} />}
        {typeof children === 'string' ? (
          <Text
            className={cn(
              textSizeClass({ size }),
              variant === 'link' && 'underline',
              textClassName,
            )}
            style={{ color: textColor }}
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </Pressable>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
