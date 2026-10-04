/**
 * RN port of frontend/src/components/connect/shared.tsx — the Connect page's
 * data (accomplishments, contacts, destinations), brand icons, the toast
 * banner and the share-modal shell. Phone-width only: the web's
 * `--cx-type-scale` is 1 below 768px, so `cfs(px)` is just `px` here.
 */
import React, { useState, type ReactNode } from 'react';
import {
  Linking,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Portal } from '@/components/ui/portal';
import { Pressable } from '@/components/ui/pressable';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { css, font, rgb } from '@/theme';
import {
  IG_BG_GOLD_TO,
  IG_BG_PLUM_FROM,
  IG_BG_PLUM_TO,
  IG_BG_SEA_FROM,
  IG_BG_SEA_TO,
  SHIELD_DEFAULT,
  TOAST_BG,
  TOAST_SHADOW,
} from './palette';

/** Web `calc(px * var(--cx-type-scale))` — the scale is 1 at phone width. */
export const cfs = (px: number) => px;

// ─── Typography helpers ──────────────────────────────────────────────────────
// The web page root is `font-rajdhani`; every Text here sets its family by weight.
export const rj = {
  semibold: font('rajdhani', 600),
  bold: font('rajdhani', 700),
} as const;
export const orb = {
  bold: font('orbitron', 700),
  black: font('orbitron', 900),
} as const;

/** Uppercase label: web `fontSize: px; letterSpacing: .Xem; textTransform: uppercase`. */
export function caps(size: number, em: number): TextStyle {
  return {
    fontSize: size,
    letterSpacing: size * em,
    textTransform: 'uppercase',
  };
}

/** Opens a URL the way the web's `<a target="_blank">` does — outside the app. */
export function openExternal(url: string) {
  Linking.openURL(url).catch((e: unknown) => console.error(e));
}

/**
 * Splits `text` on the first occurrence of `url` and renders that piece as a
 * tappable, underlined link (opens outside the app) — the rest stays plain
 * text. Must be rendered inside a parent <Text>, whose style it inherits.
 */
export function linkifyUrl(text: string, url: string): ReactNode {
  const idx = text.indexOf(url);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <Text
        accessibilityRole="link"
        onPress={() => openExternal(url)}
        style={{ textDecorationLine: 'underline' }}
      >
        {url}
      </Text>
      {text.slice(idx + url.length)}
    </>
  );
}

// ─── Entrance animations (web @keyframes connFadeUp / framer presets) ────────
const ease = Easing.ease;
function connFadeUp(delayMs: number) {
  return new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 16 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: ease },
  })
    .duration(700)
    .delay(delayMs);
}
/** `animation: connFadeUp .7s ease <delay> both` at the page's three delays. */
export const FADE_UP = {
  d0: connFadeUp(0),
  d100: connFadeUp(100),
  d180: connFadeUp(180),
} as const;

const TOAST_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 14 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }] },
}).duration(300);
const TOAST_OUT = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -8 }] },
}).duration(300);
const BACKDROP_IN = new Keyframe({
  0: { opacity: 0 },
  100: { opacity: 1 },
}).duration(300);
const DIALOG_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 8 }] },
  100: {
    opacity: 1,
    transform: [{ translateY: 0 }],
    easing: Easing.out(Easing.ease),
  },
}).duration(300);

// ─── Data ────────────────────────────────────────────────────────────────────
const IC = {
  star: 'M12 3l2.2 5.6L20 9.4l-4 4 1 6-5-2.9-5 2.9 1-6-4-4 5.8-.8z',
  build: 'M15 4a4 4 0 0 0 5 5l-9 9a3 3 0 1 1-4-4z',
  mic: 'M12 4a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 12 4zM6 11a6 6 0 0 0 12 0M12 17v4',
  chart: 'M4 20V10M11 20V4M18 20v-7',
  school: 'M3 9l9-4 9 4-9 4zM7 12v4c0 1.5 2.2 3 5 3s5-1.5 5-3v-4',
  sport:
    'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4.5 9h15M4.5 15h15M12 4c-2.5 4-2.5 12 0 16M12 4c2.5 4 2.5 12 0 16',
  friends:
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c1-3.5 3.2-5.2 6-5.2S14 16.5 15 20M16 5.5a3 3 0 0 1 0 6M18 14.6c1.7.8 2.8 2.4 3.3 5.4',
  kind: 'M12 20s-7-4.4-7-9.3A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.7C19 15.6 12 20 12 20z',
};

