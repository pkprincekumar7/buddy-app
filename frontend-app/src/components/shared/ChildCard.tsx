import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  Eye,
  Trash2,
  CheckCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '@/navigation';
import { navigateTo } from '@/lib/navigationRef';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/ThemeContext';
import { useModalScale } from '@/lib/animations';
import { useStartOver } from '@/hooks/useStartOver';
import { useAuth } from '@/lib/AuthContext';
import type { ChildRecord } from '@/types/api';

type HomeNavProp = StackNavigationProp<RootStackParamList>;

interface DeleteConfirmModalProps {
  visible: boolean;
  childName: string;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

function DeleteConfirmModal({
  visible,
  childName,
  onCancel,
  onConfirm,
  isDeleting,
}: DeleteConfirmModalProps) {
  const { colors } = useTheme();
  const animatedStyle = useModalScale(visible);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
    >
      <Pressable
        className="flex-1 items-center justify-center p-4"
        style={{ backgroundColor: colors.overlayBackground }}
        onPress={onCancel}
        accessible={false}
      >
        <Animated.View
          style={[
            animatedStyle,
            {
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            },
          ]}
          className="w-full max-w-sm rounded-2xl p-8"
        >
          <Pressable onPress={e => e.stopPropagation()}>
            <View className="mb-5 items-center">
              <View
                className="h-14 w-14 items-center justify-center rounded-full border"
                style={{
                  borderColor: colors.error + '4D',
                  backgroundColor: colors.error + '1A',
                }}
              >
                <AlertTriangle size={28} color={colors.error} />
              </View>
            </View>

            <View className="mb-7 items-center gap-2">
              <Text
                className="text-lg font-bold"
                style={{ color: colors.text }}
              >
                Delete {childName}?
              </Text>
              <Text
                className="text-center text-sm leading-relaxed"
                style={{ color: colors.textMuted }}
              >
                All progress — personality results, growth area answers, and
                goal plans — will be permanently deleted.
              </Text>
              <Text
                className="text-xs font-medium"
                style={{ color: colors.error }}
              >
                This cannot be undone.
              </Text>
            </View>

            <View className="flex-row gap-3">
              <Button
                onPress={onConfirm}
                disabled={isDeleting}
                className="h-11 flex-1 rounded-xl"
                style={{ backgroundColor: colors.error }}
              >
                {isDeleting ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator
                      size="small"
                      color={colors.primaryForeground}
                    />
                    <Text
                      className="text-sm font-medium"
                      style={{ color: colors.primaryForeground }}
                    >
                      Deleting…
                    </Text>
                  </View>
                ) : (
                  <Text
                    className="text-sm font-medium"
                    style={{ color: colors.primaryForeground }}
                  >
                    Yes, delete
                  </Text>
                )}
              </Button>
              <Button
                variant="outline"
                onPress={onCancel}
                disabled={isDeleting}
                className="h-11 flex-1 rounded-xl"
              >
                Cancel
              </Button>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

interface ChildCardProps {
  child: ChildRecord;
}

export default function ChildCard({ child }: ChildCardProps) {
  const navigation = useNavigation<HomeNavProp>();
  const { setActiveChildId } = useAuth();
  const { colors } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const { doStartOver, isStartingOver } = useStartOver(child.id);

  const displayName = child.name ?? 'Unnamed child';
  // Treat as completed if either flag is set OR recommendations exist —
  // old records may have onboarding_completed: null even though the flow finished.
  const completed = !!child.onboarding_completed || !!child.recommendations;

  const handleView = useCallback(() => {
    setActiveChildId(child.id);
    if (completed) {
      // Onboarding is done — go straight to the personality results tab.
      navigateTo('Main', {
        screen: 'Personality',
        params: { screen: 'PersonalityType', params: { childId: child.id } },
      });
    } else {
      navigation.navigate('Onboarding', { screen: 'ConversationalOnboarding' });
    }
  }, [child.id, completed, setActiveChildId, navigation]);

  const handleConfirmDelete = useCallback(() => {
    setConfirming(false);
    void doStartOver();
  }, [doStartOver]);

  return (
    <>
      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <View className="flex-row items-center justify-between">
          {/* Avatar + info */}
          <View className="flex-row items-center gap-3 flex-1 mr-2">
            <View
              className="h-10 w-10 shrink-0 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.primary + '1A' }}
            >
              <Text
                className="text-base font-semibold"
                style={{ color: colors.primary }}
              >
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>

            <View className="flex-1">
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.text }}
              >
                {displayName}
              </Text>
              <Text className="text-xs" style={{ color: colors.textMuted }}>
                {[child.age && `Age ${child.age}`, child.school]
                  .filter(Boolean)
                  .join(' · ') || 'No details yet'}
              </Text>
            </View>
          </View>

          {/* Status + actions */}
          <View className="flex-row items-center gap-1">
            <View
              className="flex-row items-center gap-1 rounded-full px-2 py-0.5 mr-1"
              style={{
                backgroundColor: completed
                  ? colors.success + '1A'
                  : colors.warning + '1A',
              }}
            >
              {completed ? (
                <CheckCircle size={10} color={colors.success} />
              ) : (
                <Clock size={10} color={colors.warning} />
              )}
              <Text
                className="text-[10px] font-medium"
                style={{ color: completed ? colors.success : colors.warning }}
              >
                {completed ? 'Completed' : 'In Progress'}
              </Text>
            </View>

            {/* View */}
            <Pressable
              onPress={handleView}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: colors.surfaceElevated }}
            >
              <Eye size={14} color={colors.iconColor} />
            </Pressable>

            {/* Delete */}
            <Pressable
              onPress={() => setConfirming(true)}
              disabled={isStartingOver}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: colors.error + '1A' }}
            >
              {isStartingOver ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Trash2 size={14} color={colors.error} />
              )}
            </Pressable>
          </View>
        </View>
      </View>

      <DeleteConfirmModal
        visible={confirming}
        childName={displayName}
        onCancel={() => setConfirming(false)}
        onConfirm={handleConfirmDelete}
        isDeleting={isStartingOver}
      />
    </>
  );
}
