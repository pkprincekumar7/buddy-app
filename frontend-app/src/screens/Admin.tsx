import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import {
  Lock,
  LockOpen,
  Mail,
  Plus,
  Shield,
  Trash2,
  Users,
} from 'lucide-react-native';
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
import { color } from '@/theme';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import PageScroll from '@/components/layout/PageScroll';
import {
  AlertDialog,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ListSpinner,
  LockedBadge,
  Pager,
  SearchRow,
  TabsList,
  TabsTrigger,
} from '@/components/admin/primitives';

const PAGE_SIZE = 20;

type AdminTab = 'allowed-emails' | 'registered-users';

// The services' refusals, matched on detail.code (build plan 7.3).
function errorDetail(err: unknown, fallback: string): string {
  return httpErrorMessage(err as Error | undefined, {
    fallback,
    codeMessages: ADMIN_ERRORS,
  });
}

/** Ghost icon button: remove (trash) or lock/unlock. */
function RowIconButton({
  kind,
  disabled,
  onPress,
  label,
}: {
  kind: 'delete' | 'lock' | 'unlock';
  disabled: boolean;
  onPress: () => void;
  label: string;
}) {
  const Icon = kind === 'delete' ? Trash2 : kind === 'unlock' ? LockOpen : Lock;
  return (
    <Button
      variant="ghost"
      size="icon"
      accessibilityLabel={label}
      className={cn(
        'h-7 w-7',
        kind === 'unlock' ? 'active:bg-ghost' : 'active:bg-error/10',
      )}
      disabled={disabled}
      onPress={onPress}
    >
      <Icon
        size={14}
        color={kind === 'unlock' ? color['muted-foreground'] : color.error}
      />
    </Button>
  );
}

function UserSummary({
  user,
  name,
}: {
  user: Account;
  name: ProfileName | undefined;
}) {
  return (
    <View className="min-w-0 flex-1 gap-0.5">
      <Text numberOfLines={1} className="text-sm font-medium text-foreground">
        {nameOf(name) ?? '—'}
      </Text>
      <Text numberOfLines={1} className="text-xs text-muted-foreground">
        {user.email}
        {user.role === 'admin' ? ' · Admin' : ''}
      </Text>
    </View>
  );
}

/** The role control (build plan 7.3): makes a parent an admin, or an admin a parent. */
function RoleButton({
  user,
  disabled,
  onPress,
}: {
  user: Account;
  disabled: boolean;
  onPress: (role: Role) => void;
}) {
  const next: Role = user.role === 'admin' ? 'parent' : 'admin';
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 border-edge px-2"
      accessibilityLabel={`Make ${user.email} ${
        next === 'admin' ? 'an admin' : 'a parent'
      }`}
      disabled={disabled}
      onPress={() => onPress(next)}
    >
      {next === 'admin' ? 'Make admin' : 'Make parent'}
    </Button>
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
    close: () => setState(current => ({ ...current, open: false })),
  };
}

