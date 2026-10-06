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
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { AdminUserRecord } from '@/types/api';
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

function errorDetail(err: unknown, fallback: string): string {
  return err instanceof ApiError
    ? typeof err.detail === 'string'
      ? err.detail
      : JSON.stringify(err.detail)
    : fallback;
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

function UserSummary({ user }: { user: AdminUserRecord }) {
  return (
    <View className="min-w-0 flex-1 gap-0.5">
      <Text numberOfLines={1} className="text-sm font-medium text-foreground">
        {user.full_name ?? '—'}
      </Text>
      <Text numberOfLines={1} className="text-xs text-muted-foreground">
        {user.email ?? '—'}
      </Text>
    </View>
  );
}

export default function Admin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<AdminTab>('allowed-emails');

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
  const [userSearchResult, setUserSearchResult] = useState<
    AdminUserRecord | null | 'not_found'
  >(null);
  const [userSearching, setUserSearching] = useState(false);

  const skip = page * PAGE_SIZE;
  const usersSkip = usersPage * PAGE_SIZE;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'allowed-emails', page],
    queryFn: () => api.admin.listAllowedEmails(skip, PAGE_SIZE),
  });

  const addMutation = useMutation({
    mutationFn: (email: string) => api.admin.addAllowedEmail(email),
    onSuccess: record => {
      toast.success(`${record.email} added to allowlist`);
      setAddOpen(false);
      setAddEmail('');
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: err => {
      toast.error(errorDetail(err, 'Failed to add email'));
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
    onError: err => {
      toast.error(errorDetail(err, 'Failed to remove email'));
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
    onSuccess: result => {
      toast.success(result.locked ? 'User locked' : 'User unlocked');
      setLockTarget(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setUserSearchResult(prev =>
        prev && prev !== 'not_found' && prev.id === result.id
          ? { ...prev, locked: result.locked }
          : prev,
      );
    },
    onError: err => {
      toast.error(errorDetail(err, 'Action failed'));
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
        toast.error(errorDetail(err, 'Search failed'));
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
        toast.error(errorDetail(err, 'Search failed'));
      }
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
                  Only these emails can register for the application.
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
                          {searchResult.email}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          Added {formatDate(searchResult.added_at)}
                        </Text>
                      </View>
                      <RowIconButton
                        kind="delete"
                        label={`Remove ${searchResult.email}`}
                        disabled={deleteMutation.isPending}
                        onPress={() => setDeleteTarget(searchResult.email)}
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
                          key={item.email}
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
                              {item.email}
                            </Text>
                          </View>
                          <View className="ml-4 shrink-0 flex-row items-center gap-3">
                            <RowIconButton
                              kind="delete"
                              label={`Remove ${item.email}`}
                              disabled={deleteMutation.isPending}
                              onPress={() => setDeleteTarget(item.email)}
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
                      <UserSummary user={userSearchResult} />
                      <View className="ml-4 shrink-0 flex-row items-center gap-3">
                        {userSearchResult.locked && <LockedBadge />}
                        <RowIconButton
                          kind={userSearchResult.locked ? 'unlock' : 'lock'}
                          label={
                            userSearchResult.locked
                              ? 'Unlock user'
                              : 'Lock user'
                          }
                          disabled={lockMutation.isPending}
                          onPress={() => setLockTarget(userSearchResult)}
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
                          <UserSummary user={user} />
                          <View className="ml-4 shrink-0 flex-row items-center gap-3">
                            {user.locked && <LockedBadge />}
                            <RowIconButton
                              kind={user.locked ? 'unlock' : 'lock'}
                              label={user.locked ? 'Unlock user' : 'Lock user'}
                              disabled={lockMutation.isPending}
                              onPress={() => setLockTarget(user)}
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
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        title="Remove from allowlist?"
        description={
          <>
            <Text className="font-medium text-foreground">{deleteTarget}</Text>{' '}
            will no longer be able to register. Existing account is unaffected.
          </>
        }
        actionLabel="Remove"
        actionClassName="bg-error/90 text-white"
        actionDisabled={deleteMutation.isPending}
        onAction={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
      />

      {/* Lock / unlock confirm */}
      <AlertDialog
        open={!!lockTarget}
        onCancel={() => setLockTarget(null)}
        title={lockTarget?.locked ? 'Unlock user?' : 'Lock user?'}
        description={
          lockTarget?.locked ? (
            <>
              <Text className="font-medium text-foreground">
                {lockTarget.email}
              </Text>{' '}
              will be able to log in again.
            </>
          ) : (
            <>
              <Text className="font-medium text-foreground">
                {lockTarget?.email}
              </Text>{' '}
              will be immediately signed out and blocked from logging in.
            </>
          )
        }
        actionLabel={lockTarget?.locked ? 'Unlock' : 'Lock'}
        actionClassName={
          lockTarget?.locked ? 'bg-primary' : 'bg-error/90 text-white'
        }
        actionDisabled={lockMutation.isPending}
        onAction={() => {
          if (lockTarget) lockMutation.mutate(lockTarget);
        }}
      />
    </PageScroll>
  );
}
