import React, { useEffect } from 'react';
import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends ViewProps {
  className?: string;
}

function Skeleton({ className, ...props }: SkeletonProps) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(0.4, { duration: 600 }), withTiming(1, { duration: 600 })),
      -1,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={animatedStyle}>
      <View className={cn('rounded-md bg-primary/10', className)} {...props} />
    </Animated.View>
  );
}

export { Skeleton };
