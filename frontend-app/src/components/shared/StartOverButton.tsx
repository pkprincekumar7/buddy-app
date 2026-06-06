import React, { useCallback, useState } from 'react';
import { View, Text, Modal, Pressable, ActivityIndicator } from 'react-native';
import { RotateCcw, AlertTriangle } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useStartOver } from '@/hooks/useStartOver';
import { useTheme } from '@/lib/ThemeContext';
import { useModalScale } from '@/lib/animations';
import Animated from 'react-native-reanimated';

interface ConfirmModalProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isStartingOver: boolean;
}

function ConfirmModal({
  visible,
  onCancel,
  onConfirm,
  isStartingOver,
}: ConfirmModalProps) {
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
        className="flex-1 items-center justify-center bg-black/70 p-4"
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
            {/* Icon */}
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

            {/* Text */}
            <View className="mb-7 items-center gap-2">
              <Text
                className="text-lg font-bold"
                style={{ color: colors.text }}
              >
                Start Over?
              </Text>
              <Text
                className="text-center text-sm leading-relaxed"
                style={{ color: colors.textMuted }}
              >
                This will permanently delete all progress for this child,
                including personality results, growth area answers, and goal
                plans.
              </Text>
              <Text
                className="text-xs font-medium"
                style={{ color: colors.error }}
              >
                This cannot be undone.
              </Text>
            </View>

            {/* Actions */}
            <View className="flex-row gap-3">
              <Button
                variant="outline"
                onPress={onCancel}
                disabled={isStartingOver}
                className="h-11 flex-1 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onPress={onConfirm}
                disabled={isStartingOver}
                className="h-11 flex-1 rounded-xl"
                style={{ backgroundColor: colors.error }}
              >
                {isStartingOver ? (
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
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

interface StartOverButtonProps {
  childId?: string;
  className?: string;
}

export default function StartOverButton({
  childId,
  className = '',
}: StartOverButtonProps) {
  const { colors } = useTheme();
  const { doStartOver, isStartingOver } = useStartOver(childId);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    void doStartOver();
  }, [doStartOver]);

  const handleCancel = useCallback(() => setConfirming(false), []);

  return (
    <>
      <Button
        size="xl"
        variant="outline"
        onPress={() => childId && setConfirming(true)}
        disabled={isStartingOver || !childId}
        className={`rounded-2xl ${className}`}
      >
        <View className="flex-row items-center gap-1">
          <RotateCcw size={14} color={colors.textMuted} />
          <Text
            className="text-base font-medium"
            style={{ color: colors.text }}
          >
            {isStartingOver ? 'Resetting…' : 'Start Over'}
          </Text>
        </View>
      </Button>

      <ConfirmModal
        visible={confirming}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        isStartingOver={isStartingOver}
      />
    </>
  );
}