export interface AccomplishmentItem {
  kind: string;
  when: string;
  title: string;
  caption: string;
  icon: string;
}

export const BASE_ITEMS: AccomplishmentItem[] = [
  {
    kind: 'Sport',
    when: '2 days ago',
    title: 'First in the district relay',
    caption: 'Six weeks of practice, two seconds off his time.',
    icon: IC.sport,
  },
  {
    kind: 'Milestone',
    when: 'Last week',
    title: 'He finished his first build',
    caption: 'One project, one deadline, seen all the way through.',
    icon: IC.build,
  },
  {
    kind: 'School',
    when: 'Last week',
    title: 'Science project picked for the fair',
    caption: 'The one he kept working on after everyone else stopped.',
    icon: IC.school,
  },
  {
    kind: 'Growth',
    when: 'This month',
    title: 'Speaking up, +26 this year',
    caption: 'From waiting to be asked to saying the hard thing first.',
    icon: IC.mic,
  },
  {
    kind: 'Friendship',
    when: 'This month',
    title: 'Two new friends at the club',
    caption: 'He invited them in himself. That part is new.',
    icon: IC.friends,
  },
  {
    kind: 'Progress',
    when: 'Ongoing',
    title: 'Six weeks of the 90-day plan',
    caption: 'Twelve minutes a day, not one week skipped.',
    icon: IC.chart,
  },
  {
    kind: 'Personality',
    when: 'Profile',
    title: '{name} is The Thinker',
    caption: 'Depth on demand, curiosity that outlasts the room.',
    icon: IC.star,
  },
  {
    kind: 'Kindness',
    when: 'Last month',
    title: 'Stood up for a boy in his class',
    caption: 'Told us about it three days later, by accident.',
    icon: IC.kind,
  },
];

export interface WaContact {
  name: string;
  meta: string;
  initials: string;
}

export const WA_CONTACTS: WaContact[] = [
  { name: 'Family', meta: 'Group · 8 members', initials: 'FM' },
  { name: 'Grandparents', meta: 'Group · 4 members', initials: 'GP' },
  { name: 'Cousins', meta: 'Group · 11 members', initials: 'CZ' },
  { name: 'Class parents', meta: 'Group · 26 members', initials: 'CP' },
  { name: 'Coach Raghav', meta: 'Contact', initials: 'CR' },
];

export interface IgDest {
  name: string;
  meta: string;
  ratio: string;
  cta: string;
  sent: string;
  line: string;
}

export const IG_DESTS: IgDest[] = [
  {
    name: 'Your story',
    meta: 'Visible 24 hours',
    ratio: '9:16 story frame',
    cta: 'Add to story',
    sent: 'Added to your story',
    line: 'Live for 24 hours. 214 followers can see it.',
  },
  {
    name: 'Close friends',
    meta: '12 people',
    ratio: '9:16 story frame',
    cta: 'Share',
    sent: 'Shared with close friends',
    line: 'Only your 12 close friends will see this story.',
  },
  {
    name: 'Feed post',
    meta: 'Stays on profile',
    ratio: '4:5 feed post',
    cta: 'Post',
    sent: 'Posted to your feed',
    line: 'It is on your profile now, caption and all.',
  },
  {
    name: 'Direct message',
    meta: 'Pick people after',
    ratio: '9:16 in chat',
    cta: 'Next',
    sent: 'Ready to send',
    line: 'Choose the chats on the next screen inside Instagram.',
  },
];

/** Story backdrops — ready `experimental_backgroundImage` values. */
export const IG_BGS: string[] = [
  `linear-gradient(160deg,${IG_BG_PLUM_FROM},${IG_BG_PLUM_TO})`,
  css(
    'linear-gradient(160deg,rgb(var(--instagram-violet-rgb)),rgb(var(--instagram-violet-deep-rgb)))',
  ),
  `linear-gradient(160deg,${IG_BG_SEA_FROM},${IG_BG_SEA_TO})`,
  css(
    `linear-gradient(160deg,rgb(var(--constellation-gold-rgb)),${IG_BG_GOLD_TO})`,
  ),
];

export const TW_TAGS = ['#Superpower', '#ParentingWins', '#SmallWins'];
export const TW_AUDIENCES = ['Everyone', 'Circle only'];
export const TW_MAX = 280;
export const TW_RING_CIRCUMFERENCE = 94.2;

