import { useNavigate } from 'react-router';
import { Pencil, Plus, X } from 'lucide-react';
import { MAX_CHILDREN, type Child } from '@/api/children';
import { childPath, childSubtitle } from '@/lib/childPaths';
import { getInitials } from '@/lib/avatarUtils';
import { cn } from '@/lib/utils';

interface ProfileChildrenProps {
  /** The parent's children, newest first (`useChildren`). */
  list: Child[];
  isLoading: boolean;
  isLoadingError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  /** The child whose page is open: their name is shown in cyan. */
  currentChildId: string | null;
  /** Closes the menu: called before any navigation or dialog. */
  onClose: () => void;
  /** Asks to delete a child; the caller confirms first. */
  onDelete: (child: Child) => void;
  /** Hands this device to the child (child view): the row's click, once the chat is done. */
  onChildView?: (child: Child) => void;
}

/** The child's photo, or the cyan dot with their initial. */
function ChildAvatar({ child }: { child: Child }) {
  if (child.avatar_url) {
    return (
      <img src={child.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span aria-hidden="true" className="avatar-dot avatar-dot-child h-7 w-7 text-xs">
      {getInitials(child.name).charAt(0)}
    </span>
  );
}

/**
 * The profile menu's children, under the signed-in parent: each child (switches this
 * device to their child view, as the prototype's profile list does; a child still in
 * setup opens their onboarding instead), the pencil edits their profile and × deletes
 * them; then "+ Add Child". Parents only; the Layout doesn't render it for admins.
 */
export default function ProfileChildren({
  list,
  isLoading,
  isLoadingError,
  isFetching,
  onRetry,
  currentChildId,
  onClose,
  onDelete,
  onChildView,
}: ProfileChildrenProps) {
  const navigate = useNavigate();
  const atLimit = list.length >= MAX_CHILDREN;

  return (
    <>
      {isLoading ? (
        <p className="profile-desc px-2.5 py-2">Loading your children…</p>
      ) : isLoadingError ? (
        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <p className="profile-desc">Couldn&apos;t load your children.</p>
          <button
            type="button"
            onClick={onRetry}
            disabled={isFetching}
            className="profile-link profile-link-active w-auto shrink-0 px-2 py-1 disabled:opacity-50"
          >
            {isFetching ? 'Trying…' : 'Try again'}
          </button>
        </div>
      ) : (
        list.length > 0 && (
          <ul className="max-h-64 overflow-y-auto">
            {list.map((child) => {
              const current = child.id === currentChildId;
              return (
                <li key={child.id} className="profile-row-group">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (onChildView && child.progress.conversation) onChildView(child);
                      else void navigate(childPath(child));
                    }}
                    aria-current={current ? 'page' : undefined}
                    title={
                      onChildView && child.progress.conversation
                        ? `Switch to ${child.name}'s child view`
                        : undefined
                    }
                    className="profile-row-main"
                  >
                    <ChildAvatar child={child} />
                    <span className="min-w-0">
                      <span className={cn('profile-name block', current && 'profile-name-current')}>
                        {child.name}
                      </span>
                      <span className="profile-desc block">{childSubtitle(child)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      void navigate(`/Onboarding/${child.id}`);
                    }}
                    aria-label={`Edit ${child.name}'s profile`}
                    title={`Edit ${child.name}'s profile`}
                    className="profile-row-action"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onDelete(child);
                    }}
                    aria-label={`Delete ${child.name}`}
                    title={`Delete ${child.name}`}
                    className="profile-row-action hover:bg-error-medium/10 hover:text-error"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}

      <button
        type="button"
        onClick={() => {
          onClose();
          void navigate('/Onboarding', { state: { forceNew: true } });
        }}
        disabled={atLimit}
        className="profile-link profile-link-active disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <Plus className="h-4 w-4" />
        Add Child
      </button>
      {atLimit && <p className="profile-desc px-2.5 pb-1">Maximum of {MAX_CHILDREN} children</p>}
    </>
  );
}
