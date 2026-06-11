import React, { useState } from 'react';
import { View, Text, Modal, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut, Mail, Home } from 'lucide-react-native';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { getInitials } from '@/lib/avatarUtils';
import { navigateTo } from '@/lib/navigationRef';

/**
 * Header avatar button → dropdown card (top-right, just below the header).
 *
 * Structure mirrors the web Layout.tsx profile panel exactly:
 *   ┌─────────────────────────────┐
 *   │  [PK]  Name                 │  ← teal-tinted header strip
 *   │        email@example.com    │
 *   ├─────────────────────────────┤
 *   │  🏠  Home                   │  ← text-slate-300
 *   │  ↪  Sign out                │  ← text-slate-400, red on press
 *   └─────────────────────────────┘
 */
export default function ProfileHeaderButton() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const initials = getInitials(user?.full_name ?? user?.email ?? '?');

  // Position the card just below the navigation header.
  // React Navigation header content is 56 dp tall on Android, 44 dp on iOS.
  // insets.top already includes the status-bar / notch height.
  const HEADER_CONTENT_HEIGHT = Platform.OS === 'ios' ? 44 : 56;
  const dropdownTop = insets.top + HEADER_CONTENT_HEIGHT + 4;

  const close = () => setVisible(false);

  return (
    <>
      {/* ── Avatar trigger ── */}
      <Pressable
        onPress={() => setVisible(true)}
        style={{
          marginRight: 12,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: colors.primary,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.4,
          shadowRadius: 6,
          elevation: 4,
        }}
        accessibilityLabel="Open profile"
        accessibilityRole="button"
      >
        <Text
          style={{
            color: colors.primaryForeground,
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 0.5,
          }}
        >
          {initials}
        </Text>
      </Pressable>

      {/* ── Dropdown modal ── */}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
      >
        {/* Full-screen backdrop — tap outside to close */}
        <Pressable
          style={{ flex: 1, backgroundColor: colors.overlayBackground }}
          onPress={close}
        />

        {/* ── Dropdown card ── absolute, anchored top-right below header */}
        <View
          style={{
            position: 'absolute',
            top: dropdownTop,
            right: 10,
            width: 288, // matches web w-72
            borderRadius: 16, // matches web rounded-2xl
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
            backgroundColor: colors.card,
            shadowColor: colors.shadowColor,
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.55,
            shadowRadius: 24,
            elevation: 28,
          }}
        >
          {/* ── User info strip ── */}
          {/* Web: bg-gradient-to-r from-teal-600/30 to-emerald-600/20, px-5 py-4 */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 20, // px-5
              paddingVertical: 20, // slightly more room in header strip
              gap: 12, // gap-3
              backgroundColor: colors.primary + '2E',
            }}
          >
            {/* Avatar — web: h-12 w-12 = 48px, gradient teal→emerald, shadow-lg */}
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.35,
                shadowRadius: 6,
                elevation: 5,
              }}
            >
              <Text
                style={{
                  color: colors.primaryForeground,
                  fontSize: 18,
                  fontWeight: '700',
                }}
              >
                {initials}
              </Text>
            </View>

            {/* Name + email */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}
                numberOfLines={1}
              >
                {user?.full_name ?? 'User'}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 3,
                }}
              >
                {/* web: Mail h-3 w-3 shrink-0 */}
                <Mail
                  size={12}
                  color={colors.textMuted}
                  style={{ flexShrink: 0 }}
                />
                <Text
                  style={{ color: colors.textMuted, fontSize: 12 }}
                  numberOfLines={1}
                >
                  {user?.email ?? ''}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: colors.border }} />

          {/* ── Navigation + actions ── */}
          <View style={{ paddingHorizontal: 8, paddingVertical: 8 }}>
            {/* Home — explicit height wrapper guarantees row height */}
            <View style={{ height: 60, justifyContent: 'center' }}>
              <Pressable
                onPress={() => {
                  close();
                  navigateTo('Main', { screen: 'Home' });
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  backgroundColor: pressed
                    ? colors.pressedBackground
                    : 'transparent',
                  justifyContent: 'center',
                })}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <Home size={20} color={colors.textMuted} />
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 15,
                      fontWeight: '500',
                    }}
                  >
                    Home
                  </Text>
                </View>
              </Pressable>
            </View>

            <View
              style={{
                height: 1,
                marginHorizontal: 16,
                backgroundColor: colors.border,
              }}
            />

            {/* Sign out — explicit height wrapper guarantees row height */}
            <View style={{ height: 60, justifyContent: 'center' }}>
              <Pressable
                onPress={() => {
                  close();
                  void logout();
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  backgroundColor: pressed
                    ? colors.error + '1A'
                    : 'transparent',
                  justifyContent: 'center',
                })}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <LogOut size={20} color={colors.textMuted} />
                  <Text
                    style={{
                      color: colors.textMuted,
                      fontSize: 15,
                      fontWeight: '500',
                    }}
                  >
                    Sign out
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
