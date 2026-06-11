import React, { useState } from 'react';
import { Pressable, View, Text, Modal } from 'react-native';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/ThemeContext';

// Lightweight tooltip: long-press to show, tap outside to dismiss.

function TooltipProvider({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

interface TooltipProps {
  children?: React.ReactNode;
}

function Tooltip({ children }: TooltipProps) {
  return <>{children}</>;
}

interface TooltipTriggerProps {
  children?: React.ReactNode;
  onShowTooltip?: () => void;
  className?: string;
}

function TooltipTrigger({
  children,
  onShowTooltip,
  className,
}: TooltipTriggerProps) {
  return (
    <Pressable onLongPress={onShowTooltip} className={className}>
      {children}
    </Pressable>
  );
}

interface TooltipContentProps {
  children?: React.ReactNode;
  className?: string;
  visible?: boolean;
  onDismiss?: () => void;
}

function TooltipContent({
  children,
  className,
  visible = false,
  onDismiss,
}: TooltipContentProps) {
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <Pressable
        className="flex-1 items-center justify-center"
        onPress={onDismiss}
      >
        <View
          className={cn('rounded-md px-3 py-1.5 shadow-md', className)}
          style={{ backgroundColor: colors.primaryAction }}
        >
          <Text className="text-xs" style={{ color: colors.primaryForeground }}>
            {children}
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
}

// Convenience wrapper for the common pattern
interface TooltipWrapProps {
  content: string;
  children?: React.ReactNode;
  className?: string;
}

function TooltipWrap({ content, children, className }: TooltipWrapProps) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <TooltipTrigger
        onShowTooltip={() => setVisible(true)}
        className={className}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent visible={visible} onDismiss={() => setVisible(false)}>
        {content}
      </TooltipContent>
    </>
  );
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipWrap,
};
