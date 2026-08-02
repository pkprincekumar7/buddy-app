import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
  TouchableOpacity,
  View,
  Text,
} from 'react-native';
import Svg, {
  Circle as SvgCircle,
  Path as SvgPath,
  Rect as SvgRect,
  Ellipse as SvgEllipse,
} from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Upload } from 'lucide-react-native';
import { useTheme } from '@/lib/ThemeContext';
import { Button } from '@/components/ui/Button';

// ── Avatar colour constants (match web's CSS variable values exactly) ─────────

const SKIN = '#fddcb5';
const DARK = '#2c2c2c';
const DARKER = '#1a1a1a';
const DARKEST = '#111111';
const GLASSES = '#222222';
const PUPIL = '#333333';
const HAIR_DARK = '#8b4513';
const HAIR_MID = '#c8854a';
const PINK = '#ff85b3';
const PINK_DEEP = '#e0449a';

// ── Inline SVG avatar illustrations (ported from web ChildProfileStep.tsx) ───

const CapperSVG = () => (
  <Svg viewBox="0 0 60 70" width={56} height={56}>
    <SvgCircle cx="30" cy="41" r="19" fill={SKIN} />
    <SvgPath d="M10 30 Q10 11 30 11 Q50 11 50 30 Z" fill={DARKER} />
    <SvgRect x="4" y="27" width="52" height="7" rx="3.5" fill={DARKEST} />
    <SvgCircle cx="23" cy="40" r="2.5" fill={DARK} />
    <SvgCircle cx="37" cy="40" r="2.5" fill={DARK} />
    <SvgPath
      d="M23 48 Q30 54 37 48"
      stroke={DARK}
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </Svg>
);

const CurlySVG = () => (
  <Svg viewBox="0 0 60 70" width={56} height={56}>
    <SvgCircle cx="30" cy="40" r="19" fill={SKIN} />
    <SvgPath
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={HAIR_DARK}
    />
    <SvgCircle cx="23" cy="39" r="2.5" fill={DARK} />
    <SvgCircle cx="37" cy="39" r="2.5" fill={DARK} />
    <SvgPath
      d="M23 47 Q30 53 37 47"
      stroke={DARK}
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </Svg>
);

const SpecsSVG = () => (
  <Svg viewBox="0 0 60 70" width={56} height={56}>
    <SvgCircle cx="30" cy="40" r="19" fill={SKIN} />
    <SvgPath d="M11 36 Q11 15 30 15 Q49 15 49 36" fill={DARKER} />
    <SvgCircle
      cx="22"
      cy="40"
      r="7"
      fill="none"
      stroke={GLASSES}
      strokeWidth="2.5"
    />
    <SvgCircle
      cx="38"
      cy="40"
      r="7"
      fill="none"
      stroke={GLASSES}
      strokeWidth="2.5"
    />
    <SvgPath
      d="M29 40 L31 40"
      stroke={GLASSES}
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <SvgPath
      d="M9 39 L15 39"
      stroke={GLASSES}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <SvgPath
      d="M45 39 L51 39"
      stroke={GLASSES}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <SvgCircle cx="22" cy="41" r="1.5" fill={PUPIL} />
    <SvgCircle cx="38" cy="41" r="1.5" fill={PUPIL} />
    <SvgPath
      d="M24 49 Q30 54 36 49"
      stroke={DARK}
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </Svg>
);

const BraidSVG = () => (
  <Svg viewBox="0 0 60 70" width={56} height={56}>
    <SvgRect x="3" y="38" width="9" height="20" rx="4.5" fill={HAIR_MID} />
    <SvgRect x="48" y="38" width="9" height="20" rx="4.5" fill={HAIR_MID} />
    <SvgCircle cx="30" cy="40" r="19" fill={SKIN} />
    <SvgPath
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={HAIR_MID}
    />
    <SvgCircle cx="8" cy="38" r="4" fill={PINK} />
    <SvgCircle cx="52" cy="38" r="4" fill={PINK} />
    <SvgCircle cx="23" cy="39" r="2.5" fill={DARK} />
    <SvgCircle cx="37" cy="39" r="2.5" fill={DARK} />
    <SvgPath
      d="M23 47 Q30 53 37 47"
      stroke={DARK}
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </Svg>
);

const GirlCurlsSVG = () => (
  <Svg viewBox="0 0 60 70" width={56} height={56}>
    <SvgEllipse cx="30" cy="28" rx="24" ry="22" fill={HAIR_MID} />
    <SvgCircle cx="30" cy="40" r="19" fill={SKIN} />
    <SvgCircle cx="23" cy="39" r="2.5" fill={DARK} />
    <SvgCircle cx="37" cy="39" r="2.5" fill={DARK} />
    <SvgPath
      d="M23 47 Q30 53 37 47"
      stroke={DARK}
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </Svg>
);

