import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { CheckCircle, Clock, Eye, Trash2 } from 'lucide-react-native';
import { useNavigate } from '@/lib/router';
import type { ChildRecord } from '@/types/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStartOver } from '@/hooks/useStartOver';
import { cn } from '@/lib/utils';
import { color } from '@/theme';

interface ChildCardProps {
  child: ChildRecord;
}

export default function ChildCard({ child }: ChildCardProps) {
  const navigate = useNavigate();
  const { doStartOver, isStartingOver } = useStartOver(child.id);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const displayName = child.name ?? 'Unnamed child';
  const completed = !!child.onboarding_completed;
  // Phone width: the web's below-name (`sm:hidden`) badge is the one shown.
  const statusBadgeClass = completed ? 'bg-success/10' : 'bg-warning-medium/10';
  const statusTextClass = completed ? 'text-success' : 'text-warning-medium';
  const statusIconColor = completed ? color.success : color['warning-medium'];

  const details =
    [child.age && `Age ${child.age}`, child.school]
      .filter(Boolean)
      .join(' · ') || 'No details yet';

  return (
    <>
      <View className="rounded-2xl border border-edge-faint bg-card p-4">
        <View className="flex-row items-center justify-between">
          <View className="min-w-0 flex-1 flex-row items-start gap-4">
            {/* Avatar */}
            <View className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Text className="text-base font-semibold text-primary">
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>

            {/* Info */}
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-foreground">
                {displayName}
              </Text>
              <Text className="text-xs text-muted-foreground">{details}</Text>
              {/* Status badge */}
              <View
                className={cn(
                  'mt-1 flex-row items-center gap-1 self-start rounded-full px-2.5 py-0.5',
                  statusBadgeClass,
                )}
              >
                {completed ? (
                  <CheckCircle size={12} color={statusIconColor} />
                ) : (
                  <Clock size={12} color={statusIconColor} />
                )}
                <Text className={cn('text-xs font-medium', statusTextClass)}>
                  {completed ? 'Completed' : 'In Progress'}
                </Text>
              </View>
            </View>
          </View>

          <View className="shrink-0 flex-row items-center gap-2">
            {/* View */}
            <Button
              variant="ghost"
              size="icon"
              onPress={() => {
                void navigate(`/Onboarding/${child.id}`);
              }}
              accessibilityLabel="View journey"
            >
              <Eye size={16} color={color.foreground} />
            </Button>

            {/* Delete (Start Over) */}
            <Button
              variant="ghost"
              size="icon"
              accessibilityLabel="Delete child"
              disabled={isStartingOver}
              onPress={() => setConfirmOpen(true)}
            >
              <Trash2 size={16} color={color.destructive} />
            </Button>
          </View>
        </View>
      </View>

      {/* Web AlertDialog: no close X, no dismiss on backdrop tap. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          hideClose
          dismissible={false}
          accessibilityLabel={`Delete ${displayName}?`}
        >
          <DialogHeader className="gap-2">
            <DialogTitle className="leading-normal tracking-normal">
              Delete {displayName}?
            </DialogTitle>
            <DialogDescription>
              All progress — personality results, growth area answers, and goal
              plans — will be permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="mt-2"
              onPress={() => setConfirmOpen(false)}
              accessibilityLabel="Cancel"
            >
              Cancel
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground"
              onPress={() => {
                setConfirmOpen(false);
                void doStartOver();
              }}
              accessibilityLabel="Yes, delete"
            >
              {isStartingOver ? 'Deleting…' : 'Yes, delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
