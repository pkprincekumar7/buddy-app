import React, { useCallback, useState } from 'react';
import { View, Text, Modal, Pressable, ActivityIndicator } from 'react-native';
import { RotateCcw, AlertTriangle } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { useStartOver } from '@/hooks/useStartOver';
import { useModalScale } from '@/lib/animations';
import Animated from 'react-native-reanimated';

interface ConfirmModalProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isStartingOver: boolean;
}

function ConfirmModal({ visible, onCancel, onConfirm, isStartingOver }: ConfirmModalProps) {
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
          style={animatedStyle}
          className="w-full max-w-sm rounded-2xl border border-border bg-card p-8"
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            {/* Icon */}
            <View className="mb-5 items-center">
              <View className="h-14 w-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
                <AlertTriangle size={28} color="#f87171" />
              </View>
            </View>

            {/* Text */}
            <View className="mb-7 items-center gap-2">
              <Text className="text-lg font-bold text-white">Start Over?</Text>
              <Text className="text-center text-sm leading-relaxed text-slate-400">
                This will permanently delete all progress for this child, including personality
                results, growth area answers, and goal plans.
              </Text>
              <Text className="text-xs font-medium text-red-400">This cannot be undone.</Text>
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
                className="h-11 flex-1 rounded-xl bg-red-600"
              >
                {isStartingOver ? (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="white" />
                    <Text className="text-sm font-medium text-white">Deleting…</Text>
                  </View>
                ) : (
                  <Text className="text-sm font-medium text-white">Yes, delete</Text>
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

export default function StartOverButton({ childId, className = '' }: StartOverButtonProps) {
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
        variant="outline"
        onPress={() => childId && setConfirming(true)}
        disabled={isStartingOver || !childId}
        className={`h-12 rounded-2xl px-6 ${className}`}
      >
        <View className="flex-row items-center gap-1">
          <RotateCcw size={14} color="#e2e8f0" />
          <Text className="text-sm font-medium text-foreground">
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