const BowSVG = () => (
  <Svg viewBox="0 0 60 70" width={56} height={56}>
    <SvgCircle cx="30" cy="40" r="19" fill={SKIN} />
    <SvgPath
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={HAIR_MID}
    />
    <SvgPath d="M20 13 C20 6 29 6 30 13 C29 20 20 20 20 13 Z" fill={PINK} />
    <SvgPath d="M40 13 C40 6 31 6 30 13 C31 20 40 20 40 13 Z" fill={PINK} />
    <SvgCircle cx="30" cy="13" r="3" fill={PINK_DEEP} />
    <SvgCircle cx="23" cy="39" r="2.5" fill={DARK} />
    <SvgCircle cx="37" cy="39" r="2.5" fill={DARK} />
    <SvgPath
      d="M23 47 Q30 53 37 47"
      stroke={DARK}
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </Svg>
);

// ── Avatar definitions — IDs/labels match web exactly ─────────────────────────

interface AvatarDef {
  id: string;
  label: string;
  bg: string;
  Component: () => React.JSX.Element;
}

const BOY_AVATARS: AvatarDef[] = [
  {
    id: 'capper-boy',
    label: 'Capper',
    bg: 'hsl(174, 84%, 32%)',
    Component: CapperSVG,
  },
  {
    id: 'curly-boy',
    label: 'Curly',
    bg: 'hsl(262, 83%, 58%)',
    Component: CurlySVG,
  },
  {
    id: 'specs-boy',
    label: 'Specs',
    bg: 'hsl(32, 95%, 44%)',
    Component: SpecsSVG,
  },
];

const GIRL_AVATARS: AvatarDef[] = [
  {
    id: 'braid-girl',
    label: 'Braid',
    bg: 'hsl(333, 71%, 51%)',
    Component: BraidSVG,
  },
  {
    id: 'curls-girl',
    label: 'Curls',
    bg: 'hsl(347, 89%, 44%)',
    Component: GirlCurlsSVG,
  },
  { id: 'bow-girl', label: 'Bow', bg: 'hsl(293, 69%, 49%)', Component: BowSVG },
];

const ALL_AVATARS = [...BOY_AVATARS, ...GIRL_AVATARS];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChildFormData {
  name: string;
  age: string;
  gender: 'Male' | 'Female' | 'Other' | '';
  school: string;
  avatarId?: string;
  avatarUrl?: string;
}

export interface PhotoAsset {
  uri: string;
  mimeType: string;
}

interface Props {
  onContinue: (data: ChildFormData, photo?: PhotoAsset) => void | Promise<void>;
  initialData?: Partial<ChildFormData>;
  isLoading?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChildProfileStep({
  onContinue,
  initialData,
  isLoading,
}: Props) {
  const { colors } = useTheme();
  const [form, setForm] = useState<ChildFormData>({
    name: initialData?.name ?? '',
    age: initialData?.age ?? '',
    gender: initialData?.gender ?? '',
    school: initialData?.school ?? '',
    avatarId: initialData?.avatarId ?? '',
  });
  const [avatarTab, setAvatarTab] = useState<'boy' | 'girl'>(
    GIRL_AVATARS.some(a => a.id === initialData?.avatarId) ? 'girl' : 'boy',
  );
  const [errors, setErrors] = useState<
    Partial<Record<keyof ChildFormData, string>>
  >({});
  const [photoAsset, setPhotoAsset] = useState<PhotoAsset | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    initialData?.avatarUrl ?? null,
  );
  useEffect(() => {
    if (!initialData || Object.keys(initialData).length === 0) return;
    setForm({
      name: initialData.name ?? '',
      age: initialData.age ?? '',
      gender: initialData.gender ?? '',
      school: initialData.school ?? '',
      avatarId: initialData.avatarId ?? '',
    });
    if (initialData.avatarId) {
      setAvatarTab(
        GIRL_AVATARS.some(a => a.id === initialData.avatarId) ? 'girl' : 'boy',
      );
    }
    if (initialData.avatarUrl) {
      setPhotoPreview(initialData.avatarUrl);
    }
  }, [initialData]);

  const avatars = avatarTab === 'boy' ? BOY_AVATARS : GIRL_AVATARS;
  const selected = ALL_AVATARS.find(a => a.id === form.avatarId);

