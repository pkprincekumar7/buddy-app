import React from 'react';
import {
  Modal,
  ScrollView,
  Text,
  View,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { MODAL_BACKDROP, MODAL_SCALE } from '@/lib/animations';
import { color } from '@/theme';

/**
 * Dialog — RN port of the web's Radix dialog wrapper (src/components/ui/dialog.tsx),
 * same API shape: <Dialog open onOpenChange><DialogContent>…</DialogContent></Dialog>.
 * Built on RN's <Modal>, which gives the native equivalents of what Radix
 * provides on the web: focus moves into the dialog, the Android back button
 * closes it (onRequestClose), and screen readers treat it as modal.
 * Use this for every new modal — don't hand-roll another overlay.
 */
interface DialogCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
}
const Ctx = React.createContext<DialogCtx>({
  open: false,
  setOpen: () => undefined,
});

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ open, setOpen: (o: boolean) => onOpenChange?.(o) }),
    [open, onOpenChange],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function DialogTrigger({
  children,
}: {
  children: React.ReactElement<{ onPress?: () => void }>;
}) {
  const { setOpen } = React.useContext(Ctx);
  return React.cloneElement(children, { onPress: () => setOpen(true) });
}

export function DialogClose({
  children,
}: {
  children: React.ReactElement<{ onPress?: () => void }>;
}) {
  const { setOpen } = React.useContext(Ctx);
  return React.cloneElement(children, { onPress: () => setOpen(false) });
}

interface DialogContentProps extends ViewProps {
  className?: string;
  /** Hide the top-right X (web always renders it). */
  hideClose?: boolean;
  /** Overlay className override (default `bg-overlay`). */
  overlayClassName?: string;
  /** Dismiss on backdrop tap (Radix default: true). */
  dismissible?: boolean;
}

export function DialogContent({
  className,
  children,
  hideClose,
  overlayClassName,
  dismissible = true,
  ...props
}: DialogContentProps) {
  const { open, setOpen } = React.useContext(Ctx);
  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => setOpen(false)}
    >
      {open ? (
        <Animated.View
          {...MODAL_BACKDROP}
          className={cn(
            'flex-1 items-center justify-center bg-overlay p-4',
            overlayClassName,
          )}
        >
          <Pressable
            className="absolute inset-0"
            accessibilityLabel="Close dialog"
            onPress={() => dismissible && setOpen(false)}
          />
          <Animated.View
            {...MODAL_SCALE}
            accessibilityViewIsModal
            className={cn(
              'max-h-[90%] w-full max-w-lg rounded-lg border border-border bg-background p-6',
              className,
            )}
            style={{ boxShadow: '0 10px 15px rgba(0,0,0,0.25)' }}
            {...props}
          >
            <ScrollView
              bounces={false}
              contentContainerClassName="gap-4"
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {!hideClose && (
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={12}
                className="absolute right-4 top-4 opacity-70"
              >
                <X size={16} color={color.foreground} />
              </Pressable>
            )}
          </Animated.View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

export function DialogHeader({
  className,
  ...props
}: ViewProps & { className?: string }) {
  return <View className={cn('gap-1.5', className)} {...props} />;
}

export function DialogFooter({
  className,
  ...props
}: ViewProps & { className?: string }) {
  return (
    <View className={cn('flex-col-reverse gap-2', className)} {...props} />
  );
}

export function DialogTitle({
  className,
  ...props
}: TextProps & { className?: string }) {
  return (
    <Text
      accessibilityRole="header"
      className={cn(
        'text-center text-lg font-semibold leading-none tracking-tight text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: TextProps & { className?: string }) {
  return (
    <Text
      className={cn('text-center text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
