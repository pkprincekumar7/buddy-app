import React from 'react';
import { Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { navigate, useParams } from '@/lib/router';
import { cn } from '@/lib/utils';
import { color } from '@/theme';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { appBarFade, useAppBarHidden } from '@/lib/appBar';
import { useAuth } from '@/lib/AuthContext';
import { useViewMode } from '@/lib/ViewModeContext';
import { useChildren } from '@/hooks/useChildren';
import { ChildAvatar } from '@/components/shared/ProfileChildren';
import {
  CHILD_CHIP,
  CHILD_CHIP_TEXT,
} from '@/components/layout/profilePalette';

/**
 * The web Layout's "Back" row (`px-4 pt-4`, ghost sm button) that sits in the
 * page flow directly under the header and scrolls away with the content.
 * Every Layout page renders it as the first child of its scroll content —
 * <PageScroll> does this for you. On the right, in parent view, the child
 * whose page this is, so a parent of several can tell (child view is that
 * child's own).
 */
export default function PageBackRow({ className }: { className?: string }) {
  // Hidden with the app bar while a splash or the journey's warp plays (lib/appBar).
  const hidden = useAppBarHidden();
  const reduced = useReducedMotion();
  const { childId } = useParams();
  const { user, isAuthenticated } = useAuth();
  const { view } = useViewMode();
  const isParent = isAuthenticated && user?.role === 'parent';
  const kids = useChildren(isParent);
  const child =
    view.mode === 'child' ? undefined : kids.list.find(c => c.id === childId);
  return (
    <Animated.View
      className={cn(
        'flex-row items-center justify-between gap-3 px-4 pt-4',
        className,
      )}
      style={appBarFade(hidden, reduced)}
      pointerEvents={hidden ? 'none' : 'auto'}
    >
      <Button
        variant="ghost"
        size="sm"
        onPress={() => navigate(-1)}
        accessibilityLabel="Back"
      >
        <ArrowLeft size={16} color={color['muted-foreground']} />
        <Text className="text-xs font-medium text-muted-foreground">Back</Text>
      </Button>
      {child ? (
        <View
          // No taller than the Back button beside it, so the row (and the page under it) keeps
          // its height and the glow isn't cut at the row's edge.
          className="shrink flex-row items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-3"
          style={[CHILD_CHIP, { maxWidth: '60%' }]}
          accessible
          accessibilityLabel={`Child: ${child.name}`}
          testID="page-child"
        >
          <ChildAvatar child={child} size={22} fontSize={10} />
          <Text
            className="shrink"
            style={CHILD_CHIP_TEXT}
            numberOfLines={1}
            testID="page-child-name"
          >
            {child.name}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