  const setField = <K extends keyof ChildFormData>(
    key: K,
    val: ChildFormData[K],
  ) => {
    setForm(f => ({ ...f, [key]: val }));
    setErrors(e => ({ ...e, [key]: undefined }));
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setPhotoAsset({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      setPhotoPreview(asset.uri);
      setField('avatarId', '');
    }
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
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setPhotoAsset({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      setPhotoPreview(asset.uri);
      setField('avatarId', '');
    }
  };

  const handleAddPhoto = () => {
    Alert.alert('Add Photo', undefined, [
      { text: 'Take Photo', onPress: () => void pickFromCamera() },
      { text: 'Choose from Library', onPress: () => void pickFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof ChildFormData, string>> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    const ageNum = Number(form.age);
    if (!form.age.trim()) e.age = 'Age is required';
    else if (isNaN(ageNum) || ageNum < 8 || ageNum > 30)
      e.age = 'Age must be between 8 and 30';
    if (!form.gender) e.gender = 'Please select a gender';
    if (!form.avatarId && !photoAsset && !initialData?.avatarUrl)
      e.avatarId = 'Please upload a photo or pick an avatar';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleContinue = () => {
    if (!validate()) return;
    void onContinue(form, photoAsset ?? undefined);
  };

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: 24,
      }}
    >
      {/* Header */}
      <View className="items-center mb-6">
        <Text
          className="text-[11px] font-semibold uppercase tracking-widest mb-1"
          style={{ color: colors.primary }}
        >
          Let's start with the basics
        </Text>
        <Text
          className="text-2xl font-bold text-center mb-1"
          style={{ color: colors.text }}
        >
          Tell us about your child
        </Text>
        <Text
          className="text-sm text-center"
          style={{ color: colors.textMuted }}
        >
          A photo or fun avatar makes the journey feel personal. Just a few
          quick fields.
        </Text>
      </View>

      {/* Avatar preview circle + Upload button — mirrors web */}
      <View className="items-center mb-4 gap-3">
        <TouchableOpacity
          onPress={handleAddPhoto}
          activeOpacity={0.8}
          style={{
            height: 96,
            width: 96,
            borderRadius: 48,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            borderWidth: 2,
            borderStyle: photoPreview || selected ? 'solid' : 'dashed',
            borderColor:
              photoPreview || selected ? colors.primary : colors.primary + '66',
            backgroundColor: colors.surfaceElevated,
          }}
        >
          {photoPreview ? (
            <Image
              source={{ uri: photoPreview }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : selected ? (
            <View
              style={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected.bg,
              }}
            >
              <selected.Component />
            </View>
          ) : (
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Camera size={24} color={colors.primary} />
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: 1.2,
                  color: colors.textMuted,
                  marginTop: 2,
                }}
              >
                Add Photo
              </Text>
              <Text
                style={{ fontSize: 8, color: colors.iconColor, opacity: 0.5 }}
              >
                or pick an avatar
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <Button
          variant="outline"
          onPress={handleAddPhoto}
          className="rounded-full px-4"
        >
          <View className="flex-row items-center gap-1.5">
            <Upload size={12} color={colors.textMuted} />
            <Text className="text-xs" style={{ color: colors.textMuted }}>
              Upload photo
            </Text>
          </View>
        </Button>
      </View>

      {/* Avatar picker — mirrors web "Or pick an avatar" section */}
      <View
        className="rounded-xl mb-2"
        style={{
          backgroundColor: colors.surfaceElevated,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border + '66',
        }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <Text
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: colors.textMuted }}
          >
            🎭 Or pick an avatar
          </Text>
          <View
            className="flex-row rounded-lg overflow-hidden"
            style={{ borderWidth: 1, borderColor: colors.border }}
          >
            {(['boy', 'girl'] as const).map(g => (
              <TouchableOpacity
                key={g}
                onPress={() => setAvatarTab(g)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  backgroundColor:
                    avatarTab === g ? colors.primary : 'transparent',
                }}
              >
                <Text
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    color:
                      avatarTab === g
                        ? colors.primaryForeground
                        : colors.textMuted,
                  }}
                >
                  {g}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="flex-row" style={{ gap: 8 }}>
          {avatars.map(av => {
            const isSelected = form.avatarId === av.id;
            return (
              <TouchableOpacity
                key={av.id}
                onPress={() => {
                  setField('avatarId', av.id);
                  setPhotoAsset(null);
                  setPhotoPreview(null);
                }}
                style={{
                  flex: 1,
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: isSelected ? colors.primary : colors.border,
                  backgroundColor: isSelected
                    ? colors.primarySubtle
                    : colors.card,
                  alignItems: 'center',
                  paddingVertical: 8,
                  gap: 4,
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: av.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <av.Component />
                </View>
                <Text
                  className="text-xs font-medium"
                  style={{
                    color: isSelected ? colors.primary : colors.textMuted,
                  }}
                >
                  {av.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {errors.avatarId && (
        <Text
          className="text-[10px] text-center mb-2"
          style={{ color: colors.error }}
        >
          {errors.avatarId}
        </Text>
      )}

      {/* Divider */}
      <View className="flex-row items-center mb-4 mt-2" style={{ gap: 8 }}>
        <View
          className="flex-1"
          style={{ height: 1, backgroundColor: colors.border }}
        />
        <Text
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: colors.textMuted }}
        >
          About your child
        </Text>
        <View
          className="flex-1"
          style={{ height: 1, backgroundColor: colors.border }}
        />
      </View>

      {/* Name + Age */}
      <View className="flex-row mb-4" style={{ gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: colors.textMuted }}
          >
            Child's Name <Text style={{ color: colors.primary }}>*</Text>
          </Text>
          <TextInput
            value={form.name}
            onChangeText={v => setField('name', v)}
            placeholder="Arjun"
            placeholderTextColor={colors.faint}
            style={{
              borderRadius: 12,
              borderWidth: 1,
              borderColor: errors.name ? colors.error : colors.border,
              backgroundColor: colors.surfaceInput,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: colors.text,
              fontSize: 14,
            }}
          />
          {errors.name && (
            <Text className="text-[10px] mt-1" style={{ color: colors.error }}>
              {errors.name}
            </Text>
          )}
        </View>

        <View style={{ width: 90 }}>
          <Text
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: colors.textMuted }}
          >
            Age <Text style={{ color: colors.primary }}>*</Text>
          </Text>
          <TextInput
            value={form.age}
            onChangeText={v => setField('age', v)}
            placeholder="8"
            placeholderTextColor={colors.faint}
            keyboardType="numeric"
            style={{
              borderRadius: 12,
              borderWidth: 1,
              borderColor: errors.age ? colors.error : colors.border,
              backgroundColor: colors.surfaceInput,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: colors.text,
              fontSize: 14,
            }}
          />
          {errors.age && (
            <Text className="text-[10px] mt-1" style={{ color: colors.error }}>
              {errors.age}
            </Text>
          )}
        </View>
      </View>

      {/* Gender */}
      <View className="mb-4">
        <Text
          className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
          style={{ color: colors.textMuted }}
        >
          Gender <Text style={{ color: colors.primary }}>*</Text>
        </Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {(['Male', 'Female', 'Other'] as const).map(g => (
            <TouchableOpacity
              key={g}
              onPress={() => setField('gender', g)}
              className="flex-1 rounded-xl py-2.5 items-center"
              style={{
                borderWidth: 1,
                borderColor: form.gender === g ? colors.primary : colors.border,
                backgroundColor:
                  form.gender === g ? colors.primarySubtle : 'transparent',
              }}
            >
              <Text
                className="text-sm font-medium"
                style={{
                  color: form.gender === g ? colors.primary : colors.textMuted,
                }}
              >
                {g}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {errors.gender && (
          <Text className="text-[10px] mt-1" style={{ color: colors.error }}>
            {errors.gender}
          </Text>
        )}
      </View>

      {/* School */}
      <View className="mb-6">
        <Text
          className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
          style={{ color: colors.textMuted }}
        >
          School{' '}
          <Text style={{ color: colors.faint, fontSize: 11 }}>(optional)</Text>
        </Text>
        <TextInput
          value={form.school}
          onChangeText={v => setField('school', v)}
          placeholder="Greenfield International"
          placeholderTextColor={colors.faint}
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceInput,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: colors.text,
            fontSize: 14,
          }}
        />
      </View>

      {/* Footer */}
      <View className="flex-row items-center justify-between">
        <Text style={{ color: colors.faint, fontSize: 11 }}>* Required</Text>
        <Button
          onPress={handleContinue}
          disabled={!!isLoading}
          className="rounded-full px-8"
        >
          {isLoading ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator
                size="small"
                color={colors.primaryForeground}
              />
              <Text
                style={{ color: colors.primaryForeground, fontWeight: '600' }}
              >
                Saving…
              </Text>
            </View>
          ) : (
            <Text
              style={{
                color: colors.primaryForeground,
                fontWeight: '600',
                fontSize: 16,
              }}
            >
              Continue →
            </Text>
          )}
        </Button>
      </View>
    </View>
  );
}
