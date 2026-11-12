import { displayName } from '@/api/account';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import {
  ArrowLeft,
  House,
  LogOut,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react-native';
import { useAuth } from '@/lib/AuthContext';
import { useTts } from '@/lib/TtsContext';
import { stopSpeech } from '@/lib/tts';
import { getInitials } from '@/lib/avatarUtils';
import { navigate, resetTo, type PageName } from '@/lib/router';
import { useViewMode } from '@/lib/ViewModeContext';
import { childViewHome } from '@/lib/childView';
import { useStartOver } from '@/hooks/useStartOver';
import { useChildren } from '@/hooks/useChildren';
import { useDeleteChild } from '@/hooks/useDeleteChild';
import type { Child } from '@/api/children';
import { ConfirmModal } from '@/components/shared/StartOverButton';
import { startOverCopy } from '@/lib/startOverCopy';
import ProfileChildren from '@/components/shared/ProfileChildren';
import {
  DESC,
  DIVIDER,
  DOT_TEXT,
  HEADING,
  LINK,
  LINK_ACTIVE,
  LINK_COLOR,
  NAME,
  PANEL,
  CHILD_DOT,
  PARENT_DOT,
  PILL,
  PILL_PRESSED,
  ROW_PRESSED,
  ROW_SELECTED,
} from '@/components/layout/profilePalette';
import { MODAL_BACKDROP, MODAL_SCALE } from '@/lib/animations';
import { color, css, font, gradient, hsl, rgb } from '@/theme';

// Maps a page to the seven-circle node label that leads to it, so the header
// shows the same text as the circle the user tapped (web Layout CIRCLE_LABELS).
const CIRCLE_LABELS: Partial<Record<PageName, string>> = {
  Connect: 'Connect',
  PersonalityProfile: 'Discover',
  LifePathway: 'Transform',
  GrowthAreas: 'Grow',
  Observations: 'Release',
};

export const HEADER_HEIGHT = 64;

interface AppHeaderProps {
  currentPageName: PageName;
  childId?: string;
}

/**
 * RN port of the web Layout's top navigation, at its small-screen layout:
 * cyan orb + SUPERPOWER wordmark with the circle label stacked beneath it,
 * then the voice toggle, Start Over (child pages only) and profile avatar.
 */
export default function AppHeader({
  currentPageName,
  childId,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, logout } = useAuth();
  const { ttsEnabled, toggleTts } = useTts();
  const { doStartOver, isStartingOver } = useStartOver(childId);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // The Children group is for parents; admins have no children.
  const isParent = isAuthenticated && user?.role === 'parent';
  const kids = useChildren(isParent);
  const currentChild = kids.list.find(c => c.id === childId);
  const { deleteChild, deletingId } = useDeleteChild();
  const [childToDelete, setChildToDelete] = useState<Child | null>(null);
  // A delete asked for from the menu waits for the menu to close on iOS, which
  // can't present the confirmation while the menu's Modal is still dismissing:
  // the menu's onDismiss shows it. Android has nothing to wait for.
  const pendingDeleteRef = useRef<Child | null>(null);
  const showPendingDelete = useCallback(() => {
    const pending = pendingDeleteRef.current;
    pendingDeleteRef.current = null;
    if (pending) setChildToDelete(pending);
  }, []);
  const requestDelete = useCallback((child: Child) => {
    if (Platform.OS === 'ios') pendingDeleteRef.current = child;
    else setChildToDelete(child);
  }, []);

  const confirmDelete = async (child: Child) => {
    setChildToDelete(null);
    // Deleting the child whose screen is open leaves nothing to show there.
    if ((await deleteChild(child.id)) && child.id === childId) {
      navigate('/Home', { replace: true });
    }
  };

  // Cancel any in-progress speech when TTS is disabled, and when the app is backgrounded
  // (web: speechSynthesis.cancel() on toggle-off and on visibilitychange → hidden).
  useEffect(() => {
    if (!ttsEnabled) stopSpeech();
  }, [ttsEnabled]);
  useEffect(() => {
    const sub = AppState.addEventListener(
      'change',
      s => s !== 'active' && stopSpeech(),
    );
    return () => sub.remove();
  }, []);

  const circleLabel = CIRCLE_LABELS[currentPageName];
  // Child view (docs/child-view-build-plan.md, 1.2): the button and menu show the child.
  const { view, enterChildView, exitChildView } = useViewMode();
  const childView = view.mode === 'child';
  const viewChild = childView
    ? kids.list.find(c => c.id === view.childId)
    : undefined;
  const parentName = displayName(user) ?? 'You';
  const profileName = childView ? viewChild?.name ?? 'Child' : parentName;
  const profileInitial = getInitials(profileName).charAt(0);

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: hsl('sidebar-background', 0.9),
      }}
      className="z-40"
    >
      <View className="h-16 flex-row items-center justify-between px-4">
        {/* Logo */}
        <Pressable
          onPress={() => navigate('/Home')}
          accessibilityRole="link"
          accessibilityLabel="Home"
          className="flex-row items-center gap-2.5"
        >
          <View
            className="h-8 w-8 shrink-0 rounded-full"
            style={{
              experimental_backgroundImage: gradient.orbCyan,
              boxShadow: css(
                '0 0 16px rgb(var(--constellation-cyan-rgb) / .7)',
              ),
            }}
          />
          {/* Stacked below the sm breakpoint, exactly as the web header on a 375px screen. */}
          <View className="items-start gap-0.5">
            <Text
              className="text-sm leading-none text-sidebar-foreground"
              style={[font('orbitron', 900), { letterSpacing: 14 * 0.06 }]}
              numberOfLines={1}
            >
              SUPERPOWER
            </Text>
            {circleLabel ? (
              <Text
                className="uppercase leading-none"
                style={[
                  font('rajdhani', 700),
                  {
                    fontSize: 11,
                    letterSpacing: 11 * 0.22,
                    color: rgb('constellation-cyan'),
                  },
                ]}
              >
                {circleLabel}
              </Text>
            ) : null}
          </View>
        </Pressable>

        {/* Right side controls */}
        <View className="flex-row items-center gap-2">
          <HeaderIconButton
            label={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
            selected={ttsEnabled}
            onPress={toggleTts}
          >
            {ttsEnabled ? (
              <Volume2 size={16} color={color['muted-foreground']} />
            ) : (
              <VolumeX size={16} color={color['muted-foreground']} />
            )}
          </HeaderIconButton>

          {isAuthenticated && childId && !childView ? (
            <HeaderIconButton
              label="Start Over"
              onPress={() => setConfirmingStartOver(true)}
            >
              <RotateCcw size={16} color={color['muted-foreground']} />
            </HeaderIconButton>
          ) : null}

          {isAuthenticated ? (
            <Pressable
              onPress={() => setProfileOpen(p => !p)}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
              accessibilityState={{ expanded: profileOpen }}
              className="h-11 flex-row items-center rounded-full px-1.5"
              style={({ pressed }) => [PILL, pressed && PILL_PRESSED]}
            >
              {/* Dot only: the web shows the name and view from sm up, and a phone
                  header has no room for them. */}
              <AvatarDot
                initial={profileInitial}
                size={32}
                fontSize={13}
                child={childView}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Profile panel — web: absolute w-72 dropdown under the avatar. */}
      <Modal
        visible={profileOpen}
        transparent
        animationType="none"
        onRequestClose={() => setProfileOpen(false)}
        onDismiss={showPendingDelete}
      >
        <Pressable
          className="flex-1"
          accessibilityLabel="Close profile"
          onPress={() => setProfileOpen(false)}
        >
          <Animated.View
            {...MODAL_BACKDROP}
            className="absolute right-4 w-72 overflow-hidden p-2"
            style={[PANEL, { top: insets.top + HEADER_HEIGHT + 8 }]}
          >
            <Pressable
              accessibilityViewIsModal
              accessibilityLabel="User profile"
            >
              <Animated.View {...MODAL_SCALE}>
                <Text className="px-2.5 pb-2 pt-1.5" style={HEADING}>
                  Signed-in profile
                </Text>

                {childView ? (
                  <>
                    {/* Child view: only the child, and the way back to parent view. */}
                    <View
                      className="flex-row items-center gap-2.5 rounded-[10px] px-2.5 py-2"
                      style={ROW_SELECTED}
                    >
                      <AvatarDot
                        initial={profileInitial}
                        size={28}
                        fontSize={12}
                        child
                      />
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} style={NAME}>
                          {profileName}
                        </Text>
                        <Text numberOfLines={1} style={DESC}>
                          Child view
                        </Text>
                      </View>
                    </View>
                    <View style={DIVIDER} />
                    <PanelRow
                      icon={ArrowLeft}
                      label="Back to parent view"
                      onPress={() => {
                        setProfileOpen(false);
                        const id = view.mode === 'child' ? view.childId : '';
                        exitChildView();
                        navigate(`/PersonalityJourney/${id}`);
                      }}
                    />
                  </>
                ) : (
                  <>
                    {/* The signed-in parent: the profile this view belongs to. */}
                    <View
                      className="flex-row items-center gap-2.5 rounded-[10px] px-2.5 py-2"
                      style={ROW_SELECTED}
                    >
                      <AvatarDot
                        initial={profileInitial}
                        size={28}
                        fontSize={12}
                      />
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} style={NAME}>
                          {profileName}
                        </Text>
                        <Text numberOfLines={1} style={DESC}>
                          {isParent ? 'Parent · sees everything' : 'Admin'}
                        </Text>
                      </View>
                    </View>

                    {isParent ? (
                      <ProfileChildren
                        list={kids.list}
                        isLoading={kids.isLoading}
                        isLoadingError={kids.isLoadingError}
                        isFetching={kids.isFetching}
                        onRetry={() => void kids.refetch()}
                        currentChildId={childId}
                        onClose={() => setProfileOpen(false)}
                        onDelete={requestDelete}
                        onChildView={(child: Child) => {
                          enterChildView(child.id);
                          // The child's circles alone: nothing of the parent's under them.
                          resetTo(childViewHome(child.id));
                        }}
                      />
                    ) : null}

                    <View style={DIVIDER} />

                    <PanelRow
                      icon={House}
                      label="Home"
                      active={currentPageName === 'Home'}
                      onPress={() => {
                        setProfileOpen(false);
                        navigate('/Home');
                      }}
                    />
                    <PanelRow
                      icon={Settings}
                      label="Account settings"
                      active={currentPageName === 'AccountSettings'}
                      onPress={() => {
                        setProfileOpen(false);
                        navigate('/AccountSettings');
                      }}
                    />
                    <PanelRow
                      icon={LogOut}
                      label="Sign out"
                      onPress={() => {
                        setProfileOpen(false);
                        void logout(true);
                      }}
                    />
                  </>
                )}
              </Animated.View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>

      <ConfirmModal
        open={confirmingStartOver}
        onCancel={() => setConfirmingStartOver(false)}
        onConfirm={() => {
          setConfirmingStartOver(false);
          void doStartOver();
        }}
        isStartingOver={isStartingOver}
        {...startOverCopy(currentChild?.name)}
      />

      <ConfirmModal
        open={childToDelete !== null}
        onCancel={() => setChildToDelete(null)}
        onConfirm={() => {
          if (childToDelete) void confirmDelete(childToDelete);
        }}
        isStartingOver={deletingId !== null}
        title={
          childToDelete ? `Delete ${childToDelete.name}?` : 'Delete child?'
        }
        description="Their profile, chat, results and plan are deleted for good."
      />
    </View>
  );
}

function HeaderIconButton({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      className="h-9 w-9 items-center justify-center rounded-md active:bg-accent"
    >
      {children}
    </Pressable>
  );
}

/** The avatar dot with an initial: the parent's gold, or a child's cyan (web `.avatar-dot-*`). */
function AvatarDot({
  initial,
  size,
  fontSize,
  child = false,
}: {
  initial: string;
  size: number;
  fontSize: number;
  /** The child's cyan dot instead of the parent's gold one. */
  child?: boolean;
}) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        experimental_backgroundImage: child ? CHILD_DOT : PARENT_DOT,
      }}
    >
      <Text style={[DOT_TEXT, { fontSize }]}>{initial}</Text>
    </View>
  );
}

/** Home, Account settings, Sign out (web `.profile-link`). */
function PanelRow({
  icon: Icon,
  label,
  active = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const tint = active ? LINK_ACTIVE : LINK_COLOR;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="w-full flex-row items-center gap-2.5 rounded-[10px] px-2.5 py-2"
      style={({ pressed }) => (pressed ? ROW_PRESSED : undefined)}
    >
      <Icon size={16} color={tint} />
      <Text style={[LINK, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}