export default function Admin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<AdminTab>('allowed-emails');

  const [page, setPage] = useState(0);
  const [searchEmail, setSearchEmail] = useState('');
  const [searchResult, setSearchResult] = useState<
    AllowedEmail | null | 'not_found'
  >(null);
  const [searching, setSearching] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');

  const deleteDialog = useDialogTarget<AllowedEmail>();

  const [usersPage, setUsersPage] = useState(0);
  const lockDialog = useDialogTarget<Account>();
  const roleDialog = useDialogTarget<{ account: Account; role: Role }>();
  const [userSearchEmail, setUserSearchEmail] = useState('');
  const [userSearchResult, setUserSearchResult] = useState<
    Account | null | 'not_found'
  >(null);
  const [userSearching, setUserSearching] = useState(false);

  const skip = page * PAGE_SIZE;
  const usersSkip = usersPage * PAGE_SIZE;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'allowed-emails', page],
    queryFn: () => admin.allowedEmails.list(skip, PAGE_SIZE),
  });

  const addMutation = useMutation({
    mutationFn: (email: string) => admin.allowedEmails.add(email),
    onSuccess: record => {
      toast.success(`${record.email_hint} added to allowlist`);
      setAddOpen(false);
      setAddEmail('');
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: err => {
      toast.error(errorDetail(err, 'Failed to add email'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: AllowedEmail) => admin.allowedEmails.remove(entry.key),
    onSuccess: (_, entry) => {
      toast.success('Email removed from allowlist');
      deleteDialog.close();
      setPage(0);
      setSearchResult(prev =>
        prev && prev !== 'not_found' && prev.key === entry.key ? null : prev,
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: err => {
      toast.error(errorDetail(err, 'Failed to remove email'));
    },
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', usersPage],
    queryFn: () => admin.accounts.list(usersSkip, PAGE_SIZE),
  });

  // The names of the page's accounts, and of a found one, in one call each.
  const pageIds = usersData?.items.map(account => account.id) ?? [];
  const foundId =
    userSearchResult && userSearchResult !== 'not_found'
      ? userSearchResult.id
      : null;
  const ids =
    foundId && !pageIds.includes(foundId) ? [...pageIds, foundId] : pageIds;
  const { data: names } = useQuery({
    queryKey: ['admin', 'names', ids],
    queryFn: () => admin.names(ids),
    enabled: ids.length > 0,
  });

  const updateAccount = (id: string, change: Partial<Account>) => {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    setUserSearchResult(prev =>
      prev && prev !== 'not_found' && prev.id === id
        ? { ...prev, ...change }
        : prev,
    );
  };

  const lockMutation = useMutation({
    mutationFn: (user: Account) =>
      user.locked ? admin.accounts.unlock(user) : admin.accounts.lock(user),
    onSuccess: result => {
      toast.success(result.locked ? 'User locked' : 'User unlocked');
      lockDialog.close();
      updateAccount(result.id, { locked: result.locked });
    },
    onError: err => {
      lockDialog.close();
      toast.error(errorDetail(err, 'Action failed'));
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ account, role }: { account: Account; role: Role }) =>
      admin.accounts.setRole(account, role),
    onSuccess: result => {
      toast.success(result.role === 'admin' ? 'Now an admin' : 'Now a parent');
      roleDialog.close();
      updateAccount(result.id, { role: result.role });
    },
    onError: err => {
      roleDialog.close();
      toast.error(errorDetail(err, 'Could not change the role'));
    },
  });
  const accountBusy = lockMutation.isPending || roleMutation.isPending;

  const handleSearch = async () => {
    const trimmed = searchEmail.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchResult(null);
    try {
      setSearchResult(
        (await admin.allowedEmails.search(trimmed)) ?? 'not_found',
      );
    } catch (err) {
      toast.error(errorDetail(err, 'Search failed'));
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
      setUserSearchResult(
        (await admin.accounts.search(trimmed)) ?? 'not_found',
      );
    } catch (err) {
      toast.error(errorDetail(err, 'Search failed'));
    } finally {
      setUserSearching(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const usersTotalPages = usersData
    ? Math.ceil(usersData.total / PAGE_SIZE)
    : 0;

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const submitAdd = () => {
    if (addEmail.trim()) addMutation.mutate(addEmail.trim());
  };

  return (
    <PageScroll>
      <View className="w-full max-w-3xl gap-6 self-center px-4 py-8">
        {/* Header */}
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Shield size={20} color={color.primary} />
          </View>
          <View className="flex-1">
            <Text
              accessibilityRole="header"
              className="text-xl font-semibold text-foreground"
            >
              Admin
            </Text>
            <Text className="text-sm text-muted-foreground">
              Manage allowed emails and registered users.
            </Text>
          </View>
        </View>

        {/* Tabs */}
        <View>
          <TabsList>
            <TabsTrigger
              label="Allowed Emails"
              Icon={Mail}
              active={tab === 'allowed-emails'}
              onPress={() => setTab('allowed-emails')}
            />
            <TabsTrigger
              label="Registered Users"
              Icon={Users}
              active={tab === 'registered-users'}
              onPress={() => setTab('registered-users')}
            />
          </TabsList>

          {/* Allowed Emails Tab */}
          {tab === 'allowed-emails' ? (
            <View className="mt-4 gap-4">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm text-muted-foreground">
                  Only these emails can register for the application. Emails are
                  stored as a key, so the list shows a masked hint.
                </Text>
                <Button
                  variant="action"
                  size="sm"
                  accessibilityLabel="Add email"
                  onPress={() => setAddOpen(true)}
                >
                  <Plus
                    size={16}
                    color={color['primary-foreground']}
                    style={{ marginRight: 6 }}
                  />
                  Add email
                </Button>
              </View>

              {/* Search */}
              <Card>
                <CardHeader>
                  <CardTitle>Look up an email</CardTitle>
                </CardHeader>
                <CardContent>
                  <SearchRow
                    accessibilityLabel="Look up an email"
                    value={searchEmail}
                    onChangeText={v => {
                      setSearchEmail(v);
                      setSearchResult(null);
                    }}
                    onSubmit={() => void handleSearch()}
                    searching={searching}
                  />
                  {searchResult === 'not_found' && (
                    <Text className="mt-2 text-sm text-muted-foreground">
                      Not found in allowlist.
                    </Text>
                  )}
                  {searchResult && searchResult !== 'not_found' && (
                    <View className="mt-3 flex-row items-center justify-between rounded-lg border border-edge bg-ghost px-3 py-2">
                      <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-2">
                        <Mail size={16} color={color.primary} />
                        <Text className="shrink text-sm text-foreground">
                          {searchResult.email_hint}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          Added {formatDate(searchResult.created_at)}
                        </Text>
                      </View>
                      <RowIconButton
                        kind="delete"
                        label={`Remove ${searchResult.email_hint}`}
                        disabled={deleteMutation.isPending}
                        onPress={() => deleteDialog.show(searchResult)}
                      />
                    </View>
                  )}
                </CardContent>
              </Card>

              {/* List */}
              <Card>
                <CardHeader>
                  <View className="flex-row items-center justify-between">
                    <CardTitle>All allowed emails</CardTitle>
                    {data && (
                      <Text className="text-xs text-muted-foreground">
                        {data.total} total
                      </Text>
                    )}
                  </View>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading ? (
                    <ListSpinner />
                  ) : !data?.items.length ? (
                    <Text className="py-10 text-center text-sm text-muted-foreground">
                      No emails in allowlist yet.
                    </Text>
                  ) : (
                    <View accessibilityRole="list">
                      {data.items.map((item, i) => (
                        <View
                          key={item.key}
                          className={cn(
                            'flex-row items-center justify-between px-5 py-3',
                            i > 0 && 'border-t border-border',
                          )}
                        >
                          <View className="min-w-0 flex-1 flex-row items-center gap-2">
                            <Mail size={16} color={color.primary} />
                            <Text
                              numberOfLines={1}
                              className="shrink text-sm text-foreground"
                            >
                              {item.email_hint}
                            </Text>
                          </View>
                          <View className="ml-4 shrink-0 flex-row items-center gap-3">
                            <RowIconButton
                              kind="delete"
                              label={`Remove ${item.email_hint}`}
                              disabled={deleteMutation.isPending}
                              onPress={() => deleteDialog.show(item)}
                            />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {totalPages > 1 && (
                    <Pager
                      page={page}
                      totalPages={totalPages}
                      onPrev={() => setPage(p => p - 1)}
                      onNext={() => setPage(p => p + 1)}
                    />
                  )}
                </CardContent>
              </Card>
            </View>
          ) : (
            /* Registered Users Tab */
            <View className="mt-4 gap-4">
              <Text className="text-sm text-muted-foreground">
                View and manage accounts that have registered for the
                application.
              </Text>

              {/* User search */}
              <Card>
                <CardHeader>
                  <CardTitle>Look up a user</CardTitle>
                </CardHeader>
                <CardContent>
                  <SearchRow
                    accessibilityLabel="Look up a user"
                    value={userSearchEmail}
                    onChangeText={v => {
                      setUserSearchEmail(v);
                      setUserSearchResult(null);
                    }}
                    onSubmit={() => void handleUserSearch()}
                    searching={userSearching}
                  />
                  {userSearchResult === 'not_found' && (
                    <Text className="mt-2 text-sm text-muted-foreground">
                      No registered user found.
                    </Text>
                  )}
                  {userSearchResult && userSearchResult !== 'not_found' && (
                    <View className="mt-3 flex-row items-center justify-between rounded-lg border border-edge bg-ghost px-3 py-2">
                      <UserSummary
                        user={userSearchResult}
                        name={names?.get(userSearchResult.id)}
                      />
                      <View className="ml-4 shrink-0 flex-row items-center gap-3">
                        {userSearchResult.locked && <LockedBadge />}
                        <RoleButton
                          user={userSearchResult}
                          disabled={accountBusy}
                          onPress={role =>
                            roleDialog.show({ account: userSearchResult, role })
                          }
                        />
                        <RowIconButton
                          kind={userSearchResult.locked ? 'unlock' : 'lock'}
                          label={
                            userSearchResult.locked
                              ? 'Unlock user'
                              : 'Lock user'
                          }
                          disabled={accountBusy}
                          onPress={() => lockDialog.show(userSearchResult)}
                        />
                      </View>
                    </View>
                  )}
                </CardContent>
              </Card>

              {/* Registered Users list */}
              <Card>
                <CardHeader>
                  <View className="flex-row items-center justify-between">
                    <CardTitle>All registered users</CardTitle>
                    {usersData && (
                      <Text className="text-xs text-muted-foreground">
                        {usersData.total} total
                      </Text>
                    )}
                  </View>
                </CardHeader>
                <CardContent className="p-0">
                  {usersLoading ? (
                    <ListSpinner />
                  ) : !usersData?.items.length ? (
                    <Text className="py-10 text-center text-sm text-muted-foreground">
                      No registered users.
                    </Text>
                  ) : (
                    <View accessibilityRole="list">
                      {usersData.items.map((user, i) => (
                        <View
                          key={user.id}
                          className={cn(
                            'flex-row items-center justify-between px-5 py-3',
                            i > 0 && 'border-t border-border',
                          )}
                        >
                          <UserSummary user={user} name={names?.get(user.id)} />
                          <View className="ml-4 shrink-0 flex-row items-center gap-3">
                            {user.locked && <LockedBadge />}
                            <RoleButton
                              user={user}
                              disabled={accountBusy}
                              onPress={role =>
                                roleDialog.show({ account: user, role })
                              }
                            />
                            <RowIconButton
                              kind={user.locked ? 'unlock' : 'lock'}
                              label={user.locked ? 'Unlock user' : 'Lock user'}
                              disabled={accountBusy}
                              onPress={() => lockDialog.show(user)}
                            />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {usersTotalPages > 1 && (
                    <Pager
                      page={usersPage}
                      totalPages={usersTotalPages}
                      onPrev={() => setUsersPage(p => p - 1)}
                      onNext={() => setUsersPage(p => p + 1)}
                    />
                  )}
                </CardContent>
              </Card>
            </View>
          )}
        </View>
      </View>

      {/* Add email dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="border border-edge bg-card">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Add email to allowlist
            </DialogTitle>
          </DialogHeader>
          <Input
            placeholder="user@example.com"
            accessibilityLabel="Email to add"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            value={addEmail}
            onChangeText={setAddEmail}
            onSubmitEditing={submitAdd}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              className="border-edge"
              accessibilityLabel="Cancel"
              onPress={() => setAddOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="action"
              accessibilityLabel="Add"
              disabled={!addEmail.trim() || addMutation.isPending}
              onPress={() => addMutation.mutate(addEmail.trim())}
            >
              {addMutation.isPending ? 'Adding…' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteDialog.open}
        onCancel={() => deleteDialog.close()}
        title="Remove from allowlist?"
        description={
          <>
            <Text className="font-medium text-foreground">
              {deleteDialog.target?.email_hint}
            </Text>{' '}
            will no longer be able to register. Existing account is unaffected.
          </>
        }
        actionLabel="Remove"
        actionClassName="bg-error/90 text-white"
        actionDisabled={deleteMutation.isPending}
        onAction={() => {
          if (deleteDialog.target) deleteMutation.mutate(deleteDialog.target);
        }}
      />

      {/* Lock / unlock confirm */}
      <AlertDialog
        open={lockDialog.open}
        onCancel={() => lockDialog.close()}
        title={lockDialog.target?.locked ? 'Unlock user?' : 'Lock user?'}
        description={
          lockDialog.target?.locked ? (
            <>
              <Text className="font-medium text-foreground">
                {lockDialog.target.email}
              </Text>{' '}
              will be able to log in again.
            </>
          ) : (
            <>
              <Text className="font-medium text-foreground">
                {lockDialog.target?.email}
              </Text>{' '}
              will be immediately signed out and blocked from logging in.
            </>
          )
        }
        actionLabel={lockDialog.target?.locked ? 'Unlock' : 'Lock'}
        actionClassName={
          lockDialog.target?.locked ? 'bg-primary' : 'bg-error/90 text-white'
        }
        actionDisabled={lockMutation.isPending}
        onAction={() => {
          if (lockDialog.target) lockMutation.mutate(lockDialog.target);
        }}
      />

      {/* Role change confirm */}
      <AlertDialog
        open={roleDialog.open}
        onCancel={() => roleDialog.close()}
        title={
          roleDialog.target?.role === 'admin' ? 'Make admin?' : 'Make parent?'
        }
        description={
          <>
            <Text className="font-medium text-foreground">
              {roleDialog.target?.account.email}
            </Text>{' '}
            {roleDialog.target?.role === 'admin'
              ? 'will be able to manage the allowlist and every account.'
              : 'will no longer have admin access.'}{' '}
            They're signed out, and the new role applies when they sign in
            again.
          </>
        }
        actionLabel={
          roleDialog.target?.role === 'admin' ? 'Make admin' : 'Make parent'
        }
        actionClassName="bg-primary"
        actionDisabled={roleMutation.isPending}
        onAction={() => {
          if (roleDialog.target) roleMutation.mutate(roleDialog.target);
        }}
      />
    </PageScroll>
  );
}
