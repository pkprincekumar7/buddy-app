import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color } from '@/theme';

const TIPS = [
  'Verify you are logged in with the correct account',
  'Contact the app administrator for access',
  'Try logging out and back in again',
];

export default function UserNotRegisteredError() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-4">
      <View className="w-full max-w-md rounded-lg border border-edge bg-card p-8">
        <View className="items-center">
          <View className="mb-6 h-16 w-16 items-center justify-center rounded-full bg-warning-orange/10">
            <Svg
              width={32}
              height={32}
              viewBox="0 0 24 24"
              fill="none"
              stroke={color['warning-orange']}
            >
              <Path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </Svg>
          </View>
          <Text
            accessibilityRole="header"
            className="mb-4 text-center text-3xl font-bold text-foreground"
          >
            Access Restricted
          </Text>
          <Text className="mb-8 text-center text-base text-muted-foreground">
            You are not registered to use this application. Please contact the
            app administrator to request access.
          </Text>
          <View className="w-full rounded-md bg-surface-elevated p-4">
            <Text className="text-sm text-muted-foreground">
              If you believe this is an error, you can:
            </Text>
            <View className="mt-2 gap-1">
              {TIPS.map(t => (
                <Text key={t} className="text-sm text-muted-foreground">
                  {'•  '}
                  {t}
                </Text>
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
