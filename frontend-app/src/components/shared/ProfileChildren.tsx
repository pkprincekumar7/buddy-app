import React, { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { Pencil, Plus, X } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import { MAX_CHILDREN, type Child } from '@/api/children';
import { childPath, childSubtitle } from '@/lib/childPaths';
import { getInitials } from '@/lib/avatarUtils';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import {
  ACTION_ICON,
  ACTION_PRESSED,
  CHILD_DOT,
  DESC,
  DOT_TEXT,
  LINK,
  LINK_ACTIVE,
  NAME,
  NAME_CURRENT,
  ROW_PRESSED,
} from '@/components/layout/profilePalette';

interface ProfileChildrenProps {
  /** The parent's children, newest first (`useChildren`). */
  list: Child[];
  isLoading: boolean;
  isLoadingError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  /** The child whose screen is open: their name is shown in cyan. */
  currentChildId?: string;
  /** Closes the menu: called before any navigation or dialog. */
  onClose: () => void;
  /** Asks to delete a child; the caller confirms first. */
  onDelete: (child: Child) => void;
  /** Hands this device to the child (child view). */
  onChildView?: (child: Child) => void;
}

/** The child's photo, or the cyan dot with their initial. */
function ChildAvatar({ child }: { child: Child }) {
  if (child.avatar_url) {
    return (
      <Image
        source={{ uri: child.avatar_url }}
        accessibilityIgnoresInvertColors
        className="h-7 w-7 rounded-full"
      />
    );
  }
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      className="h-7 w-7 items-center justify-center rounded-full"
      style={{ experimental_backgroundImage: CHILD_DOT }}
    >
      <Text style={[DOT_TEXT, { fontSize: 12 }]}>
        {getInitials(child.name).charAt(0)}
      </Text>
    </View>
  );
}

/**
 * One child's row (web `.profile-row-group`): the row is the box, holding the
 * main button and the edit and delete icons, and the whole box shows the
 * press, so the icons sit inside it.
 */
function ChildRow({
  child,
  current,
  onClose,
  onDelete,
  onChildView,
}: {
  child: Child;
  current: boolean;
  onClose: () => void;
  onDelete: (child: Child) => void;
  onChildView?: (child: Child) => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <View
      className="flex-row items-center gap-1 rounded-[10px] pr-1.5"
      style={pressed ? ROW_PRESSED : undefined}
    >
      <Pressable
        onPress={() => {
          onClose();
          // The prototype's profile list: a child's row switches to their child view.
          // A child still in setup opens their onboarding instead.
          if (onChildView && child.progress.conversation) onChildView(child);
          else navigate(childPath(child));
        }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={`${child.name}, ${childSubtitle(child)}`}
        accessibilityHint={
          onChildView && child.progress.conversation
            ? `Switches to ${child.name}'s child view`
            : undefined
        }
        accessibilityState={{ selected: current }}
        className="min-w-0 flex-1 flex-row items-center gap-2.5 py-2 pl-2.5"
      >
        <ChildAvatar child={child} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} style={[NAME, current && NAME_CURRENT]}>
            {child.name}
          </Text>
          <Text numberOfLines={1} style={DESC}>
            {childSubtitle(child)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => {
          onClose();
          navigate(`/Onboarding/${child.id}`);
        }}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${child.name}'s profile`}
        className="h-9 w-9 items-center justify-center rounded-lg"
        style={({ pressed: p }) => (p ? ACTION_PRESSED : undefined)}
      >
        <Pencil size={14} color={ACTION_ICON} />
      </Pressable>
      <Pressable
        onPress={() => {
          onClose();
          onDelete(child);
        }}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${child.name}`}
        className="h-9 w-9 items-center justify-center rounded-lg active:bg-error-medium/10"
      >
        <X size={16} color={ACTION_ICON} />
      </Pressable>
    </View>
  );
}

/**
 * The profile menu's children (web components/shared/ProfileChildren), under
 * the signed-in parent: each child (switches to their child view; one still in
 * setup opens their onboarding), the pencil edits their profile, × deletes
 * them, then "+ Add Child". Parents only; AppHeader doesn't render it for admins.
 */
export default function ProfileChildren({
  list,
  isLoading,
  isLoadingError,
  isFetching,
  onRetry,
  currentChildId,
  onClose,
  onDelete,
  onChildView,
}: ProfileChildrenProps) {
  const atLimit = list.length >= MAX_CHILDREN;

  return (
    <>
      {isLoading ? (
        <Text className="px-2.5 py-2" style={DESC}>
          Loading your children…
        </Text>
      ) : isLoadingError ? (
        <View className="flex-row items-center justify-between gap-2 px-2.5 py-2">
          <Text className="flex-1" style={DESC}>
            Couldn&apos;t load your children.
          </Text>
          <Pressable
            onPress={onRetry}
            disabled={isFetching}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            className={cn('rounded-lg px-2 py-1', isFetching && 'opacity-50')}
            style={({ pressed }) => (pressed ? ROW_PRESSED : undefined)}
          >
            <Text style={[LINK, { color: LINK_ACTIVE }]}>
              {isFetching ? 'Trying…' : 'Try again'}
            </Text>
          </Pressable>
        </View>
      ) : list.length > 0 ? (
        <ScrollView className="max-h-64" nestedScrollEnabled>
          {list.map(child => (
            <ChildRow
              key={child.id}
              child={child}
              current={child.id === currentChildId}
              onClose={onClose}
              onDelete={onDelete}
              {...(onChildView && { onChildView })}
            />
          ))}
        </ScrollView>
      ) : null}

      <Pressable
        onPress={() => {
          onClose();
          navigate('/Onboarding', { state: { forceNew: true } });
        }}
        disabled={atLimit}
        accessibilityRole="button"
        accessibilityLabel="Add Child"
        accessibilityState={{ disabled: atLimit }}
        className={cn(
          'w-full flex-row items-center gap-2.5 rounded-[10px] px-2.5 py-2',
          atLimit && 'opacity-50',
        )}
        style={({ pressed }) => (pressed ? ROW_PRESSED : undefined)}
      >
        <Plus size={16} color={LINK_ACTIVE} />
        <Text style={[LINK, { color: LINK_ACTIVE }]}>Add Child</Text>
      </Pressable>
      {atLimit ? (
        <Text className="px-2.5 pb-1" style={DESC}>
          Maximum of {MAX_CHILDREN} children
        </Text>
      ) : null}
    </>
  );
}
