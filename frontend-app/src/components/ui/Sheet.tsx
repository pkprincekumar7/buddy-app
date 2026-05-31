import React, { useEffect } from 'react';
import { Modal, View, Pressable, Text, Dimensions } from 'react-native';
import type { ViewProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { cn } from '@/lib/utils';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

function Sheet({ open = false, onOpenChange, children }: SheetProps) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      onRequestClose={() => onOpenChange?.(false)}
    >
      {children}
    </Modal>
  );
}

function SheetTrigger({
  children,
  onPress,
}: {
  children?: React.ReactNode;
  onPress?: () => void;
}) {
  return <Pressable onPress={onPress}>{children}</Pressable>;
}

function SheetClose({
  children,
  onPress,
}: {
  children?: React.ReactNode;
  onPress?: () => void;
}) {
  return <Pressable onPress={onPress}>{children}</Pressable>;
}

type SheetSide = 'bottom' | 'top' | 'left' | 'right';

interface SheetContentProps extends ViewProps {
  side?: SheetSide;
  children?: React.ReactNode;
  className?: string;
  onClose?: () => void;
}

function SheetContent({
  side: _side = 'bottom',
  children,
  className,
  onClose,
  ...props
}: SheetContentProps) {
  const translateY = useSharedValue(SCREEN_HEIGHT);

  useEffect(() => {
    translateY.value = withTiming(0, { duration: 350 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    translateY.value = withTiming(
      SCREEN_HEIGHT,
      { duration: 300 },
      finished => {
        if (finished) runOnJS(onClose ?? (() => {}))();
      },
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View className="flex-1 justify-end">
      <Pressable
        className="absolute inset-0 bg-black/80"
        onPress={handleClose}
      />
      <Animated.View
        style={animatedStyle}
        className={cn(
          'relative z-10 rounded-t-2xl bg-background p-6 shadow-lg',
          className,
        )}
        {...props}
      >
        <View className="mb-4 flex-row items-center justify-between">
          <View className="mx-auto h-1.5 w-12 rounded-full bg-muted" />
          {onClose && (
            <Pressable
              className="absolute right-0 opacity-70"
              onPress={handleClose}
            >
              <Text className="text-foreground">✕</Text>
            </Pressable>
          )}
        </View>
        {children}
      </Animated.View>
    </View>
  );
}

function SheetHeader({
  className,
  ...props
}: ViewProps & { className?: string }) {
  return <View className={cn('flex-col gap-1.5 mb-4', className)} {...props} />;
}

function SheetFooter({
  className,
  ...props
}: ViewProps & { className?: string }) {
  return (
    <View
      className={cn('flex-row justify-end gap-2 mt-4', className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Text className={cn('text-lg font-semibold text-foreground', className)}>
      {children}
    </Text>
  );
}

function SheetDescription({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Text className={cn('text-sm text-muted-foreground', className)}>
      {children}
    </Text>
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
