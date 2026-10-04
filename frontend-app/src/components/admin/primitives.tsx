import React from 'react';
import { Text, View, type ViewProps } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { color, rgb } from '@/theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Spinner from '@/components/shared/Spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ─── Card (web components/ui/card.tsx) ───────────────────────────────────────
// web `shadow`: 0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1)
const CARD_SHADOW = `0 1px 3px 0 ${rgb('black', 0.1)}, 0 1px 2px -1px ${rgb(
  'black',
  0.1,
)}`;

/** web `<Card className="border-edge bg-card">`. */
export function Card({
  className,
  style,
  ...props
}: ViewProps & { className?: string }) {
  return (
    <View
      className={cn('rounded-xl border border-edge bg-card', className)}
      style={[{ boxShadow: CARD_SHADOW }, style]}
      {...props}
    />
  );
}

/** web `<CardHeader className="pb-3">` (p-6, space-y-1.5). */
export function CardHeader({
  className,
  ...props
}: ViewProps & { className?: string }) {
  return <View className={cn('gap-1.5 p-6 pb-3', className)} {...props} />;
}

/** web `<CardTitle className="text-sm font-medium text-foreground">` (leading-none tracking-tight). */
export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text
      accessibilityRole="header"
      className="text-sm font-medium leading-none text-foreground"
      style={{ letterSpacing: -0.35 }}
    >
      {children}
    </Text>
  );
}

/** web `<CardContent>` (p-6 pt-0). */
export function CardContent({
  className,
  ...props
}: ViewProps & { className?: string }) {
  return <View className={cn('p-6 pt-0', className)} {...props} />;
}

// ─── Tabs (web components/ui/tabs.tsx, Radix) ────────────────────────────────
export function TabsList({ children }: { children: React.ReactNode }) {
  return (
    <View
      accessibilityRole="tablist"
      className="h-9 w-full flex-row items-center rounded-lg bg-muted p-1"
    >
      {children}
    </View>
  );
}

// web data-[state=active]:shadow
const ACTIVE_TAB_SHADOW = CARD_SHADOW;

export function TabsTrigger({
  label,
  active,
  onPress,
  Icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
}) {
  const fg = active ? color.foreground : color['muted-foreground'];
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'h-full flex-1 flex-row items-center justify-center gap-2 rounded-md px-3 py-1',
        active && 'bg-background',
      )}
      style={active ? { boxShadow: ACTIVE_TAB_SHADOW } : undefined}
    >
      <Icon size={16} color={fg} />
      <Text
        numberOfLines={1}
        className={cn(
          'text-sm font-medium',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Small shared pieces ─────────────────────────────────────────────────────
/** web `<div className="flex items-center justify-center py-10"><div className="h-6 w-6 animate-spin …" /></div>`. */
export function ListSpinner() {
  return (
    <View className="items-center justify-center py-10">
      <Spinner className="h-6 w-6" durationSeconds={1} />
    </View>
  );
}

/** Search row: Input + outline icon button (spinner while searching). */
export function SearchRow({
  value,
  onChangeText,
  onSubmit,
  searching,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  searching: boolean;
  accessibilityLabel: string;
}) {
  return (
    <View className="flex-row gap-2">
      <Input
        className="flex-1"
        placeholder="user@example.com"
        accessibilityLabel={accessibilityLabel}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
      />
      <Button
        variant="outline"
        className="border-edge"
        accessibilityLabel="Search"
        onPress={onSubmit}
        disabled={searching || !value.trim()}
      >
        {searching ? (
          <Spinner className="h-4 w-4" durationSeconds={1} />
        ) : (
          <Search size={16} color={color.foreground} />
        )}
      </Button>
    </View>
  );
}

/** Previous / Page x of y / Next footer under a list. */
export function Pager({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const muted = color['muted-foreground'];
  return (
    <View className="flex-row items-center justify-between border-t border-edge px-5 py-3">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground"
        accessibilityLabel="Previous page"
        disabled={page === 0}
        onPress={onPrev}
      >
        <ChevronLeft size={16} color={muted} />
        Previous
      </Button>
      <Text className="text-xs text-muted-foreground">
        Page {page + 1} of {totalPages}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground"
        accessibilityLabel="Next page"
        disabled={page >= totalPages - 1}
        onPress={onNext}
      >
        Next
        <ChevronRight size={16} color={muted} />
      </Button>
    </View>
  );
}

/** web `<span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">Locked</span>`. */
export function LockedBadge() {
  return (
    <View className="rounded-full bg-error/10 px-2 py-0.5">
      <Text className="text-xs font-medium text-error">Locked</Text>
    </View>
  );
}

// ─── AlertDialog (web components/ui/alert-dialog.tsx) ────────────────────────
/**
 * Radix AlertDialog on the Dialog primitive: no close X, no dismiss on
 * backdrop tap (Android back still cancels), title/description centred
 * (web's base breakpoint), footer stacked with the action on top.
 */
export function AlertDialog({
  open,
  onCancel,
  title,
  description,
  actionLabel,
  actionClassName,
  actionDisabled,
  onAction,
}: {
  open: boolean;
  onCancel: () => void;
  title: string;
  description: React.ReactNode;
  actionLabel: string;
  actionClassName: string;
  actionDisabled?: boolean;
  onAction: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onCancel()}>
      <DialogContent
        hideClose
        dismissible={false}
        className="border border-edge bg-card"
      >
        <DialogHeader className="gap-2">
          <DialogTitle className="leading-normal tracking-normal text-foreground">
            {title}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        {/* web: flex-col-reverse — Cancel (mt-2) renders below the action. */}
        <DialogFooter className="gap-0">
          <Button
            variant="outline"
            accessibilityLabel="Cancel"
            className="mt-2 border-edge"
            onPress={onCancel}
          >
            Cancel
          </Button>
          <Button
            accessibilityLabel={actionLabel}
            className={actionClassName}
            disabled={actionDisabled}
            onPress={onAction}
          >
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
