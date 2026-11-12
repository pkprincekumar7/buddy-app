import { Link, useLocation, useNavigate } from 'react-router';
import { createPageUrl } from '@/utils';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useTts } from '@/lib/TtsContext';
import { account, displayName } from '@/api/account';
import { unlockIOSSpeechSynthesis } from '@/lib/tts';
import { getInitials } from '@/lib/avatarUtils';
import { ArrowLeft, Home, LogOut, VolumeX, Volume2, RotateCcw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AnimatePresence } from 'framer-motion';
import { ConfirmModal } from '@/components/shared/StartOverButton';
import { startOverCopy } from '@/lib/startOverCopy';
import ProfileChildren from '@/components/shared/ProfileChildren';
import type { Child } from '@/api/children';
import { useChildren } from '@/hooks/useChildren';
import { useDeleteChild } from '@/hooks/useDeleteChild';
import { useStartOver } from '@/hooks/useStartOver';
import { useViewMode } from '@/lib/ViewModeContext';
import { childViewHome } from '@/lib/childView';

interface LayoutProps {
  children: ReactNode;
  currentPageName?: string;
}

// Maps a page's currentPageName to the seven-circle node label that leads to
// it, so the header shows the same text as the circle the user tapped.
const CIRCLE_LABELS: Record<string, string> = {
  Connect: 'Connect',
  PersonalityProfile: 'Discover',
  LifePathway: 'Transform',
  GrowthAreas: 'Grow',
  Observations: 'Release',
};

