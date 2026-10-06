import { useEffect, useState } from 'react';
import {
  Image,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import * as ImagePicker from 'expo-image-picker';
import { ChevronDown } from 'lucide-react-native';

import { toast } from '@/lib/toast';
import { rgb } from '@/theme';
import type { PickedPhoto } from '@/hooks/useNinetyDayPlan';
import {
  FIELD_STYLE,
  FIELD_LABEL_STYLE,
  FROST,
  PLACEHOLDER,
  SLATE_LIGHT,
} from './theme';
import { CLOSE_PATH, Glyph, PLUS_PATH } from './icons';

const KEYBOARD: Record<string, KeyboardTypeOptions> = {
  email: 'email-address',
  number: 'numeric',
  text: 'default',
};

/** A single-column labeled input — the shape shared by most text fields
 * across every step. `type="date"` renders a DD/MM/YYYY date entry (see DateInput). */
export function TextField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View nativeID={id}>
      <Text style={FIELD_LABEL_STYLE}>{label}</Text>
      {type === 'date' ? (
        <DateInput
          label={label}
          value={value}
          onChange={onChange}
          style={FIELD_STYLE}
        />
      ) : (
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={PLACEHOLDER}
          keyboardType={KEYBOARD[type] ?? 'default'}
          autoCapitalize={type === 'email' ? 'none' : 'sentences'}
          autoCorrect={type !== 'email'}
          style={FIELD_STYLE}
        />
      )}
    </View>
  );
}

/** Same shape as TextField, but a multi-line input for longer answers. */
export function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const lineHeight = 15.5 * 1.5;
  return (
    <View nativeID={id}>
      <Text style={FIELD_LABEL_STYLE}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={PLACEHOLDER}
        multiline
        textAlignVertical="top"
        style={[FIELD_STYLE, { lineHeight, minHeight: rows * lineHeight + 24 }]}
      />
    </View>
  );
}

// ─── Date entry ──────────────────────────────────────────────────────────────
// The web uses <input type="date">, whose value is either '' or a complete
// YYYY-MM-DD. There's no native date-picker package in this app, so this is a
// typed DD/MM/YYYY entry (the en-GB format the web's picker displays) that
// only reports a complete, valid date upward — '' otherwise — so callers see
// exactly the values a web date input would give them.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoToDisplay(iso: string): string {
  const m = ISO_RE.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function formatDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4)
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return '';
  const [, dd = '', mm = '', yyyy = ''] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const valid =
    d.getFullYear() === Number(yyyy) &&
    d.getMonth() === Number(mm) - 1 &&
    d.getDate() === Number(dd);
  return valid ? `${yyyy}-${mm}-${dd}` : '';
}

export function DateInput({
  label,
  value,
  onChange,
  style,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  style: React.ComponentProps<typeof TextInput>['style'];
}) {
  const [draft, setDraft] = useState(() => isoToDisplay(value));

  // Follow external changes (e.g. the saved plan hydrating after mount).
  useEffect(() => {
    if (value && displayToIso(draft) !== value) setDraft(isoToDisplay(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the prop
  }, [value]);

  return (
    <TextInput
      accessibilityLabel={label}
      accessibilityHint="Day, month and year"
      value={draft}
      onChangeText={text => {
        const next = formatDisplay(text);
        setDraft(next);
        const iso = displayToIso(next);
        if (iso !== value) onChange(iso);
      }}
      placeholder="dd/mm/yyyy"
      placeholderTextColor={PLACEHOLDER}
      keyboardType="number-pad"
      maxLength={10}
      style={style}
    />
  );
}

// ─── Select ──────────────────────────────────────────────────────────────────

/** Web <select> styled as FIELD_STYLE — an inline dropdown list on RN. */
export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);
  return (
    <View nativeID={id}>
      <Text style={FIELD_LABEL_STYLE}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? ''}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(o => !o)}
        style={[FIELD_STYLE, { flexDirection: 'row', alignItems: 'center' }]}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: FROST,
            fontFamily: FIELD_STYLE.fontFamily,
            fontSize: 15.5,
          }}
        >
          {current?.label ?? ''}
        </Text>
        <ChevronDown size={14} color={SLATE_LIGHT} />
      </Pressable>
      {open && (
        <View
          accessibilityRole="menu"
          style={{
            marginTop: 4,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: rgb('constellation-cyan', 0.2),
            backgroundColor: rgb('constellation-navy-deepest', 0.98),
            overflow: 'hidden',
          }}
        >
          {options.map(o => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: on }}
                accessibilityLabel={o.label}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  backgroundColor: on
                    ? rgb('constellation-cyan', 0.12)
                    : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: FROST,
                    fontFamily: FIELD_STYLE.fontFamily,
                    fontSize: 15,
                  }}
                >
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Photo import ────────────────────────────────────────────────────────────

/** Web `<input type="file" accept="image/*" multiple>` → the system photo library. */
export async function pickPhotos(): Promise<PickedPhoto[] | null> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
    });
    if (result.canceled) return null;
    return result.assets.map(a => ({
      uri: a.uri,
      mimeType: a.mimeType ?? null,
    }));
  } catch (err) {
    console.error('[lifepathway] Photo picker failed:', err);
    toast.error('Could not open your photos. Please try again.');
    return null;
  }
}

/** Thumbnails of imported photos (each removable) followed by the dashed "+"
 * tile that opens the picker. Sizes differ slightly between the Dashboard
 * (58px) and Tracker (64px) variants, exactly as on the web. */
export function PhotoGrid({
  label,
  files,
  onAdd,
  onRemove,
  size,
  radius,
  dashedAlpha,
  plusSize,
}: {
  label: string;
  files: { url: string }[];
  onAdd: (photos: PickedPhoto[] | null) => void;
  onRemove: (index: number) => void;
  size: number;
  radius: number;
  dashedAlpha: number;
  plusSize: number;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {files.map((f, i) => (
        <View
          key={f.url}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: rgb('constellation-cyan', 0.2),
            backgroundColor: rgb('constellation-void', 0.7),
          }}
        >
          <Image
            source={{ uri: f.url }}
            accessibilityLabel={`Imported for ${label}`}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove photo ${i + 1} from ${label}`}
            hitSlop={8}
            onPress={() => onRemove(i)}
            style={{
              position: 'absolute',
              right: 4,
              top: 4,
              width: 16,
              height: 16,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: rgb('constellation-void', 0.9),
              borderWidth: 1,
              borderColor: rgb('constellation-cyan', 0.28),
            }}
          >
            <Glyph
              d={CLOSE_PATH}
              size={8}
              stroke={SLATE_LIGHT}
              strokeWidth={2.6}
            />
          </Pressable>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Import photos from your library"
        onPress={() => {
          void pickPhotos().then(onAdd);
        }}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: rgb('constellation-cyan', dashedAlpha),
          backgroundColor: rgb('constellation-void', 0.5),
        }}
      >
        <Glyph
          d={PLUS_PATH}
          size={plusSize}
          stroke={SLATE_LIGHT}
          strokeWidth={2}
        />
      </Pressable>
    </View>
  );
}
