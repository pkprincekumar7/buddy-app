import React, { useEffect, useState } from 'react';
import { AppState, Modal, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import {
  House,
  LogOut,
  Mail,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { useAuth } from '@/lib/AuthContext';
import { useTts } from '@/lib/TtsContext';
import { stopSpeech } from '@/lib/tts';
import { getInitials } from '@/lib/avatarUtils';
import { navigate, type PageName } from '@/lib/router';
import { useStartOver } from '@/hooks/useStartOver';
import { ConfirmModal } from '@/components/shared/StartOverButton';
import { MODAL_BACKDROP, MODAL_SCALE } from '@/lib/animations';
import { cn } from '@/lib/utils';
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
  const initials = getInitials(user?.full_name ?? user?.email ?? '?');

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

          {isAuthenticated && childId ? (
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
              className="h-9 w-9 items-center justify-center rounded-full"
              style={({ pressed }) => [
                { experimental_backgroundImage: avatarGradient },
                pressed && { transform: [{ scale: 1.05 }] },
              ]}
            >
              <Text className="text-xs font-bold text-white">{initials}</Text>
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
      >
        <Pressable
          className="flex-1"
          accessibilityLabel="Close profile"
          onPress={() => setProfileOpen(false)}
        >
          <Animated.View
            {...MODAL_BACKDROP}
            className="absolute right-4 w-72 overflow-hidden rounded-2xl border border-border bg-surface-elevated"
            style={{
              top: insets.top + HEADER_HEIGHT + 8,
              boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
            }}
          >
            <Pressable
              accessibilityViewIsModal
              accessibilityLabel="User profile"
            >
              <Animated.View {...MODAL_SCALE}>
                {/* Header gradient strip */}
                <View
                  className="px-5 py-4"
                  style={{ experimental_backgroundImage: profileStripGradient }}
                >
                  <View className="flex-row items-center gap-3">
                    <View
                      className="h-12 w-12 shrink-0 items-center justify-center rounded-full"
                      style={{
                        experimental_backgroundImage: avatarGradient,
                        boxShadow: '0 10px 15px rgba(0,0,0,0.25)',
                      }}
                    >
                      <Text className="text-lg font-bold text-white">
                        {initials}
                      </Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text
                        className="font-semibold text-card-foreground"
                        numberOfLines={1}
                      >
                        {user?.full_name ?? 'User'}
                      </Text>
                      <View className="flex-row items-center gap-1">
                        <Mail size={12} color={color['muted-foreground']} />
                        <Text
                          className="flex-1 text-xs text-muted-foreground"
                          numberOfLines={1}
                        >
                          {user?.email ?? ''}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View className="border-t border-border" />

                <View className="p-2">
                  <PanelRow
                    icon={
                      <House
                        size={16}
                        color={
                          currentPageName === 'Home'
                            ? color.primary
                            : color['muted-foreground']
                        }
                      />
                    }
                    label="Home"
                    textClassName={
                      currentPageName === 'Home'
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    }
                    onPress={() => {
                      setProfileOpen(false);
                      navigate('/Home');
                    }}
                  />
                  <PanelRow
                    icon={
                      <LogOut size={16} color={color['muted-foreground']} />
                    }
                    label="Sign out"
                    textClassName="text-muted-foreground"
                    onPress={() => {
                      setProfileOpen(false);
                      void logout(true);
                    }}
                  />
                </View>
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
      />
    </View>
  );
}

const avatarGradient = css(
  'linear-gradient(to bottom right, hsl(var(--primary-medium)), hsl(var(--success)))',
);
const profileStripGradient = css(
  'linear-gradient(to right, hsl(var(--primary-dark) / 0.3), hsl(var(--success-strong) / 0.2))',
);

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

function PanelRow({
  icon,
  label,
  textClassName,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  textClassName: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="w-full flex-row items-center gap-2.5 rounded-xl px-3 py-2.5 active:bg-accent"
    >
      {icon}
      <Text className={cn('text-sm', textClassName)}>{label}</Text>
    </Pressable>
  );
}
