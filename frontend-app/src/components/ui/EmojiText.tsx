import React from 'react';
import { Text } from 'react-native';

const SIZES = {
  sm:   14,
  base: 16,
  lg:   18,
  xl:   20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
} as const;

type EmojiSize = keyof typeof SIZES;

interface Props {
  size?: EmojiSize;
  children: React.ReactNode;
}

export function EmojiText({ size = 'base', children }: Props) {
  return (
    <Text style={{ fontSize: SIZES[size], lineHeight: SIZES[size] * 1.4 }}>
      {children}
    </Text>
  );
}
