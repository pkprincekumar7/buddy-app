import React, { useState } from 'react';
import {
  Pressable as RNPressable,
  type GestureResponderEvent,
  type PressableProps as RNPressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';

export interface PressableProps extends Omit<RNPressableProps, 'style'> {
  className?: string;
  style?:
    | StyleProp<ViewStyle>
    | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
}

/**
 * Drop-in for RN's Pressable that supports `style={({ pressed }) => …}`
 * together with a NativeWind `className`. NativeWind's interop drops a
 * function `style` when `className` is present, which silently removed every
 * gradient (`experimental_backgroundImage`), glow (`boxShadow`) and press
 * transform passed that way. Here the pressed state is tracked locally and the
 * style is resolved to a plain object before it reaches the native Pressable.
 * Always import Pressable from here, not from 'react-native'.
 */
export const Pressable = React.forwardRef<View, PressableProps>(
  ({ style, onPressIn, onPressOut, ...props }, ref) => {
    const [pressed, setPressed] = useState(false);
    const resolved =
      typeof style === 'function'
        ? style({ pressed, hovered: false } as PressableStateCallbackType)
        : style;
    return (
      <RNPressable
        ref={ref}
        onPressIn={(e: GestureResponderEvent) => {
          setPressed(true);
          onPressIn?.(e);
        }}
        onPressOut={(e: GestureResponderEvent) => {
          setPressed(false);
          onPressOut?.(e);
        }}
        style={resolved}
        {...props}
      />
    );
  },
);
Pressable.displayName = 'Pressable';
