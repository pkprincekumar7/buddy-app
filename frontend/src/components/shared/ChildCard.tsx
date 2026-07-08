import { useNavigate } from 'react-router-dom';
import { Eye, Trash2, CheckCircle, Clock } from 'lucide-react';
import type { ChildRecord } from '@/types/api';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useStartOver } from '@/hooks/useStartOver';

interface ChildCardProps {
  child: ChildRecord;
}

export default function ChildCard({ child }: ChildCardProps) {
  const navigate = useNavigate();
  const { doStartOver, isStartingOver } = useStartOver(child.id);

  const displayName = child.name ?? 'Unnamed child';
  // Treat as completed if either flag is set OR recommendations exist —
  // old records may have onboarding_completed: null even though the flow finished.
  const completed = !!child.onboarding_completed || !!child.recommendations;

  return (
    <>
      <div className="border-edge-faint hover:border-edge flex items-center justify-between rounded-2xl bg-card p-4 transition-all duration-200">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
            {displayName.charAt(0).toUpperCase()}
          </div>

          {/* Info */}
          <div>
            <p className="text-sm font-semibold text-foreground">{displayName}</p>
            <p className="text-xs text-muted-foreground">
              {[child.age && `Age ${child.age}`, child.school].filter(Boolean).join(' · ') ||
                'No details yet'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status badge */}
          <span
            className={`hidden items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium sm:flex ${
              completed ? 'bg-success/10 text-success' : 'bg-warning-medium/10 text-warning-medium'
            }`}
          >
            {completed ? (
              <>
                <CheckCircle className="h-3 w-3" /> Completed
              </>
            ) : (
              <>
                <Clock className="h-3 w-3" /> In Progress
              </>
            )}
          </span>

          {/* View */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              navigate(
                completed
                  ? `/PersonalityType/${child.id}`
                  : `/ConversationalOnboarding/${child.id}`,
              )
            }
            aria-label="View journey"
            title="View journey"
          >
            <Eye className="h-4 w-4" />
          </Button>

          {/* Delete (Start Over) */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete child"
                title="Delete child"
                disabled={isStartingOver}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {displayName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  All progress — personality results, growth area answers, and goal plans — will be
                  permanently deleted. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void doStartOver()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isStartingOver ? 'Deleting…' : 'Yes, delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </>
  );
}
