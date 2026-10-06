import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Login/Register page shell (no Layout): web
 * `flex min-h-screen flex-col items-center justify-center bg-background p-6`
 * wrapping the `border-edge w-full max-w-md rounded-2xl bg-card p-8` card.
 * Scrolls and avoids the keyboard; pads for the safe area.
 */
export default function AuthScreen({
  children,
  overlay,
}: {
  children: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="grow items-center justify-center p-6"
          contentContainerStyle={{
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="w-full max-w-md rounded-2xl border border-edge bg-card p-8">
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {overlay}
    </View>
  );
}
