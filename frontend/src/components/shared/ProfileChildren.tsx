import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, X } from 'lucide-react';
import { MAX_CHILDREN, children as childrenApi, type Child } from '@/api/children';
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

/** The child's photo, or the cyan dot with their initial (7 by default; `className` sizes it). */
export function ChildAvatar({
  child,
  className = 'h-7 w-7 text-xs',
}: {
  child: Pick<Child, 'name' | 'avatar_url'>;
  className?: string;
}) {
  if (child.avatar_url) {
    return (
      <img
        src={child.avatar_url}
        alt=""
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span aria-hidden="true" className={cn('avatar-dot avatar-dot-child', className)}>
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
  const queryClient = useQueryClient();
  const atLimit = list.length >= MAX_CHILDREN;

  // The list is cached (30s) and the menu stays mounted across pages, so a chat finished
  // since wouldn't show: opening the menu fetches it again.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['children'] });
  }, [queryClient]);

  // A child's row: child view once their chat is done, else their onboarding. A child
  // the list still shows in setup is asked for afresh first: the chat's last answer sets
  // the flag a moment later (an event), after the list was fetched. The menu closes once
  // that's known (closing unmounts this list), and a second click meanwhile is ignored.
  const opening = useRef(false);
  const open = async (child: Child) => {
    if (opening.current) return;
    opening.current = true;
    let latest = child;
    if (!child.progress.conversation) {
      try {
        latest = await childrenApi.get(child.id);
        queryClient.setQueryData<Child[]>(['children'], (old) =>
          old?.map((c) => (c.id === latest.id ? latest : c)),
        );
      } catch {
        // Offline or gone: open what the list says; that page handles it.
      }
    }
    onClose();
    opening.current = false;
    if (onChildView && latest.progress.conversation) onChildView(latest);
    else void navigate(childPath(latest));
  };

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
                    onClick={() => void open(child)}
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
