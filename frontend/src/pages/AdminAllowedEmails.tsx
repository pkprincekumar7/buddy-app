import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Search,
  Mail,
  Shield,
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  Users,
} from 'lucide-react';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { AdminUserRecord } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PAGE_SIZE = 20;

export default function AdminAllowedEmails() {
  const qc = useQueryClient();

  const [page, setPage] = useState(0);
  const [searchEmail, setSearchEmail] = useState('');
  const [searchResult, setSearchResult] = useState<
    { email: string; added_at: string | null } | null | 'not_found'
  >(null);
  const [searching, setSearching] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [usersPage, setUsersPage] = useState(0);
  const [lockTarget, setLockTarget] = useState<AdminUserRecord | null>(null);
  const [userSearchEmail, setUserSearchEmail] = useState('');
  const [userSearchResult, setUserSearchResult] = useState<AdminUserRecord | null | 'not_found'>(
    null,
  );
  const [userSearching, setUserSearching] = useState(false);

  const skip = page * PAGE_SIZE;
  const usersSkip = usersPage * PAGE_SIZE;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'allowed-emails', page],
    queryFn: () => api.admin.listAllowedEmails(skip, PAGE_SIZE),
  });

  const addMutation = useMutation({
    mutationFn: (email: string) => api.admin.addAllowedEmail(email),
    onSuccess: (record) => {
      toast.success(`${record.email} added to allowlist`);
      setAddOpen(false);
      setAddEmail('');
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? typeof err.detail === 'string'
            ? err.detail
            : JSON.stringify(err.detail)
          : 'Failed to add email';
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (email: string) => api.admin.removeAllowedEmail(email),
    onSuccess: () => {
      toast.success('Email removed from allowlist');
      setDeleteTarget(null);
      setPage(0);
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? typeof err.detail === 'string'
            ? err.detail
            : JSON.stringify(err.detail)
          : 'Failed to remove email';
      toast.error(msg);
    },
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', usersPage],
    queryFn: () => api.admin.listUsers(usersSkip, PAGE_SIZE),
  });

  const lockMutation = useMutation({
    mutationFn: (user: AdminUserRecord) =>
      user.locked
        ? api.admin.unlockUser(user.id, user.location ?? '')
        : api.admin.lockUser(user.id, user.location ?? ''),
    onSuccess: (result) => {
      toast.success(result.locked ? 'User locked' : 'User unlocked');
      setLockTarget(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setUserSearchResult((prev) =>
        prev && prev !== 'not_found' && prev.id === result.id
          ? { ...prev, locked: result.locked }
          : prev,
      );
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? typeof err.detail === 'string'
            ? err.detail
            : JSON.stringify(err.detail)
          : 'Action failed';
      toast.error(msg);
    },
  });

  const handleSearch = async () => {
    const trimmed = searchEmail.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const result = await api.admin.getAllowedEmail(trimmed);
      setSearchResult(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setSearchResult('not_found');
      } else {
        const msg =
          err instanceof ApiError
            ? typeof err.detail === 'string'
              ? err.detail
              : JSON.stringify(err.detail)
            : 'Search failed';
        toast.error(msg);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleUserSearch = async () => {
    const trimmed = userSearchEmail.trim();
    if (!trimmed) return;
    setUserSearching(true);
    setUserSearchResult(null);
    try {
      const result = await api.admin.getUserByEmail(trimmed);
      setUserSearchResult(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setUserSearchResult('not_found');
      } else {
        const msg =
          err instanceof ApiError
            ? typeof err.detail === 'string'
              ? err.detail
              : JSON.stringify(err.detail)
            : 'Search failed';
        toast.error(msg);
      }
    } finally {
      setUserSearching(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const usersTotalPages = usersData ? Math.ceil(usersData.total / PAGE_SIZE) : 0;

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Manage allowed emails and registered users.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="allowed-emails">
        <TabsList className="w-full">
          <TabsTrigger value="allowed-emails" className="flex-1 gap-2">
            <Mail className="h-4 w-4" />
            Allowed Emails
          </TabsTrigger>
          <TabsTrigger value="registered-users" className="flex-1 gap-2">
            <Users className="h-4 w-4" />
            Registered Users
          </TabsTrigger>
        </TabsList>

        {/* Allowed Emails Tab */}
        <TabsContent value="allowed-emails" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Only these emails can register for the application.
            </p>
            <Button
              className="bg-primary-action hover:bg-primary-action/80"
              size="sm"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add email
            </Button>
          </div>

          {/* Search */}
          <Card className="border-edge bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Look up an email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  className="form-input flex-1"
                  placeholder="user@example.com"
                  value={searchEmail}
                  onChange={(e) => {
                    setSearchEmail(e.target.value);
                    setSearchResult(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSearch();
                  }}
                />
                <Button
                  variant="outline"
                  className="border-edge"
                  onClick={() => void handleSearch()}
                  disabled={searching || !searchEmail.trim()}
                >
                  {searching ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {searchResult === 'not_found' && (
                <p className="mt-2 text-sm text-muted-foreground">Not found in allowlist.</p>
              )}
              {searchResult && searchResult !== 'not_found' && (
                <div className="border-edge bg-ghost mt-3 flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-primary" />
                    <span className="text-sm text-foreground">{searchResult.email}</span>
                    <span className="text-xs text-muted-foreground">
                      Added {formatDate(searchResult.added_at)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-error hover:bg-error/10 hover:text-error"
                    disabled={deleteMutation.isPending}
                    onClick={() => setDeleteTarget(searchResult.email)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* List */}
          <Card className="border-edge bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm font-medium text-foreground">
                <span>All allowed emails</span>
                {data && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {data.total} total
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : !data?.items.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No emails in allowlist yet.
                </p>
              ) : (
                <ul className="divide-edge divide-y">
                  {data.items.map((item) => (
                    <li
                      key={item.email}
                      className="hover:bg-ghost flex items-center justify-between px-5 py-3 transition-colors"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Mail className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm text-foreground">{item.email}</span>
                      </div>
                      <div className="ml-4 flex shrink-0 items-center gap-3">
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {formatDate(item.added_at)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-error hover:bg-error/10 hover:text-error"
                          disabled={deleteMutation.isPending}
                          onClick={() => setDeleteTarget(item.email)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {totalPages > 1 && (
                <div className="border-edge flex items-center justify-between border-t px-5 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Registered Users Tab */}
        <TabsContent value="registered-users" className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            View and manage accounts that have registered for the application.
          </p>

          {/* User search */}
          <Card className="border-edge bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">Look up a user</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  className="form-input flex-1"
                  placeholder="user@example.com"
                  value={userSearchEmail}
                  onChange={(e) => {
                    setUserSearchEmail(e.target.value);
                    setUserSearchResult(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleUserSearch();
                  }}
                />
                <Button
                  variant="outline"
                  className="border-edge"
                  onClick={() => void handleUserSearch()}
                  disabled={userSearching || !userSearchEmail.trim()}
                >
                  {userSearching ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {userSearchResult === 'not_found' && (
                <p className="mt-2 text-sm text-muted-foreground">No registered user found.</p>
              )}
              {userSearchResult && userSearchResult !== 'not_found' && (
                <div className="border-edge bg-ghost mt-3 flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {userSearchResult.full_name ?? '—'}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {userSearchResult.email ?? '—'}
                    </span>
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-3">
                    {userSearchResult.locked && (
                      <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
                        Locked
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={
                        userSearchResult.locked
                          ? 'hover:bg-ghost h-7 w-7 text-muted-foreground hover:text-foreground'
                          : 'h-7 w-7 text-error hover:bg-error/10 hover:text-error'
                      }
                      disabled={lockMutation.isPending}
                      onClick={() => setLockTarget(userSearchResult)}
                      title={userSearchResult.locked ? 'Unlock user' : 'Lock user'}
                    >
                      {userSearchResult.locked ? (
                        <LockOpen className="h-3.5 w-3.5" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Registered Users list */}
          <Card className="border-edge bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm font-medium text-foreground">
                <span>All registered users</span>
                {usersData && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {usersData.total} total
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {usersLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : !usersData?.items.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No registered users.
                </p>
              ) : (
                <ul className="divide-edge divide-y">
                  {usersData.items.map((user) => (
                    <li
                      key={user.id}
                      className="hover:bg-ghost flex items-center justify-between px-5 py-3 transition-colors"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {user.full_name ?? '—'}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {user.email ?? '—'}
                        </span>
                      </div>
                      <div className="ml-4 flex shrink-0 items-center gap-3">
                        {user.locked && (
                          <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
                            Locked
                          </span>
                        )}
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {formatDate(user.created_at)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={
                            user.locked
                              ? 'hover:bg-ghost h-7 w-7 text-muted-foreground hover:text-foreground'
                              : 'h-7 w-7 text-error hover:bg-error/10 hover:text-error'
                          }
                          disabled={lockMutation.isPending}
                          onClick={() => setLockTarget(user)}
                          title={user.locked ? 'Unlock user' : 'Lock user'}
                        >
                          {user.locked ? (
                            <LockOpen className="h-3.5 w-3.5" />
                          ) : (
                            <Lock className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {usersTotalPages > 1 && (
                <div className="border-edge flex items-center justify-between border-t px-5 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                    disabled={usersPage === 0}
                    onClick={() => setUsersPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {usersPage + 1} of {usersTotalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                    disabled={usersPage >= usersTotalPages - 1}
                    onClick={() => setUsersPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add email dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="border-edge bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Add email to allowlist</DialogTitle>
          </DialogHeader>
          <Input
            className="form-input"
            placeholder="user@example.com"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && addEmail.trim()) addMutation.mutate(addEmail.trim());
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" className="border-edge" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-primary-action hover:bg-primary-action/80"
              disabled={!addEmail.trim() || addMutation.isPending}
              onClick={() => addMutation.mutate(addEmail.trim())}
            >
              {addMutation.isPending ? 'Adding…' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="border-edge bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Remove from allowlist?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              <span className="font-medium text-foreground">{deleteTarget}</span> will no longer be
              able to register. Existing account is unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-edge">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-error/90 text-white hover:bg-error"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lock / unlock confirm */}
      <AlertDialog open={!!lockTarget} onOpenChange={(o) => !o && setLockTarget(null)}>
        <AlertDialogContent className="border-edge bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              {lockTarget?.locked ? 'Unlock user?' : 'Lock user?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {lockTarget?.locked ? (
                <>
                  <span className="font-medium text-foreground">{lockTarget.email}</span> will be
                  able to log in again.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{lockTarget?.email}</span> will be
                  immediately signed out and blocked from logging in.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-edge">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                lockTarget?.locked
                  ? 'bg-primary hover:bg-primary/90'
                  : 'bg-error/90 text-white hover:bg-error'
              }
              disabled={lockMutation.isPending}
              onClick={() => lockTarget && lockMutation.mutate(lockTarget)}
            >
              {lockTarget?.locked ? 'Unlock' : 'Lock'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
