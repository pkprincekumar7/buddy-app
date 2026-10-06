import React from 'react';
import { Text, View } from 'react-native';
import { css } from '@/theme';

// web: bg-gradient-to-br from-primary-medium to-success
const LOGO_GRADIENT = css(
  'linear-gradient(to bottom right, hsl(var(--primary-medium)), hsl(var(--success)))',
);

/** The "LP" badge + title + subtitle block shared by Login and Register. */
export default function AuthCardHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View className="mb-8 items-center">
      <View
        className="mb-3 h-12 w-12 items-center justify-center rounded-xl"
        style={{ experimental_backgroundImage: LOGO_GRADIENT }}
      >
        <Text className="text-lg font-bold text-white">LP</Text>
      </View>
      <Text
        accessibilityRole="header"
        className="text-center text-2xl font-bold text-foreground"
      >
        {title}
      </Text>
      <Text className="mt-1 text-center text-sm text-muted-foreground">
        {subtitle}
      </Text>
    </View>
  );
}
