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
import {
  admin,
  ADMIN_ERRORS,
  nameOf,
  type Account,
  type AllowedEmail,
  type ProfileName,
  type Role,
} from '@/api/admin';
import { httpErrorMessage } from '@/lib/apiError';
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

// The services' refusals, matched on detail.code (build plan 7.3).
const errorMessage = (err: unknown, fallback: string) =>
  httpErrorMessage(err as Error | undefined, { fallback, codeMessages: ADMIN_ERRORS });

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/** An account's row: its name (from users), email, role, lock state and actions. */
function AccountRow({
  account,
  name,
  busy,
  onLock,
  onRole,
}: {
  account: Account;
  name: ProfileName | undefined;
  busy: boolean;
  onLock: (account: Account) => void;
  onRole: (account: Account, role: Role) => void;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{nameOf(name) ?? '—'}</span>
        <span className="truncate text-xs text-muted-foreground">{account.email}</span>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-3">
        {account.locked && (
          <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
            Locked
          </span>
        )}
        <span className="hidden text-xs text-muted-foreground sm:block">
          {formatDate(account.created_at)}
        </span>
        <select
          aria-label={`Role of ${account.email}`}
          value={account.role}
          disabled={busy}
          onChange={(e) => onRole(account, e.target.value as Role)}
          className="form-input h-7 w-auto py-0 text-xs"
        >
          <option value="parent">Parent</option>
          <option value="admin">Admin</option>
        </select>
        <Button
          variant="ghost"
          size="icon"
          className={
            account.locked
              ? 'hover:bg-ghost h-7 w-7 text-muted-foreground hover:text-foreground'
              : 'h-7 w-7 text-error hover:bg-error/10 hover:text-error'
          }
          disabled={busy}
          onClick={() => onLock(account)}
          title={account.locked ? 'Unlock user' : 'Lock user'}
        >
          {account.locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </>
  );
}

/** A confirmation's target, kept while the dialog closes so its text doesn't flash empty. */
function useDialogTarget<T>() {
  const [state, setState] = useState<{ target: T | null; open: boolean }>({
    target: null,
    open: false,
  });
  return {
    target: state.target,
    open: state.open,
    show: (target: T) => setState({ target, open: true }),
    close: () => setState((current) => ({ ...current, open: false })),
  };
}

export default function AdminAllowedEmails() {
  const qc = useQueryClient();

  const [page, setPage] = useState(0);
  const [searchEmail, setSearchEmail] = useState('');
  const [searchResult, setSearchResult] = useState<AllowedEmail | null | 'not_found'>(null);
  const [searching, setSearching] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');

  const deleteDialog = useDialogTarget<AllowedEmail>();

  const [usersPage, setUsersPage] = useState(0);
  const lockDialog = useDialogTarget<Account>();
  const roleDialog = useDialogTarget<{ account: Account; role: Role }>();
  const [userSearchEmail, setUserSearchEmail] = useState('');
  const [userSearchResult, setUserSearchResult] = useState<Account | null | 'not_found'>(null);
  const [userSearching, setUserSearching] = useState(false);

  const skip = page * PAGE_SIZE;
  const usersSkip = usersPage * PAGE_SIZE;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'allowed-emails', page],
    queryFn: () => admin.allowedEmails.list(skip, PAGE_SIZE),
  });

  const addMutation = useMutation({
    mutationFn: (email: string) => admin.allowedEmails.add(email),
    onSuccess: (record) => {
      toast.success(`${record.email_hint} added to allowlist`);
      setAddOpen(false);
      setAddEmail('');
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to add email')),
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: AllowedEmail) => admin.allowedEmails.remove(entry.key),
    onSuccess: (_, entry) => {
      toast.success('Email removed from allowlist');
      deleteDialog.close();
      setPage(0);
      setSearchResult((prev) =>
        prev && prev !== 'not_found' && prev.key === entry.key ? null : prev,
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to remove email')),
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', usersPage],
    queryFn: () => admin.accounts.list(usersSkip, PAGE_SIZE),
  });

  // The names of the page's accounts, and of a found one, in one call each.
  const pageIds = usersData?.items.map((account) => account.id) ?? [];
  const foundId = userSearchResult && userSearchResult !== 'not_found' ? userSearchResult.id : null;
  const ids = foundId && !pageIds.includes(foundId) ? [...pageIds, foundId] : pageIds;
  const { data: names } = useQuery({
    queryKey: ['admin', 'names', ids],
    queryFn: () => admin.names(ids),
    enabled: ids.length > 0,
  });

  const updateAccount = (id: string, change: Partial<Account>) => {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    setUserSearchResult((prev) =>
      prev && prev !== 'not_found' && prev.id === id ? { ...prev, ...change } : prev,
    );
  };

  const lockMutation = useMutation({
    mutationFn: (account: Account) =>
      account.locked ? admin.accounts.unlock(account) : admin.accounts.lock(account),
    onSuccess: (result) => {
      toast.success(result.locked ? 'User locked' : 'User unlocked');
      lockDialog.close();
      updateAccount(result.id, { locked: result.locked });
    },
    onError: (err) => {
      lockDialog.close();
      toast.error(errorMessage(err, 'Action failed'));
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ account, role }: { account: Account; role: Role }) =>
      admin.accounts.setRole(account, role),
    onSuccess: (result) => {
      toast.success(result.role === 'admin' ? 'Now an admin' : 'Now a parent');
      roleDialog.close();
      updateAccount(result.id, { role: result.role });
    },
    onError: (err) => {
      roleDialog.close();
      toast.error(errorMessage(err, 'Could not change the role'));
    },
  });

  const handleSearch = async () => {
    const trimmed = searchEmail.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchResult(null);
    try {
      setSearchResult((await admin.allowedEmails.search(trimmed)) ?? 'not_found');
    } catch (err) {
      toast.error(errorMessage(err, 'Search failed'));
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
      setUserSearchResult((await admin.accounts.search(trimmed)) ?? 'not_found');
    } catch (err) {
      toast.error(errorMessage(err, 'Search failed'));
    } finally {
      setUserSearching(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const usersTotalPages = usersData ? Math.ceil(usersData.total / PAGE_SIZE) : 0;
  const accountBusy = lockMutation.isPending || roleMutation.isPending;

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
              Only these emails can register for the application. Emails are stored as a key, so the
              list shows a masked hint.
            </p>
            <Button variant="action" size="sm" onClick={() => setAddOpen(true)}>
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
                    <span className="text-sm text-foreground">{searchResult.email_hint}</span>
                    <span className="text-xs text-muted-foreground">
                      Added {formatDate(searchResult.created_at)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-error hover:bg-error/10 hover:text-error"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteDialog.show(searchResult)}
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
                      key={item.key}
                      className="hover:bg-ghost flex items-center justify-between px-5 py-3 transition-colors"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Mail className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate text-sm text-foreground">{item.email_hint}</span>
                      </div>
                      <div className="ml-4 flex shrink-0 items-center gap-3">
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {formatDate(item.created_at)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-error hover:bg-error/10 hover:text-error"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteDialog.show(item)}
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
                  <AccountRow
                    account={userSearchResult}
                    name={names?.get(userSearchResult.id)}
                    busy={accountBusy}
                    onLock={lockDialog.show}
                    onRole={(account, role) => roleDialog.show({ account, role })}
                  />
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
                  {usersData.items.map((account) => (
                    <li
                      key={account.id}
                      className="hover:bg-ghost flex items-center justify-between px-5 py-3 transition-colors"
                    >
                      <AccountRow
                        account={account}
                        name={names?.get(account.id)}
                        busy={accountBusy}
                        onLock={lockDialog.show}
                        onRole={(a, role) => roleDialog.show({ account: a, role })}
                      />
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
              variant="action"
              disabled={!addEmail.trim() || addMutation.isPending}
              onClick={() => addMutation.mutate(addEmail.trim())}
            >
              {addMutation.isPending ? 'Adding…' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(o) => !o && deleteDialog.close()}>
        <AlertDialogContent className="border-edge bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Remove from allowlist?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              <span className="font-medium text-foreground">{deleteDialog.target?.email_hint}</span>{' '}
              will no longer be able to register. Existing account is unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-edge">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-error/90 text-white hover:bg-error"
              disabled={deleteMutation.isPending}
              onClick={() => deleteDialog.target && deleteMutation.mutate(deleteDialog.target)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lock / unlock confirm */}
      <AlertDialog open={lockDialog.open} onOpenChange={(o) => !o && lockDialog.close()}>
        <AlertDialogContent className="border-edge bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              {lockDialog.target?.locked ? 'Unlock user?' : 'Lock user?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {lockDialog.target?.locked ? (
                <>
                  <span className="font-medium text-foreground">{lockDialog.target.email}</span>{' '}
                  will be able to log in again.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{lockDialog.target?.email}</span>{' '}
                  will be immediately signed out and blocked from logging in.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-edge">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                lockDialog.target?.locked
                  ? 'bg-primary hover:bg-primary/90'
                  : 'bg-error/90 text-white hover:bg-error'
              }
              disabled={lockMutation.isPending}
              onClick={() => lockDialog.target && lockMutation.mutate(lockDialog.target)}
            >
              {lockDialog.target?.locked ? 'Unlock' : 'Lock'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Role change confirm */}
      <AlertDialog open={roleDialog.open} onOpenChange={(o) => !o && roleDialog.close()}>
        <AlertDialogContent className="border-edge bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              {roleDialog.target?.role === 'admin' ? 'Make admin?' : 'Make parent?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {roleDialog.target?.account.email}
              </span>{' '}
              {roleDialog.target?.role === 'admin'
                ? 'will be able to manage the allowlist and every account.'
                : 'will no longer have admin access.'}{' '}
              They're signed out, and the new role applies when they sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-edge">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={roleMutation.isPending}
              onClick={() => roleDialog.target && roleMutation.mutate(roleDialog.target)}
            >
              {roleDialog.target?.role === 'admin' ? 'Make admin' : 'Make parent'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
