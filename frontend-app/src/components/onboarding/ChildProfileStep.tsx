import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated, { Easing, Keyframe, ZoomIn } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Check, Upload } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/shared/Spinner';
import { cn } from '@/lib/utils';
import { color, css, glow, hsl, rgb } from '@/theme';
import { ALL_AVATARS, BOY_AVATARS, GIRL_AVATARS } from './avatars';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChildFormData {
  name: string;
  age: string;
  gender: 'Male' | 'Female' | 'Other' | '';
  school: string;
  avatarId?: string;
  avatarUrl?: string;
}

/** RN stand-in for the web's `File`: a local image picked with expo-image-picker. */
export interface ChildPhoto {
  uri: string;
  mimeType: string;
}

interface Props {
  onContinue: (data: ChildFormData, photo?: ChildPhoto) => void | Promise<void>;
  initialData?: Partial<ChildFormData>;
  isLoading?: boolean;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateX: 48 }] },
  100: {
    opacity: 1,
    transform: [{ translateX: 0 }],
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  },
})
  .duration(450)
  // Web AnimatePresence mode="wait": waits for the Welcome step's 0.3s exit first.
  .delay(300);
const EXIT = new Keyframe({
  0: { opacity: 1, transform: [{ translateX: 0 }] },
  100: {
    opacity: 0,
    transform: [{ translateX: -48 }],
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  },
}).duration(450);

/** Web `focus:ring-1 ring-primary/40`. */
const FOCUS_RING = { boxShadow: css('0 0 0 1px hsl(var(--primary) / 0.4)') };
/** Web `ring-1 ring-primary/30` on the selected avatar tile. */
const SELECTED_RING = { boxShadow: css('0 0 0 1px hsl(var(--primary) / 0.3)') };
const CTA_STYLE = { boxShadow: glow.tealBtn };
const EYEBROW_STYLE = { letterSpacing: 11 * 0.16 };
/** tracking-wider (0.05em) at 10px / 9px. */
const WIDER_10 = { letterSpacing: 10 * 0.05 };
const WIDER_9 = { letterSpacing: 9 * 0.05 };
const PLACEHOLDER = hsl('muted-foreground', 0.4);
/** Web `text-white` on the selected-avatar check badge. */
const CHECK_ICON = rgb('white');
const NO_TRACKING = { letterSpacing: 0 };

// ── Field input ───────────────────────────────────────────────────────────────

