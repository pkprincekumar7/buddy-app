import React from 'react';
import { Modal, View, Pressable, Text, ScrollView } from 'react-native';
import type { ViewProps } from 'react-native';
import { cn } from '@/lib/utils';

// Dialog (maps to RN Modal)

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

function Dialog({ open = false, onOpenChange, children }: DialogProps) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => onOpenChange?.(false)}
    >
      {children}
    </Modal>
  );
}

function DialogTrigger({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) {
  return <Pressable onPress={onPress}>{children}</Pressable>;
}

function DialogClose({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) {
  return <Pressable onPress={onPress}>{children}</Pressable>;
}

interface DialogContentProps extends ViewProps {
  children?: React.ReactNode;
  className?: string;
  onClose?: () => void;
}

function DialogContent({ children, className, onClose, ...props }: DialogContentProps) {
  return (
    <View className="flex-1 items-center justify-center bg-black/80">
      <Pressable className="absolute inset-0" onPress={onClose} />
      <View
        className={cn(
          'relative z-10 w-[90%] max-w-lg rounded-lg bg-background p-6 shadow-lg',
          className,
        )}
        {...props}
      >
        {onClose && (
          <Pressable className="absolute right-4 top-4 opacity-70" onPress={onClose}>
            <Text className="text-foreground text-lg">✕</Text>
          </Pressable>
        )}
        {children}
      </View>
    </View>
  );
}

function DialogHeader({ className, ...props }: ViewProps & { className?: string }) {
  return <View className={cn('flex-col gap-1.5 mb-4', className)} {...props} />;
}

function DialogFooter({ className, ...props }: ViewProps & { className?: string }) {
  return <View className={cn('flex-row justify-end gap-2 mt-4', className)} {...props} />;
}

function DialogTitle({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <Text className={cn('text-lg font-semibold leading-none text-foreground', className)}>
      {children}
    </Text>
  );
}

function DialogDescription({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <Text className={cn('text-sm text-muted-foreground', className)}>{children}</Text>
  );
}

function DialogScrollContent({ children, className, onClose, ...props }: DialogContentProps) {
  return (
    <View className="flex-1 items-center justify-center bg-black/80">
      <Pressable className="absolute inset-0" onPress={onClose} />
      <View className={cn('relative z-10 w-[90%] max-w-lg rounded-lg bg-background shadow-lg', className)} {...props}>
        {onClose && (
          <Pressable className="absolute right-4 top-4 z-10 opacity-70" onPress={onClose}>
            <Text className="text-foreground text-lg">✕</Text>
          </Pressable>
        )}
        <ScrollView className="max-h-[80vh] p-6">{children}</ScrollView>
      </View>
    </View>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogScrollContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
