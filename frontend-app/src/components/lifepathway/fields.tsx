import { useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { Pressable } from '@/components/ui/pressable';
import * as ImagePicker from 'expo-image-picker';
import { pickedImageType } from '@/api/uploads';
import { Calendar, ChevronDown } from 'lucide-react-native';

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
 * across every step. `type="date"` opens the system date picker (see DateInput). */
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
// The web uses <input type="date">: the browser's calendar, and a value that's either '' or
// a complete YYYY-MM-DD. This is the same on a phone: tapping the field opens the system
// date picker (@react-native-community/datetimepicker), and only a complete date, or '' once
// cleared, is reported upward. iOS opens the calendar in a small window over the screen
// (the plan's card is too narrow for it inline); Android uses its calendar dialog.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoToDisplay(iso: string): string {
  const m = ISO_RE.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function isoToDate(iso: string): Date | null {
  const m = ISO_RE.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** The picked day as YYYY-MM-DD, in the phone's own time zone (not toISOString's UTC). */
export function dateToIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
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
  const [open, setOpen] = useState(false);
  const shown = isoToDisplay(value);
  const current = isoToDate(value) ?? new Date();

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) onChange(dateToIso(picked));
        },
      });
      return;
    }
    setOpen(o => !o);
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: shown || 'Not set' }}
        accessibilityHint="Opens a calendar"
        onPress={openPicker}
        style={[
          style as object,
          { flexDirection: 'row', alignItems: 'center' },
        ]}
      >
        <Text
          style={{ flex: 1, color: shown ? FROST : PLACEHOLDER, fontSize: 15 }}
          numberOfLines={1}
        >
          {shown || 'dd/mm/yyyy'}
        </Text>
        <Calendar size={16} color={SLATE_LIGHT} />
      </Pressable>
      {Platform.OS === 'ios' && (
        // The calendar in its own small window over the screen: inline under the field it
        // needs ~320 pt, more than the plan's card has, and the wheels can't be narrowed.
        // A Modal opens over the plan's own Modal on iOS.
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the calendar"
            onPress={() => setOpen(false)}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
            }}
          >
            {/* Taps inside the card don't close it. */}
            <Pressable
              accessible={false}
              onPress={() => {}}
              style={{
                width: '100%',
                maxWidth: 360,
                borderRadius: 16,
                padding: 12,
                backgroundColor: rgb('constellation-navy-panel3', 0.98),
                borderWidth: 1,
                borderColor: rgb('constellation-cyan', 0.24),
              }}
            >
              <DateTimePicker
                value={current}
                mode="date"
                display="inline"
                themeVariant="dark"
                onChange={(event, picked) => {
                  if (event.type === 'set' && picked)
                    onChange(dateToIso(picked));
                }}
              />
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                  gap: 18,
                  paddingHorizontal: 8,
                  paddingTop: 4,
                }}
              >
                {value !== '' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Clear ${label}`}
                    onPress={() => {
                      onChange('');
                      setOpen(false);
                    }}
                    hitSlop={8}
                  >
                    <Text style={{ color: SLATE_LIGHT, fontSize: 15 }}>
                      Clear
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                  onPress={() => setOpen(false)}
                  hitSlop={8}
                >
                  <Text
                    style={{ color: FROST, fontSize: 15, fontWeight: '600' }}
                  >
                    Done
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
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
      // HEIC photos (iPhone, many Android phones) are converted to JPEG, which the API
      // accepts: iOS by asking for the compatible format, Android by re-encoding (any
      // quality below 1). It also keeps a full-size photo well under the 5 MB limit.
      quality: 0.85,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return null;
    return result.assets.map(a => ({
      uri: a.uri,
      mimeType: pickedImageType(a.uri, a.mimeType),
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