// ─── Icons ───────────────────────────────────────────────────────────────────
export function WhatsAppIcon({
  size = 24,
  color = rgb('whatsapp-bright'),
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.8}
    >
      <Path d="M20.5 11.8a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 20.5 11.8z" />
      <Path d="M8.8 8.4c.3-.6 1.3-.5 1.5 0l.6 1.4-.7 1a5 5 0 0 0 2.9 2.9l1-.7 1.4.6c.5.2.6 1.2 0 1.5-1.5.8-3.6.2-5.2-1.4s-2.3-3.8-1.5-5.3z" />
    </Svg>
  );
}

export function InstagramIcon({
  size = 24,
  color = rgb('instagram-pink'),
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.8}
    >
      <Rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <Circle cx="12" cy="12" r="4" />
      <Circle cx="17" cy="7" r="1.1" fill={color} stroke="none" />
    </Svg>
  );
}

export function TwitterIcon({
  size = 24,
  color = rgb('twitter-sent'),
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.9}
    >
      <Path d="M5 5l14 14M19 5L5 19" />
    </Svg>
  );
}

export function LinkIcon({
  size = 15,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={2}
    >
      <Path d="M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.5 6" />
      <Path d="M14 11a4 4 0 0 0-5.7 0L5.7 13.6a4 4 0 0 0 5.7 5.7L12.5 18" />
    </Svg>
  );
}

