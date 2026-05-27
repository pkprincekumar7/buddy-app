import React, { useState } from 'react';
import { View, Text, Modal, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogOut, Mail, Home } from 'lucide-react-native';
import { useAuth } from '@/lib/AuthContext';
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
          // Approximate the web's teal-500 → emerald-500 gradient with a mid-point teal
          backgroundColor: '#0d9488',
          alignItems: 'center',
          justifyContent: 'center',
          // Subtle glow matching the web ring on hover
          shadowColor: '#14b8a6',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.4,
          shadowRadius: 6,
          elevation: 4,
        }}
        accessibilityLabel="Open profile"
        accessibilityRole="button"
      >
        <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>
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
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={close} />

        {/* ── Dropdown card ── absolute, anchored top-right below header */}
        <View
          style={{
            position: 'absolute',
            top: dropdownTop,
            right: 10,
            width: 288,          // matches web w-72
            borderRadius: 16,    // matches web rounded-2xl
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            overflow: 'hidden',
            // Background: web uses bg-surface-elevated ≈ slate-900 variant
            backgroundColor: '#0f1629',
            shadowColor: '#000',
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
              paddingHorizontal: 20,   // px-5
              paddingVertical: 20,     // slightly more room in header strip
              gap: 12,                 // gap-3
              backgroundColor: 'rgba(20,184,166,0.18)', // teal-600/30 approximation
            }}
          >
            {/* Avatar — web: h-12 w-12 = 48px, gradient teal→emerald, shadow-lg */}
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: '#0d9488',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                shadowColor: '#14b8a6',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.35,
                shadowRadius: 6,
                elevation: 5,
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>
                {initials}
              </Text>
            </View>

            {/* Name + email */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{ color: '#ffffff', fontWeight: '600', fontSize: 14 }}
                numberOfLines={1}
              >
                {user?.full_name ?? 'User'}
              </Text>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}
              >
                {/* web: Mail h-3 w-3 shrink-0 */}
                <Mail size={12} color="#94a3b8" style={{ flexShrink: 0 }} />
                <Text style={{ color: '#94a3b8', fontSize: 12 }} numberOfLines={1}>
                  {user?.email ?? ''}
                </Text>
              </View>
            </View>
          </View>

          {/* Divider — web: border-t border-white/10 */}
          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.10)' }} />

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
                  backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
                  justifyContent: 'center',
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Home size={20} color="#cbd5e1" />
                  <Text style={{ color: '#cbd5e1', fontSize: 15, fontWeight: '500' }}>Home</Text>
                </View>
              </Pressable>
            </View>

            {/* Thin separator between menu items */}
            <View style={{ height: 1, marginHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.08)' }} />

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
                  backgroundColor: pressed ? 'rgba(239,68,68,0.10)' : 'transparent',
                  justifyContent: 'center',
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <LogOut size={20} color="#94a3b8" />
                  <Text style={{ color: '#94a3b8', fontSize: 15, fontWeight: '500' }}>Sign out</Text>
                </View>
              </Pressable>
            </View>

          </View>
        </View>
      </Modal>
    </>
  );
}