function FieldInput({
  hasError,
  ...props
}: TextInputProps & { hasError?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={PLACEHOLDER}
      selectionColor={color.primary}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        'w-full rounded-xl border bg-surface-input px-4 py-2.5 text-sm text-foreground',
        hasError ? 'border-error/50' : 'border-edge-md',
      )}
      style={focused ? FOCUS_RING : undefined}
      {...props}
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      className="text-[10px] font-semibold uppercase text-muted-foreground"
      style={WIDER_10}
    >
      {children}
    </Text>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChildProfileStep({
  onContinue,
  initialData,
  isLoading,
}: Props) {
  const [form, setForm] = useState<ChildFormData>({
    name: initialData?.name ?? '',
    age: initialData?.age ?? '',
    gender: initialData?.gender ?? '',
    school: initialData?.school ?? '',
    avatarId: initialData?.avatarUrl ? '' : initialData?.avatarId ?? '',
  });
  const [avatarTab, setAvatarTab] = useState<'boy' | 'girl'>(
    GIRL_AVATARS.some(a => a.id === initialData?.avatarId) ? 'girl' : 'boy',
  );
  const [errors, setErrors] = useState<
    Partial<Record<keyof ChildFormData, string>>
  >({});
  const [photoFile, setPhotoFile] = useState<ChildPhoto | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    initialData?.avatarUrl ?? null,
  );
  const prefillApplied = useRef(false);

  // Sync initialData into form when it arrives after mount (async prefill)
  useEffect(() => {
    if (!initialData || Object.keys(initialData).length === 0) return;
    if (prefillApplied.current) return;
    prefillApplied.current = true;
    // Photo takes precedence: if avatarUrl is set, suppress avatarId so only one is active.
    const effectiveAvatarId = initialData.avatarUrl
      ? ''
      : initialData.avatarId ?? '';
    setForm({
      name: initialData.name ?? '',
      age: initialData.age ?? '',
      gender: initialData.gender ?? '',
      school: initialData.school ?? '',
      avatarId: effectiveAvatarId,
    });
    if (effectiveAvatarId) {
      setAvatarTab(
        GIRL_AVATARS.some(a => a.id === effectiveAvatarId) ? 'girl' : 'boy',
      );
    }
    if (initialData.avatarUrl) {
      setPhotoPreview(initialData.avatarUrl);
    }
  }, [initialData]);

  const applyPickedAsset = (result: ImagePicker.ImagePickerResult) => {
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setPhotoFile({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
    setPhotoPreview(asset.uri);
    // Clear emoji avatar selection when a photo is chosen
    setForm(f => ({ ...f, avatarId: '' }));
  };

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Photo library access is required to upload a profile photo.',
      );
      return;
    }
    applyPickedAsset(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      }),
    );
  };

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Camera access is required to take a profile photo.',
      );
      return;
    }
    applyPickedAsset(
      await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      }),
    );
  };

  // Web: fileRef.current?.click() — the OS file chooser offers camera or library.
  const openPhotoPicker = () => {
    Alert.alert('Add Photo', undefined, [
      { text: 'Take Photo', onPress: () => void pickFromCamera() },
      { text: 'Choose from Library', onPress: () => void pickFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const avatars = avatarTab === 'boy' ? BOY_AVATARS : GIRL_AVATARS;
  const selected = ALL_AVATARS.find(a => a.id === form.avatarId);

  const validate = (): boolean => {
    const e: Partial<Record<keyof ChildFormData, string>> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    const ageNum = Number(form.age);
    if (!form.age.trim()) e.age = 'Age is required';
    else if (isNaN(ageNum) || ageNum < 8 || ageNum > 30)
      e.age = 'Age must be between 8 and 30';
    if (!form.gender) e.gender = 'Please select a gender';
    if (!form.avatarId && !photoFile && !initialData?.avatarUrl)
      e.avatarId = 'Please upload a photo or pick an avatar';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleContinue = () => {
    if (!validate()) return;
    void onContinue(form, photoFile ?? undefined);
  };

  const setField = <K extends keyof ChildFormData>(
    key: K,
    val: ChildFormData[K],
  ) => {
    setForm(f => ({ ...f, [key]: val }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  return (
    <Animated.View
      entering={ENTER}
      exiting={EXIT}
      className="w-full max-w-lg self-center"
    >
      <View className="gap-6 rounded-2xl border border-edge bg-card p-6">
        {/* Header */}
        <View className="gap-1">
          <Text
            className="text-center text-[11px] font-semibold uppercase text-primary"
            style={EYEBROW_STYLE}
          >
            {"Let's start with the basics"}
          </Text>
          <Text
            accessibilityRole="header"
            className="text-center text-2xl font-bold text-foreground"
          >
            Tell us about your child
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            A photo or fun avatar makes the journey feel personal. Just a few
            quick fields.
          </Text>
        </View>

        {/* Avatar preview circle */}
        <View className="items-center gap-3">
          <Pressable
            onPress={openPhotoPicker}
            accessibilityRole="button"
            accessibilityLabel={
              photoPreview ? 'Change profile photo' : 'Add photo'
            }
            className={cn(
              'h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-dashed bg-surface-elevated',
              'border-primary/40 active:border-primary/70',
            )}
          >
            {photoPreview ? (
              <Image
                source={{ uri: photoPreview }}
                accessibilityLabel="Profile photo"
                className="h-full w-full"
                resizeMode="cover"
              />
            ) : selected ? (
              <View
                className={cn(
                  'h-full w-full items-center justify-center',
                  selected.bg,
                )}
              >
                {selected.emoji}
              </View>
            ) : (
              <View pointerEvents="none" className="items-center gap-0.5">
                <Camera size={24} color={color.primary} />
                <Text
                  className="mt-0.5 text-[9px] font-semibold uppercase text-muted-foreground"
                  style={WIDER_9}
                >
                  Add Photo
                </Text>
                <Text className="text-[8px] text-muted-foreground/50">
                  or pick an avatar
                </Text>
              </View>
            )}
          </Pressable>
          <Button
            variant="outline"
            size="sm"
            onPress={openPhotoPicker}
            accessibilityLabel="Upload photo"
            className="gap-1.5 rounded-full border-edge-strong px-4 text-xs"
          >
            <Upload size={12} color={color.foreground} />
            <Text className="text-xs font-medium text-foreground">
              Upload photo
            </Text>
          </Button>
        </View>

        {/* Avatar picker */}
        <View className="gap-3 rounded-xl border border-edge-faint bg-surface-elevated/40 p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-base">🎭</Text>
              <Text
                className="text-[10px] font-semibold uppercase text-muted-foreground/70"
                style={WIDER_10}
              >
                Or pick an avatar
              </Text>
            </View>
            <View className="flex-row overflow-hidden rounded-lg border border-edge-md">
              {(['boy', 'girl'] as const).map(g => (
                <Pressable
                  key={g}
                  onPress={() => setAvatarTab(g)}
                  accessibilityRole="tab"
                  accessibilityLabel={`${g} avatars`}
                  accessibilityState={{ selected: avatarTab === g }}
                  className={cn('px-3 py-1', avatarTab === g && 'bg-primary')}
                >
                  {({ pressed }) => (
                    <Text
                      className={cn(
                        'text-[10px] font-bold uppercase',
                        avatarTab === g
                          ? 'text-primary-foreground'
                          : pressed
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                      )}
                      style={WIDER_10}
                    >
                      {g}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          </View>

          <View className="flex-row gap-3">
            {avatars.map(av => {
              const isSelected = form.avatarId === av.id;
              return (
                <Pressable
                  key={av.id}
                  onPress={() => {
                    setField('avatarId', av.id);
                    setPhotoFile(null);
                    setPhotoPreview(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${av.label} avatar`}
                  accessibilityState={{ selected: isSelected }}
                  className={cn(
                    'flex-1 items-center gap-2 rounded-xl border p-3',
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : 'border-edge bg-surface-elevated',
                  )}
                  style={({ pressed }) => [
                    isSelected ? SELECTED_RING : null,
                    pressed ? { transform: [{ scale: 0.94 }] } : null,
                  ]}
                >
                  <View
                    className={cn(
                      'relative h-14 w-14 items-center justify-center rounded-full',
                      av.bg,
                    )}
                  >
                    {av.emoji}
                    {isSelected && (
                      <Animated.View
                        entering={ZoomIn}
                        className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full bg-primary shadow-md"
                      >
                        <Check size={12} color={CHECK_ICON} />
                      </Animated.View>
                    )}
                  </View>
                  <Text className="text-xs font-medium text-foreground">
                    {av.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {errors.avatarId && (
          <Text className="-mt-2 text-center text-xs text-destructive">
            {errors.avatarId}
          </Text>
        )}

        {/* Divider */}
        <View className="flex-row items-center gap-3">
          <View className="h-px flex-1 bg-ghost-light" />
          <Text
            className="text-[10px] font-semibold uppercase text-muted-foreground/50"
            style={WIDER_10}
          >
            About your child
          </Text>
          <View className="h-px flex-1 bg-ghost-light" />
        </View>

        {/* Form fields */}
        <View className="gap-4">
          {/* Name + Age */}
          <View className="flex-row gap-4">
            <View className="flex-1 gap-1.5">
              <FieldLabel>
                {"Child's Name "}
                <Text className="text-primary">*</Text>
              </FieldLabel>
              <FieldInput
                value={form.name}
                onChangeText={v => setField('name', v)}
                placeholder="Arjun"
                accessibilityLabel="Child's name"
                autoCapitalize="words"
                hasError={!!errors.name}
              />
              {errors.name && (
                <Text className="text-[10px] text-error">{errors.name}</Text>
              )}
            </View>

            <View className="flex-1 gap-1.5">
              <FieldLabel>
                {'Age '}
                <Text className="text-primary">*</Text>
              </FieldLabel>
              <FieldInput
                value={form.age}
                onChangeText={v => setField('age', v)}
                placeholder="8"
                keyboardType="number-pad"
                accessibilityLabel="Age"
                hasError={!!errors.age}
              />
              {errors.age && (
                <Text className="text-[10px] text-error">{errors.age}</Text>
              )}
            </View>
          </View>

          {/* Gender */}
          <View className="gap-1.5">
            <FieldLabel>
              {'Gender '}
              <Text className="text-primary">*</Text>
            </FieldLabel>
            <View className="flex-row gap-2">
              {(['Male', 'Female', 'Other'] as const).map(g => {
                const active = form.gender === g;
                return (
                  <Pressable
                    key={g}
                    onPress={() => setField('gender', g)}
                    accessibilityRole="radio"
                    accessibilityLabel={g}
                    accessibilityState={{ selected: active }}
                    className={cn(
                      'flex-1 items-center rounded-xl border py-2.5',
                      active
                        ? 'border-primary bg-primary/15'
                        : 'border-edge-md active:border-primary/30',
                    )}
                  >
                    {({ pressed }) => (
                      <Text
                        className={cn(
                          'text-sm font-medium',
                          active
                            ? 'text-primary'
                            : pressed
                            ? 'text-foreground'
                            : 'text-muted-foreground',
                        )}
                      >
                        {g}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
            {errors.gender && (
              <Text className="text-[10px] text-error">{errors.gender}</Text>
            )}
          </View>

          {/* School */}
          <View className="gap-1.5">
            <FieldLabel>
              {'School '}
              <Text
                className="text-[10px] font-normal normal-case text-muted-foreground/40"
                style={NO_TRACKING}
              >
                (optional)
              </Text>
            </FieldLabel>
            <FieldInput
              value={form.school}
              onChangeText={v => setField('school', v)}
              placeholder="Greenfield International"
              accessibilityLabel="School (optional)"
            />
          </View>
        </View>

        {/* Footer */}
        <View className="flex-row items-center justify-between pt-1">
          <Text className="text-xs text-muted-foreground/40">* Required</Text>
          <Button
            onPress={handleContinue}
            disabled={isLoading}
            accessibilityLabel={isLoading ? 'Saving' : 'Continue'}
            className="h-11 gap-2 rounded-full bg-primary px-8 font-semibold text-primary-foreground"
            style={CTA_STYLE}
          >
            {isLoading ? (
              <View className="flex-row items-center gap-2">
                <Spinner
                  durationSeconds={1}
                  className="h-3.5 w-3.5 border-2 border-white/30 border-t-white"
                />
                <Text className="text-sm font-semibold text-primary-foreground">
                  Saving…
                </Text>
              </View>
            ) : (
              'Continue →'
            )}
          </Button>
        </View>
      </View>
    </Animated.View>
  );
}
