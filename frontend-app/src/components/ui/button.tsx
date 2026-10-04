import React from 'react';
import {
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { splitTextClasses } from '@/lib/classNames';

/**
 * Button — RN port of the web's shadcn button (same variants, sizes and
 * tokens). Web `className` strings port verbatim: text-related classes
 * (`text-*`, `font-*`, `tracking-*`, `leading-*`, `uppercase`) are routed to
 * the label <Text> automatically, everything else styles the pressable.
 * Non-string children (icons + text) are laid out in a row with `gap-2`;
 * wrap any text among them in <Text> yourself.
 */
const buttonVariants = cva(
  'flex-row items-center justify-center gap-2 rounded-md',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        destructive: 'bg-destructive',
        outline: 'border border-input bg-background',
        secondary: 'bg-secondary',
        ghost: '',
        link: '',
        // Solid brand-teal CTA (--primary-action) — auth forms, admin dialogs, retries.
        action: 'bg-primary-action',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-10 rounded-md px-8',
        xl: 'h-10 px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

const textVariants = cva('font-medium', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
      link: 'text-primary underline',
      action: 'text-primary-foreground',
    },
    size: {
      default: 'text-sm',
      sm: 'text-xs',
      lg: 'text-sm',
      xl: 'text-sm',
      icon: 'text-sm',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export interface ButtonProps
  extends Omit<PressableProps, 'children' | 'style'>,
    VariantProps<typeof buttonVariants> {
  className?: string;
  /** Extra classes for the label Text (in addition to any routed from className). */
  textClassName?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

const Button = React.forwardRef<View, ButtonProps>(
  (
    {
      className,
      textClassName,
      variant,
      size,
      disabled,
      children,
      style,
      ...props
    },
    ref,
  ) => {
    const { text, rest } = splitTextClasses(className);
    const label = cn(textVariants({ variant, size }), text, textClassName);
    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        className={cn(
          buttonVariants({ variant, size }),
          disabled && 'opacity-50',
          rest,
        )}
        style={({ pressed }) => [
          // web: active:scale-[0.97] + hover:bg-x/90 — the press feedback.
          pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
          style,
        ]}
        {...props}
      >
        {typeof children === 'string' || typeof children === 'number' ? (
          <Text className={label} numberOfLines={1}>
            {children}
          </Text>
        ) : (
          React.Children.map(children, child =>
            typeof child === 'string' || typeof child === 'number' ? (
              <Text className={label}>{child}</Text>
            ) : (
              child
            ),
          )
        )}
      </Pressable>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants, textVariants as buttonTextVariants };