export function CheckTickIcon({
  size = 11,
  color = rgb('constellation-ink'),
  opacity = 1,
}: {
  size?: number;
  color?: string;
  opacity?: number;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={3.2}
      opacity={opacity}
    >
      <Path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}

export function CloseIcon({
  size = 13,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={2.2}
    >
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function ShieldIcon({
  size = 14,
  color = SHIELD_DEFAULT,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.9}
    >
      <Path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />
    </Svg>
  );
}

export function ArrowRightIcon({
  size = 14,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={2.4}
    >
      <Path d="M4 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function ChevronDownIcon({
  size = 10,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={2.4}
    >
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function PencilIcon({
  size = 13,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={2}
    >
      <Path d="M4 20h4l10-10-4-4L4 16z" />
    </Svg>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────
const TOAST_STYLE: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 11,
  paddingVertical: 14,
  paddingHorizontal: 24,
  borderRadius: 999,
  backgroundColor: TOAST_BG,
  borderWidth: 1,
  borderColor: rgb('constellation-gold', 0.45),
  boxShadow: `0 20px 50px ${TOAST_SHADOW}`,
};

/** Web `position: fixed; bottom: 34; left: 50%` pill — render in the screen root. */
export function ToastBanner({ message }: { message: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 34 + insets.bottom,
        zIndex: 20,
        alignItems: 'center',
      }}
    >
      <Animated.View
        entering={TOAST_IN}
        exiting={TOAST_OUT}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={TOAST_STYLE}
      >
        <CheckTickIcon
          size={16}
          color={rgb('constellation-gold')}
          opacity={1}
        />
        <Text
          style={[
            rj.bold,
            {
              fontSize: cfs(14),
              letterSpacing: 14 * 0.04,
              color: rgb('constellation-gold-pale'),
            },
          ]}
        >
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────────
/**
 * The share-modal shell (web: fixed full-screen gradient backdrop, tap outside
 * to close, panel fades/slides up 8px). Built on a Portal, so the Android
 * back button closes it and screen readers treat it as modal.
 */
export function ModalBackdrop({
  gradient,
  onClose,
  label,
  children,
}: {
  /** A ready `experimental_backgroundImage` value (already css()-resolved). */
  gradient: string;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Portal onRequestClose={onClose}>
      <Animated.View
        entering={BACKDROP_IN}
        style={{ flex: 1, experimental_backgroundImage: gradient }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 26,
            paddingTop: 26 + insets.top,
            paddingBottom: 26 + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Tap-outside-to-close. Taps inside the panel bubble to its own
              ancestors, never to this sibling — the web's stopPropagation. */}
          <Pressable
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close dialog"
          />
          <Animated.View
            entering={DIALOG_IN}
            accessibilityViewIsModal
            accessibilityLabel={label}
          >
            {children}
          </Animated.View>
        </ScrollView>
      </Animated.View>
    </Portal>
  );
}

export function ModalCloseButton({
  onPress,
  color,
  border,
}: {
  onPress: () => void;
  color: string;
  border: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={8}
      style={{
        position: 'absolute',
        top: 16,
        right: 18,
        zIndex: 1,
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: border,
        backgroundColor: 'transparent',
      }}
    >
      <CloseIcon color={color} />
    </Pressable>
  );
}

/** The modal panel: rounded, gradient, bordered, shadowed — shared by all three. */
export function ModalPanel({
  background,
  border,
  shadow,
  children,
}: {
  background: string;
  border: string;
  shadow: string;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: 22,
        paddingTop: 26,
        paddingHorizontal: 28,
        paddingBottom: 24,
        experimental_backgroundImage: background,
        borderWidth: 1,
        borderColor: border,
        boxShadow: shadow,
      }}
    >
      {children}
    </View>
  );
}

/** The modal's brand-badge + title + subtitle header row. */
export function ModalHeader({
  badge,
  title,
  titleColor,
  subtitle,
  subtitleColor,
}: {
  badge: ReactNode;
  title: string;
  titleColor: string;
  subtitle: string;
  subtitleColor: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingRight: 36,
      }}
    >
      {badge}
      <View style={{ flexShrink: 1 }}>
        <Text
          accessibilityRole="header"
          style={[orb.bold, { fontSize: cfs(17), color: titleColor }]}
        >
          {title}
        </Text>
        <Text
          style={[
            rj.semibold,
            { marginTop: 2, fontSize: cfs(13.5), color: subtitleColor },
          ]}
        >
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

export function BrandBadge({
  background,
  border,
  children,
}: {
  background: string;
  border: string;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        experimental_backgroundImage: background,
        borderWidth: 1.5,
        borderColor: border,
      }}
    >
      {children}
    </View>
  );
}

export interface InviteTone {
  boxBg: string;
  boxBorder: string;
  iconBg: string;
  iconBorder: string;
  icon: string;
  title: string;
  meta: string;
  btnBorder: string;
  btnText: string;
}

/**
 * The dashed "Join Superpower link" box with a Copy button. Stacked at phone
 * width (the web's `max-width: 480px` branch): icon + text stay a row, Copy
 * drops onto its own line at the end.
 */
export function InviteLinkBox({
  title,
  inviteUrl,
  onCopy,
  tone,
  compact = false,
  marginTop,
}: {
  title: string;
  inviteUrl: string;
  onCopy: () => void;
  tone: InviteTone;
  /** Twitter's slightly smaller variant. */
  compact?: boolean;
  marginTop: number;
}) {
  const fullInviteUrl = `https://${inviteUrl}`;
  const gap = compact ? 12 : 13;
  const box = compact ? 28 : 30;
  return (
    <View
      style={{
        flexDirection: 'column',
        alignItems: 'stretch',
        gap,
        marginTop,
        borderRadius: compact ? 13 : 14,
        paddingVertical: compact ? 12 : 13,
        paddingHorizontal: compact ? 14 : 15,
        backgroundColor: tone.boxBg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: tone.boxBorder,
      }}
    >
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap, minWidth: 0 }}
      >
        <View
          style={{
            width: box,
            height: box,
            borderRadius: compact ? 8 : 9,
            flexShrink: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tone.iconBg,
            borderWidth: 1,
            borderColor: tone.iconBorder,
          }}
        >
          <LinkIcon size={compact ? 14 : 15} color={tone.icon} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={[
              rj.bold,
              { fontSize: cfs(compact ? 13 : 13.5), color: tone.title },
            ]}
          >
            {title}
          </Text>
          <Text
            style={[
              rj.semibold,
              {
                marginTop: 1,
                fontSize: cfs(compact ? 12 : 12.5),
                color: tone.meta,
              },
            ]}
          >
            <Text
              accessibilityRole="link"
              onPress={() => openExternal(fullInviteUrl)}
              style={{ textDecorationLine: 'underline' }}
            >
              {inviteUrl}
            </Text>{' '}
            · free for any parent
          </Text>
        </View>
      </View>
      <Pressable
        onPress={onCopy}
        accessibilityRole="button"
        accessibilityLabel="Copy join link"
        style={{
          flexShrink: 0,
          alignSelf: 'flex-end',
          paddingVertical: compact ? 7 : 8,
          paddingHorizontal: compact ? 14 : 15,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: tone.btnBorder,
          backgroundColor: 'transparent',
        }}
      >
        <Text style={[rj.bold, caps(cfs(10.5), 0.14), { color: tone.btnText }]}>
          Copy
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The 16:9 card attachment shown inside the WhatsApp / Twitter composers.
 * `narrowText` applies Twitter's 82% / 74% title / caption max widths.
 */
export function MiniShareCard({
  card,
  background,
  border,
  marginTop,
  narrowText = false,
}: {
  card: { kind: string; title: string; caption: string; date: string };
  background: string;
  border: string;
  marginTop: number;
  narrowText?: boolean;
}) {
  // Web: `aspect-ratio: 16/9; min-height: 200px` — the width stays 100% and
  // only the height grows. Yoga instead re-derives the width from the clamped
  // height (200 × 16/9 ≈ 356px), overflowing a phone-width panel, so compute
  // the height from the measured width rather than using aspectRatio.
  const [width, setWidth] = useState(0);
  return (
    <View
      accessible
      accessibilityLabel={`${card.kind} card: ${card.title}. ${card.caption}`}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      style={{
        marginTop,
        flexDirection: 'row',
        width: '100%',
        minWidth: 0,
        borderRadius: 14,
        height: Math.max(200, (width * 9) / 16),
        experimental_backgroundImage: background,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <View
        style={{
          flex: 1,
          minWidth: 0,
          paddingVertical: 16,
          paddingHorizontal: 18,
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: rgb('constellation-gold'),
                boxShadow: css('0 0 8px rgb(var(--constellation-gold-rgb))'),
              }}
            />
            <Text
              style={[
                rj.bold,
                caps(cfs(8.5), 0.2),
                { color: rgb('constellation-gold') },
              ]}
            >
              {card.kind}
            </Text>
          </View>
          <Text
            style={[
              rj.bold,
              caps(cfs(8.5), 0.16),
              { color: rgb('constellation-slate-mid') },
            ]}
          >
            {card.date}
          </Text>
        </View>
        <View>
          <Text
            style={[
              orb.black,
              {
                fontSize: cfs(17),
                lineHeight: 17 * 1.18,
                color: rgb('constellation-cyan-palest'),
                maxWidth: narrowText ? '82%' : undefined,
              },
            ]}
          >
            {card.title}
          </Text>
          <Text
            style={[
              rj.semibold,
              {
                marginTop: 7,
                fontSize: cfs(12),
                lineHeight: 12 * 1.4,
                color: rgb('constellation-caption'),
                maxWidth: narrowText ? '74%' : undefined,
              },
            ]}
          >
            {card.caption}
          </Text>
        </View>
        <Text
          style={[
            orb.black,
            {
              fontSize: cfs(9.5),
              letterSpacing: 9.5 * 0.14,
              color: rgb('constellation-cyan-palest'),
            },
          ]}
        >
          SUPERPOWER
        </Text>
      </View>
    </View>
  );
}

/** Pill button used for "Done" (outlined) and the plain text secondary action. */
export function PillButton({
  label,
  onPress,
  color,
  border,
  background,
  paddingHorizontal,
}: {
  label: string;
  onPress: () => void;
  color: string;
  border?: string;
  background?: string;
  paddingHorizontal: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        paddingVertical: 12,
        paddingHorizontal,
        borderRadius: 999,
        borderWidth: border ? 1 : 0,
        borderColor: border,
        backgroundColor: background ?? 'transparent',
      }}
    >
      <Text style={[rj.bold, caps(cfs(12.5), 0.16), { color }]}>{label}</Text>
    </Pressable>
  );
}

/** The centered "sent" confirmation: ringed tick, title, line, then actions. */
export function SentPanel({
  ring,
  tick,
  title,
  titleColor,
  line,
  lineColor,
  lineMaxWidth,
  children,
}: {
  ring: { background: string; border: string; shadow: string };
  tick: string;
  title: string;
  titleColor: string;
  line: string;
  lineColor: string;
  lineMaxWidth: number;
  children: ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 6 }}>
      <View
        style={{
          width: 66,
          height: 66,
          borderRadius: 33,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: ring.background,
          borderWidth: 1.5,
          borderColor: ring.border,
          boxShadow: ring.shadow,
        }}
      >
        <CheckTickIcon size={28} color={tick} opacity={1} />
      </View>
      <Text
        accessibilityRole="header"
        style={[
          orb.bold,
          {
            marginTop: 18,
            fontSize: cfs(19),
            color: titleColor,
            textAlign: 'center',
          },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          rj.semibold,
          {
            marginTop: 9,
            fontSize: cfs(15),
            color: lineColor,
            maxWidth: lineMaxWidth,
            textAlign: 'center',
          },
        ]}
      >
        {line}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 22,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** Small uppercase section label inside the modals (web 10.5px / .18em). */
export function SectionLabel({
  children,
  color,
  marginTop,
}: {
  children: ReactNode;
  color: string;
  marginTop?: number;
}) {
  return (
    <Text style={[rj.bold, caps(cfs(10.5), 0.18), { color, marginTop }]}>
      {children}
    </Text>
  );
}
