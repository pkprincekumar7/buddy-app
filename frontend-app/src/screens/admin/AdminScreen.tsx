import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Shield,
  Mail,
  Users,
  Search,
  Plus,
  Trash2,
  Lock,
  LockOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { AdminUserRecord, AllowedEmailRecord } from '@/types/api';
import { useTheme } from '@/lib/ThemeContext';
import { useAuth } from '@/lib/AuthContext';
import { toast } from '@/lib/toast';

const PAGE_SIZE = 20;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function AdminScreen() {
  const { colors } = useTheme();
  useAuth();
  const qc = useQueryClient();

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'emails' | 'users'>('emails');

  // ── Allowed Emails state ───────────────────────────────────────────────────
  const [emailPage, setEmailPage] = useState(0);
  const [emailSearch, setEmailSearch] = useState('');
  const [emailSearchResult, setEmailSearchResult] = useState<
    AllowedEmailRecord | null | 'not_found'
  >(null);
  const [emailSearching, setEmailSearching] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');

  // ── Registered Users state ─────────────────────────────────────────────────
  const [usersPage, setUsersPage] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [userSearchResult, setUserSearchResult] = useState<
    AdminUserRecord | null | 'not_found'
  >(null);
  const [userSearching, setUserSearching] = useState(false);

  const emailSkip = emailPage * PAGE_SIZE;
  const usersSkip = usersPage * PAGE_SIZE;

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: emailsData, isLoading: emailsLoading } = useQuery({
    queryKey: ['admin', 'allowed-emails', emailPage],
    queryFn: () => api.admin.listAllowedEmails(emailSkip, PAGE_SIZE),
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', usersPage],
    queryFn: () => api.admin.listUsers(usersSkip, PAGE_SIZE),
  });

  const emailTotalPages = emailsData
    ? Math.ceil(emailsData.total / PAGE_SIZE)
    : 0;
  const usersTotalPages = usersData
    ? Math.ceil(usersData.total / PAGE_SIZE)
    : 0;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (email: string) => api.admin.addAllowedEmail(email),
    onSuccess: record => {
      toast.success(`${record.email} added to allowlist`);
      setAddModalOpen(false);
      setAddEmail('');
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: err => {
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
      setEmailPage(0);
      setEmailSearchResult(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'allowed-emails'] });
    },
    onError: err => {
      const msg =
        err instanceof ApiError
          ? typeof err.detail === 'string'
            ? err.detail
            : JSON.stringify(err.detail)
          : 'Failed to remove email';
      toast.error(msg);
    },
  });

  const lockMutation = useMutation({
    mutationFn: (u: AdminUserRecord) =>
      u.locked
        ? api.admin.unlockUser(u.id, u.location ?? '')
        : api.admin.lockUser(u.id, u.location ?? ''),
    onSuccess: result => {
      toast.success(result.locked ? 'User locked' : 'User unlocked');
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setUserSearchResult(prev =>
        prev && prev !== 'not_found' && prev.id === result.id
          ? { ...prev, locked: result.locked }
          : prev,
      );
    },
    onError: err => {
      const msg =
        err instanceof ApiError
          ? typeof err.detail === 'string'
            ? err.detail
            : JSON.stringify(err.detail)
          : 'Action failed';
      toast.error(msg);
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleEmailSearch = async () => {
    const trimmed = emailSearch.trim();
    if (!trimmed) return;
    setEmailSearching(true);
    setEmailSearchResult(null);
    try {
      const result = await api.admin.getAllowedEmail(trimmed);
      setEmailSearchResult(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setEmailSearchResult('not_found');
      } else {
        toast.error('Search failed');
      }
    } finally {
      setEmailSearching(false);
    }
  };

  const handleUserSearch = async () => {
    const trimmed = userSearch.trim();
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
        toast.error('Search failed');
      }
    } finally {
      setUserSearching(false);
    }
  };

  const confirmDelete = (email: string) => {
    Alert.alert(
      'Remove from allowlist?',
      `${email} will no longer be able to register.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(email),
        },
      ],
    );
  };

  const confirmLock = (u: AdminUserRecord) => {
    const action = u.locked ? 'Unlock' : 'Lock';
    const message = u.locked
      ? `${u.email} will be able to log in again.`
      : `${u.email} will be immediately signed out and blocked from logging in.`;
    Alert.alert(`${action} user?`, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: u.locked ? 'default' : 'destructive',
        onPress: () => lockMutation.mutate(u),
      },
    ]);
  };

  // ── Shared styles ──────────────────────────────────────────────────────────
  const cardStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    marginBottom: 12,
  };

  const searchInputStyle = {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surfaceElevated,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  };

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderEmailRow = ({ item }: { item: AllowedEmailRecord }) => (
    <View
      className="flex-row items-center justify-between px-5 py-3"
      style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <View className="flex-row items-center gap-2 flex-1 min-w-0">
        <Mail size={16} color={colors.primary} />
        <Text
          className="text-sm flex-1"
          style={{ color: colors.text }}
          numberOfLines={1}
        >
          {item.email}
        </Text>
      </View>
      <View className="flex-row items-center gap-3 ml-3">
        <Text className="text-xs" style={{ color: colors.textMuted }}>
          {formatDate(item.added_at)}
        </Text>
        <TouchableOpacity
          onPress={() => confirmDelete(item.email)}
          disabled={deleteMutation.isPending}
          style={{ padding: 4 }}
        >
          <Trash2 size={14} color={colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderUserRow = ({ item }: { item: AdminUserRecord }) => (
    <View
      className="flex-row items-center justify-between px-5 py-3"
      style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <View className="flex-1 min-w-0">
        <Text
          className="text-sm font-semibold"
          style={{ color: colors.text }}
          numberOfLines={1}
        >
          {item.full_name ?? '—'}
        </Text>
        <Text
          className="text-xs mt-0.5"
          style={{ color: colors.textMuted }}
          numberOfLines={1}
        >
          {item.email ?? '—'}
        </Text>
      </View>
      <View className="flex-row items-center gap-2 ml-3">
        {item.locked && (
          <View
            style={{
              backgroundColor: colors.errorMuted + '1a',
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text
              className="text-xs font-medium"
              style={{ color: colors.error }}
            >
              Locked
            </Text>
          </View>
        )}
        <Text className="text-xs" style={{ color: colors.textMuted }}>
          {formatDate(item.created_at)}
        </Text>
        <TouchableOpacity
          onPress={() => confirmLock(item)}
          disabled={lockMutation.isPending}
          style={{ padding: 4 }}
        >
          {item.locked ? (
            <LockOpen size={14} color={colors.textMuted} />
          ) : (
            <Lock size={14} color={colors.error} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const Spinner = () => (
    <View className="items-center justify-center py-10">
      <ActivityIndicator color={colors.primary} />
    </View>
  );

  const Pagination = ({
    page,
    total,
    onPrev,
    onNext,
  }: {
    page: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  }) =>
    total <= 1 ? null : (
      <View
        className="flex-row items-center justify-between px-5 py-3"
        style={{ borderTopWidth: 1, borderTopColor: colors.border }}
      >
        <TouchableOpacity
          onPress={onPrev}
          disabled={page === 0}
          className="flex-row items-center gap-1"
        >
          <ChevronLeft
            size={16}
            color={page === 0 ? colors.border : colors.textMuted}
          />
          <Text
            className="text-sm"
            style={{ color: page === 0 ? colors.border : colors.textMuted }}
          >
            Previous
          </Text>
        </TouchableOpacity>
        <Text className="text-xs" style={{ color: colors.textMuted }}>
          Page {page + 1} of {total}
        </Text>
        <TouchableOpacity
          onPress={onNext}
          disabled={page >= total - 1}
          className="flex-row items-center gap-1"
        >
          <Text
            className="text-sm"
            style={{
              color: page >= total - 1 ? colors.border : colors.textMuted,
            }}
          >
            Next
          </Text>
          <ChevronRight
            size={16}
            color={page >= total - 1 ? colors.border : colors.textMuted}
          />
        </TouchableOpacity>
      </View>
    );

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View className="flex-row items-center gap-3 mb-5">
        <View
          className="h-10 w-10 rounded-xl items-center justify-center"
          style={{ backgroundColor: colors.primarySubtle }}
        >
          <Shield size={20} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text
            className="text-xl font-semibold"
            style={{ color: colors.text }}
          >
            Admin
          </Text>
          <Text className="text-sm" style={{ color: colors.textMuted }}>
            Manage allowed emails and registered users.
          </Text>
        </View>
      </View>

      {/* Tab switcher */}
      <View
        className="flex-row rounded-xl p-1 mb-4"
        style={{ backgroundColor: colors.muted }}
      >
        <TouchableOpacity
          className="flex-1 flex-row items-center justify-center gap-2 rounded-lg py-2"
          style={
            activeTab === 'emails'
              ? { backgroundColor: colors.card }
              : undefined
          }
          onPress={() => setActiveTab('emails')}
        >
          <Mail
            size={15}
            color={activeTab === 'emails' ? colors.text : colors.textMuted}
          />
          <Text
            className="text-sm font-medium"
            style={{
              color: activeTab === 'emails' ? colors.text : colors.textMuted,
            }}
          >
            Allowed Emails
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 flex-row items-center justify-center gap-2 rounded-lg py-2"
          style={
            activeTab === 'users' ? { backgroundColor: colors.card } : undefined
          }
          onPress={() => setActiveTab('users')}
        >
          <Users
            size={15}
            color={activeTab === 'users' ? colors.text : colors.textMuted}
          />
          <Text
            className="text-sm font-medium"
            style={{
              color: activeTab === 'users' ? colors.text : colors.textMuted,
            }}
          >
            Registered Users
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Allowed Emails tab ──────────────────────────────────────────────── */}
      {activeTab === 'emails' && (
        <View>
          {/* Sub-header */}
          <View className="flex-row items-center justify-between mb-3">
            <Text
              className="text-sm flex-1 mr-3"
              style={{ color: colors.textMuted }}
            >
              Only these emails can register for the application.
            </Text>
            <TouchableOpacity
              className="flex-row items-center gap-1.5 rounded-lg px-3 py-2"
              style={{ backgroundColor: colors.primaryAction }}
              onPress={() => setAddModalOpen(true)}
            >
              <Plus size={14} color={colors.primaryForeground} />
              <Text
                className="text-sm font-medium"
                style={{ color: colors.primaryForeground }}
              >
                Add email
              </Text>
            </TouchableOpacity>
          </View>

          {/* Email search card */}
          <View style={cardStyle}>
            <View className="px-4 pt-4 pb-3">
              <Text
                className="text-sm font-medium mb-3"
                style={{ color: colors.text }}
              >
                Look up an email
              </Text>
              <View className="flex-row gap-2">
                <TextInput
                  style={searchInputStyle}
                  placeholder="user@example.com"
                  placeholderTextColor={colors.textMuted}
                  value={emailSearch}
                  onChangeText={v => {
                    setEmailSearch(v);
                    setEmailSearchResult(null);
                  }}
                  onSubmitEditing={() => void handleEmailSearch()}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TouchableOpacity
                  className="items-center justify-center rounded-lg border px-3"
                  style={{
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                  }}
                  onPress={() => void handleEmailSearch()}
                  disabled={emailSearching || !emailSearch.trim()}
                >
                  {emailSearching ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Search size={16} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </View>

              {emailSearchResult === 'not_found' && (
                <Text
                  className="mt-2 text-sm"
                  style={{ color: colors.textMuted }}
                >
                  Not found in allowlist.
                </Text>
              )}
              {emailSearchResult && emailSearchResult !== 'not_found' && (
                <View
                  className="flex-row items-center justify-between mt-3 rounded-lg px-3 py-2"
                  style={{
                    backgroundColor: colors.ghostStrong,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View className="flex-row items-center gap-2 flex-1 min-w-0">
                    <Mail size={14} color={colors.primary} />
                    <Text
                      className="text-sm flex-1"
                      style={{ color: colors.text }}
                      numberOfLines={1}
                    >
                      {emailSearchResult.email}
                    </Text>
                    <Text
                      className="text-xs"
                      style={{ color: colors.textMuted }}
                    >
                      Added {formatDate(emailSearchResult.added_at)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => confirmDelete(emailSearchResult.email)}
                    disabled={deleteMutation.isPending}
                    style={{ marginLeft: 8, padding: 4 }}
                  >
                    <Trash2 size={14} color={colors.error} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* Email list card */}
          <View style={cardStyle}>
            <View className="flex-row items-center justify-between px-5 py-3">
              <Text
                className="text-sm font-medium"
                style={{ color: colors.text }}
              >
                All allowed emails
              </Text>
              {emailsData && (
                <Text className="text-xs" style={{ color: colors.textMuted }}>
                  {emailsData.total} total
                </Text>
              )}
            </View>
            {emailsLoading ? (
              <Spinner />
            ) : !emailsData?.items.length ? (
              <Text
                className="text-sm text-center py-10"
                style={{ color: colors.textMuted }}
              >
                No emails in allowlist yet.
              </Text>
            ) : (
              <FlatList
                data={emailsData.items}
                keyExtractor={item => item.email}
                renderItem={renderEmailRow}
                scrollEnabled={false}
              />
            )}
            <Pagination
              page={emailPage}
              total={emailTotalPages}
              onPrev={() => setEmailPage(p => p - 1)}
              onNext={() => setEmailPage(p => p + 1)}
            />
          </View>
        </View>
      )}

      {/* ── Registered Users tab ────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <View>
          <Text className="text-sm mb-3" style={{ color: colors.textMuted }}>
            View and manage accounts that have registered for the application.
          </Text>

          {/* User search card */}
          <View style={cardStyle}>
            <View className="px-4 pt-4 pb-3">
              <Text
                className="text-sm font-medium mb-3"
                style={{ color: colors.text }}
              >
                Look up a user
              </Text>
              <View className="flex-row gap-2">
                <TextInput
                  style={searchInputStyle}
                  placeholder="user@example.com"
                  placeholderTextColor={colors.textMuted}
                  value={userSearch}
                  onChangeText={v => {
                    setUserSearch(v);
                    setUserSearchResult(null);
                  }}
                  onSubmitEditing={() => void handleUserSearch()}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TouchableOpacity
                  className="items-center justify-center rounded-lg border px-3"
                  style={{
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                  }}
                  onPress={() => void handleUserSearch()}
                  disabled={userSearching || !userSearch.trim()}
                >
                  {userSearching ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Search size={16} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </View>

              {userSearchResult === 'not_found' && (
                <Text
                  className="mt-2 text-sm"
                  style={{ color: colors.textMuted }}
                >
                  No registered user found.
                </Text>
              )}
              {userSearchResult && userSearchResult !== 'not_found' && (
                <View
                  className="flex-row items-center justify-between mt-3 rounded-lg px-3 py-2"
                  style={{
                    backgroundColor: colors.ghostStrong,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View className="flex-1 min-w-0">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: colors.text }}
                      numberOfLines={1}
                    >
                      {userSearchResult.full_name ?? '—'}
                    </Text>
                    <Text
                      className="text-xs mt-0.5"
                      style={{ color: colors.textMuted }}
                      numberOfLines={1}
                    >
                      {userSearchResult.email ?? '—'}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2 ml-3">
                    {userSearchResult.locked && (
                      <View
                        style={{
                          backgroundColor: colors.errorMuted + '1a',
                          borderRadius: 999,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                        }}
                      >
                        <Text
                          className="text-xs font-medium"
                          style={{ color: colors.error }}
                        >
                          Locked
                        </Text>
                      </View>
                    )}
                    <TouchableOpacity
                      onPress={() => confirmLock(userSearchResult)}
                      disabled={lockMutation.isPending}
                      style={{ padding: 4 }}
                    >
                      {userSearchResult.locked ? (
                        <LockOpen size={14} color={colors.textMuted} />
                      ) : (
                        <Lock size={14} color={colors.error} />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Users list card */}
          <View style={cardStyle}>
            <View className="flex-row items-center justify-between px-5 py-3">
              <Text
                className="text-sm font-medium"
                style={{ color: colors.text }}
              >
                All registered users
              </Text>
              {usersData && (
                <Text className="text-xs" style={{ color: colors.textMuted }}>
                  {usersData.total} total
                </Text>
              )}
            </View>
            {usersLoading ? (
              <Spinner />
            ) : !usersData?.items.length ? (
              <Text
                className="text-sm text-center py-10"
                style={{ color: colors.textMuted }}
              >
                No registered users.
              </Text>
            ) : (
              <FlatList
                data={usersData.items}
                keyExtractor={item => item.id}
                renderItem={renderUserRow}
                scrollEnabled={false}
              />
            )}
            <Pagination
              page={usersPage}
              total={usersTotalPages}
              onPrev={() => setUsersPage(p => p - 1)}
              onNext={() => setUsersPage(p => p + 1)}
            />
          </View>
        </View>
      )}

      {/* ── Add email modal ─────────────────────────────────────────────────── */}
      <Modal visible={addModalOpen} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: colors.overlayBackground }}
        >
          <View
            className="w-full max-w-sm mx-5 rounded-2xl p-6"
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              className="text-base font-semibold mb-4"
              style={{ color: colors.text }}
            >
              Add email to allowlist
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: colors.inputBorder,
                backgroundColor: colors.surfaceElevated,
                color: colors.text,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontSize: 14,
                marginBottom: 16,
              }}
              placeholder="user@example.com"
              placeholderTextColor={colors.textMuted}
              value={addEmail}
              onChangeText={setAddEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoFocus
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 items-center justify-center rounded-lg border py-2.5"
                style={{ borderColor: colors.border }}
                onPress={() => {
                  setAddModalOpen(false);
                  setAddEmail('');
                }}
              >
                <Text
                  className="text-sm font-medium"
                  style={{ color: colors.text }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 items-center justify-center rounded-lg py-2.5"
                style={{
                  backgroundColor:
                    !addEmail.trim() || addMutation.isPending
                      ? colors.primaryAction + '80'
                      : colors.primaryAction,
                }}
                disabled={!addEmail.trim() || addMutation.isPending}
                onPress={() => addMutation.mutate(addEmail.trim())}
              >
                {addMutation.isPending ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primaryForeground}
                  />
                ) : (
                  <Text
                    className="text-sm font-medium"
                    style={{ color: colors.primaryForeground }}
                  >
                    Add
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}
