import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Shield } from 'lucide-react-native';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/ThemeContext';

export default function AdminScreen() {
  const { colors } = useTheme();
  const { user, logout } = useAuth();

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        padding: 24,
        justifyContent: 'center',
      }}
    >
      {/* Icon + title */}
      <View className="items-center mb-8">
        <View
          className="h-16 w-16 rounded-2xl items-center justify-center mb-5"
          style={{ backgroundColor: colors.primary + '1A' }}
        >
          <Shield size={32} color={colors.primary} />
        </View>
        <Text
          className="text-2xl font-bold tracking-tight text-center mb-2"
          style={{ color: colors.text }}
        >
          Admin Account
        </Text>
        <Text
          className="text-sm text-center leading-relaxed"
          style={{ color: colors.textMuted }}
        >
          This account has admin privileges.{'\n'}
          Use the web app to manage the allowed-emails list.
        </Text>
      </View>

      {/* Account card */}
      <View
        className="rounded-2xl border p-5 mb-8"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <Text
          className="text-xs font-medium mb-1"
          style={{ color: colors.textMuted }}
        >
          Signed in as
        </Text>
        <Text
          className="text-sm font-semibold"
          style={{ color: colors.text }}
          numberOfLines={1}
        >
          {user?.email ?? '—'}
        </Text>
      </View>

      {/* Logout */}
      <Button variant="destructive" size="lg" onPress={() => void logout()}>
        Sign out
      </Button>
    </ScrollView>
  );
}
