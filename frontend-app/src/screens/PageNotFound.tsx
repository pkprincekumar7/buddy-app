import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Svg, { Path } from 'react-native-svg';
import { useLocation, useNavigate } from '@/lib/router';
import { useAuth } from '@/lib/AuthContext';
import { color } from '@/theme';

export default function PageNotFound() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const pageName = location.pathname.substring(1);

  return (
    <View className="flex-1 items-center justify-center bg-background p-6">
      <View className="w-full max-w-md gap-6">
        <View className="items-center gap-2">
          <Text
            accessibilityRole="header"
            className="text-7xl font-light text-muted-foreground"
          >
            404
          </Text>
          <View className="h-0.5 w-16 border border-edge" />
        </View>

        <View className="gap-3">
          <Text className="text-center text-2xl font-medium text-foreground">
            Page Not Found
          </Text>
          <Text className="text-center leading-relaxed text-muted-foreground">
            The page{' '}
            <Text className="font-medium text-foreground">"{pageName}"</Text>{' '}
            could not be found in this application.
          </Text>
        </View>

        {isAuthenticated && user?.role === 'admin' ? (
          <View className="mt-8 rounded-lg border border-edge bg-surface-elevated p-4">
            <View className="flex-row items-start gap-3">
              <View className="mt-0.5 h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning-orange/10">
                <View className="h-2 w-2 rounded-full bg-warning-orange" />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-sm font-medium text-foreground">
                  Admin Note
                </Text>
                <Text className="text-sm leading-relaxed text-muted-foreground">
                  This could mean that the AI hasn't implemented this page yet.
                  Ask it to implement it in the chat.
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        <View className="items-center pt-6">
          <Pressable
            onPress={() => navigate('/', { replace: true })}
            accessibilityRole="button"
            className="flex-row items-center rounded-lg border border-edge bg-surface-elevated px-4 py-2 active:bg-subtle-tint"
          >
            <Svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke={color.foreground}
              style={{ marginRight: 8 }}
            >
              <Path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </Svg>
            <Text className="text-sm font-medium text-foreground">Go Home</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