// Extract childId from paths like /PageName/:childId or /PageName/:childId/...
function useNavChildId() {
  const { pathname } = useLocation();
  const match = /^\/[^/]+\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

export default function Layout({ children, currentPageName }: LayoutProps) {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const { ttsEnabled, toggleTts } = useTts();
  const navChildId = useNavChildId();
  const { doStartOver, isStartingOver } = useStartOver(navChildId ?? undefined);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  // The Children group is for parents; admins have no children.
  const isParent = isAuthenticated && user?.role === 'parent';
  const kids = useChildren(isParent);
  const currentChild = kids.list.find((c) => c.id === navChildId);
  const { deleteChild, deletingId } = useDeleteChild();
  const [childToDelete, setChildToDelete] = useState<Child | null>(null);
  // Child view (docs/child-view-build-plan.md, 1.2): the button and menu show the child.
  const { view, enterChildView, exitChildView } = useViewMode();
  const childView = view.mode === 'child';
  const viewChild = childView ? kids.list.find((c) => c.id === view.childId) : undefined;
  const parentName = displayName(user) ?? 'You';
  const profileName = childView ? (viewChild?.name ?? 'Child') : parentName;
  const profileInitial = getInitials(profileName).charAt(0);
  const viewLabel = childView ? 'Child view' : isParent ? 'Parent view' : 'Admin';

  // Global TTS control and cleanup on load
  useEffect(() => {
    if (typeof window !== 'undefined') window.speechSynthesis.cancel();
  }, []);

  // iOS Safari blocks speechSynthesis unless it's first triggered from a user gesture.
  // Speak a silent utterance on the very first tap/click to unlock it for async use.
  useEffect(() => {
    const unlock = () => unlockIOSSpeechSynthesis();
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
  }, []);

  // Stop TTS when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && typeof window !== 'undefined') window.speechSynthesis.cancel();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Cancel any in-progress speech when TTS is disabled
  useEffect(() => {
    if (!ttsEnabled && typeof window !== 'undefined') window.speechSynthesis.cancel();
  }, [ttsEnabled]);

  /** Close profile panel on Escape. */
  useEffect(() => {
    if (!profileOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [profileOpen]);

  /** Close profile panel on click outside. */
  useEffect(() => {
    if (!profileOpen) return;
    const handleOutside = (e: globalThis.MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [profileOpen]);

  const handleLogout = useCallback(() => {
    void logout(true);
  }, [logout]);

  const circleLabel = currentPageName ? CIRCLE_LABELS[currentPageName] : undefined;

  const confirmDelete = useCallback(
    async (child: Child) => {
      setChildToDelete(null);
      // Deleting the child whose page is open leaves nothing to show here.
      if ((await deleteChild(child.id)) && child.id === navChildId) {
        void navigate('/Home', { replace: true });
      }
    },
    [deleteChild, navChildId, navigate],
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
        {/*
          Full-bleed on purpose — a max-w cap here pinned the wordmark and the
          controls ~350px in from the edges on a 1920 display. Padding only, and
          responsive rather than the mockups' flat 40px, which would eat a quarter
          of a 375px header. Does not align with page content, which is centred at
          its own max-width; the design mockups do the same.
        */}
        <div className="px-4 sm:px-6 lg:px-10">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link to={createPageUrl('Home')} className="flex items-center gap-2.5">
              <div
                className="orb-cyan-gradient h-8 w-8 flex-shrink-0 rounded-full"
                style={{ boxShadow: '0 0 16px rgb(var(--constellation-cyan-rgb) / .7)' }}
              />
              {/*
                Stacks below the sm breakpoint: the wordmark and the circle chip
                side by side don't fit next to the right-hand controls on a 375px
                header, so the chip drops onto a second line rather than the whole
                block being hidden.
              */}
              <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2.5">
                <span className="whitespace-nowrap font-orbitron text-sm font-black leading-none tracking-[0.06em] text-sidebar-foreground">
                  SUPERPOWER
                </span>
                {circleLabel && (
                  <>
                    {/* Row-only separator — a vertical rule reads as noise once stacked. */}
                    <span
                      className="hidden h-4 w-px sm:block"
                      style={{ background: 'rgb(var(--constellation-cyan-rgb) / .25)' }}
                    />
                    <span
                      // Explicit font-rajdhani, not inherited: in the design mockups
                      // the page root sets Rajdhani and the header picks it up, but
                      // here the header sits outside each page's root element, so
                      // without this it falls back to the Tailwind sans stack and
                      // this chip alone renders in the wrong typeface.
                      className="whitespace-nowrap font-rajdhani leading-none"
                      style={{
                        fontWeight: 700,
                        fontSize: 11,
                        letterSpacing: '.22em',
                        textTransform: 'uppercase',
                        color: 'rgb(var(--constellation-cyan-rgb))',
                      }}
                    >
                      {circleLabel}
                    </span>
                  </>
                )}
              </div>
            </Link>

            {/* Right side controls */}
            <div className="flex items-center gap-2">
              {/* TTS Toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  toggleTts();
                }}
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
                title={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
                aria-label={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
                aria-pressed={ttsEnabled}
              >
                {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>

              {/* Start Over — shown on child-specific pages only */}
              {isAuthenticated && navChildId && !childView && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmingStartOver(true)}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Start Over"
                  aria-label="Start Over"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}

              {/* Profile Avatar — authenticated */}
              {isAuthenticated && (
                <div className="relative" ref={profileRef}>
                  <button
                    onClick={() => setProfileOpen((prev) => !prev)}
                    className="profile-pill"
                    title="Your profile"
                    aria-label="Your profile"
                    aria-expanded={profileOpen}
                    aria-haspopup="true"
                  >
                    <span
                      className={cn(
                        'avatar-dot h-8 w-8 text-[13px]',
                        childView ? 'avatar-dot-child' : 'avatar-dot-parent',
                      )}
                    >
                      {profileInitial}
                    </span>
                    {/* Name and view beside the dot from sm up; a 375px header has no room. */}
                    <span className="hidden flex-col items-start gap-0.5 leading-tight sm:flex">
                      <span className="max-w-32 truncate text-sm font-bold">{profileName}</span>
                      <span className="profile-label">{viewLabel}</span>
                    </span>
                  </button>

                  {profileOpen && (
                    <div
                      role="dialog"
                      aria-label="User profile"
                      className="profile-panel absolute right-0 top-full z-50 mt-2 w-72"
                    >
                      <p className="profile-heading">Signed-in profile</p>

                      {childView ? (
                        <>
                          {/* Child view: only the child, and the way back to parent view. */}
                          <div className="profile-row profile-row-selected">
                            <span className="avatar-dot avatar-dot-child h-7 w-7 text-xs">
                              {profileInitial}
                            </span>
                            <span className="min-w-0">
                              <span className="profile-name block">{profileName}</span>
                              <span className="profile-desc block">Child view</span>
                            </span>
                          </div>
                          <div className="profile-divider" />
                          <button
                            type="button"
                            onClick={() => {
                              setProfileOpen(false);
                              const childId = view.childId;
                              exitChildView();
                              void navigate(`/PersonalityJourney/${childId}`);
                            }}
                            className="profile-link"
                          >
                            <ArrowLeft className="h-4 w-4" />
                            Back to parent view
                          </button>
                        </>
                      ) : (
                        <>
                          {/* The signed-in parent: the profile this view belongs to. */}
                          <div className="profile-row profile-row-selected">
                            <span className="avatar-dot avatar-dot-parent h-7 w-7 text-xs">
                              {profileInitial}
                            </span>
                            <span className="min-w-0">
                              <span className="profile-name block">{profileName}</span>
                              <span className="profile-desc block">
                                {isParent ? 'Parent · sees everything' : 'Admin'}
                              </span>
                            </span>
                          </div>

                          {isParent && (
                            <ProfileChildren
                              list={kids.list}
                              isLoading={kids.isLoading}
                              isLoadingError={kids.isLoadingError}
                              isFetching={kids.isFetching}
                              onRetry={() => void kids.refetch()}
                              currentChildId={navChildId}
                              onClose={() => setProfileOpen(false)}
                              onDelete={setChildToDelete}
                              onChildView={(child: Child) => {
                                enterChildView(child.id);
                                void navigate(childViewHome(child.id));
                              }}
                            />
                          )}

                          <div className="profile-divider" />

                          {/* Navigation + actions */}
                          <Link
                            to={createPageUrl('Home')}
                            onClick={() => setProfileOpen(false)}
                            className={cn(
                              'profile-link',
                              currentPageName === 'Home' && 'profile-link-active',
                            )}
                          >
                            <Home className="h-4 w-4" />
                            Home
                          </Link>
                          <Link
                            to={createPageUrl('AccountSettings')}
                            onClick={() => setProfileOpen(false)}
                            className={cn(
                              'profile-link',
                              currentPageName === 'AccountSettings' && 'profile-link-active',
                            )}
                          >
                            <Settings className="h-4 w-4" />
                            Account settings
                          </Link>
                          <button
                            onClick={() => {
                              setProfileOpen(false);
                              handleLogout();
                            }}
                            className="profile-link hover:text-error"
                          >
                            <LogOut className="h-4 w-4" />
                            Sign out
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sign In — unauthenticated only */}
              {!isAuthenticated && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void account.redirectToLogin();
                  }}
                  className="border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Sign In
                </Button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Back — below the header, navigates to the previous route. Not on the kids page,
          whose own header has the Back to the circles. */}
      {currentPageName !== 'Kids' && (
        <div className="px-4 pt-4 sm:px-6 lg:px-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigate(-1)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      )}

      {/* Page Content */}
      {children}

      <AnimatePresence>
        {confirmingStartOver && (
          <ConfirmModal
            onCancel={() => setConfirmingStartOver(false)}
            onConfirm={() => {
              setConfirmingStartOver(false);
              void doStartOver();
            }}
            isStartingOver={isStartingOver}
            {...startOverCopy(currentChild?.name)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {childToDelete && (
          <ConfirmModal
            onCancel={() => setChildToDelete(null)}
            onConfirm={() => void confirmDelete(childToDelete)}
            isStartingOver={deletingId !== null}
            title={`Delete ${childToDelete.name}?`}
            description="Their profile, chat, results and plan are deleted for good."
          />
        )}
      </AnimatePresence>
    </div>
  );
}
