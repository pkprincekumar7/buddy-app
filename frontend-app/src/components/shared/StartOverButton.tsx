import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { RotateCcw, TriangleAlert } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useStartOver } from '@/hooks/useStartOver';
import { cn } from '@/lib/utils';
import { color, recipe } from '@/theme';
import Spinner from './Spinner';

interface ConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isStartingOver: boolean;
}

/** "Start Over?" confirmation — same copy, icon and colors as the web ConfirmModal. */
export function ConfirmModal({
  open,
  onCancel,
  onConfirm,
  isStartingOver,
}: ConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onCancel()}>
      <DialogContent
        hideClose
        accessibilityLabel="Confirm start over"
        className="max-w-sm rounded-2xl border border-edge-strong bg-surface-elevated p-8"
      >
        <View className="mb-5 items-center">
          <View className="h-14 w-14 items-center justify-center rounded-full border border-error-medium/30 bg-error-medium/10">
            <TriangleAlert size={28} color={color.error} />
          </View>
        </View>

        <View className="mb-7 gap-2">
          <Text
            accessibilityRole="header"
            className="text-center text-lg font-bold text-foreground"
          >
            Start Over?
          </Text>
          <Text className="text-center text-sm leading-relaxed text-muted-foreground">
            All progress for this child will be permanently deleted —
            personality results, growth area answers, and goal plans. You will
            need to restart the onboarding from the beginning.
          </Text>
          <Text className="text-center text-xs font-medium text-error">
            This cannot be undone.
          </Text>
        </View>

        <View className="flex-row gap-3">
          <Button
            onPress={onConfirm}
            disabled={isStartingOver}
            className="h-11 flex-1 rounded-xl bg-error-strong text-base text-white"
          >
            {isStartingOver ? (
              <View className="flex-row items-center gap-2">
                <Spinner
                  className="h-4 w-4 border-white/30 border-t-white"
                  durationSeconds={1}
                />
                <Text className="text-base font-medium text-white">
                  Deleting…
                </Text>
              </View>
            ) : (
              'Yes, delete'
            )}
          </Button>
          <Button
            variant="outline"
            onPress={onCancel}
            disabled={isStartingOver}
            className="h-11 flex-1 rounded-xl text-base text-muted-foreground"
            style={recipe.btnSecondary}
          >
            Cancel
          </Button>
        </View>
      </DialogContent>
    </Dialog>
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
  const { doStartOver, isStartingOver } = useStartOver(childId);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    void doStartOver();
  }, [doStartOver]);

  return (
    <>
      <Button
        size="xl"
        variant="outline"
        onPress={() => childId && setConfirming(true)}
        disabled={isStartingOver || !childId}
        className={cn('rounded-2xl text-warning', className)}
        style={recipe.btnStartOver}
      >
        <RotateCcw size={16} color={color.warning} />
        <Text className="text-sm font-medium text-warning">
          {isStartingOver ? 'Resetting…' : 'Start Over'}
        </Text>
      </Button>
      <ConfirmModal
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={handleConfirm}
        isStartingOver={isStartingOver}
      />
    </>
  );
}
