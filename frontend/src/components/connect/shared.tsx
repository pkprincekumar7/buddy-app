import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Multiplies a design-time pixel value by `--cx-type-scale`, which is 1 on phones
 * and 1.2 from the tablet breakpoint up (see the style block in the component).
 *
 * The design mockup for this page has NO media queries — every size is a fixed
 * pixel value at every width, with only the hero moving via its own clamp(). This
 * scaling is therefore a deliberate departure from it, matching what Observations
 * already does. Do not "restore mockup fidelity" here without checking that first.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const cfs = (px: number) => `calc(${px}px * var(--cx-type-scale, 1))`;

/**
 * Splits `text` on the first occurrence of `url` and renders that piece as a
 * real, clickable link — the rest stays plain text. Shared by every share
 * modal (WhatsApp, Instagram, ...) whose preview text embeds the invite URL
 * inside a longer message/caption, so only that substring should be a link.
 * `text` is a preview of a message the user is about to send elsewhere, not
 * something this app navigates internally, so it opens in a new tab rather
 * than leaving the share flow.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function linkifyUrl(text: string, url: string): ReactNode {
  const idx = text.indexOf(url);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'underline', overflowWrap: 'anywhere' }}
      >
        {url}
      </a>
      {text.slice(idx + url.length)}
    </>
  );
}

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

// eslint-disable-next-line react-refresh/only-export-components
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

// eslint-disable-next-line react-refresh/only-export-components
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

// eslint-disable-next-line react-refresh/only-export-components
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

// eslint-disable-next-line react-refresh/only-export-components
export const IG_BGS = [
  'linear-gradient(160deg,#2a1236,#0b0710)',
  'linear-gradient(160deg,rgb(var(--instagram-violet-rgb)),rgb(var(--instagram-violet-deep-rgb)))',
  'linear-gradient(160deg,#0f2a3a,#04121c)',
  'linear-gradient(160deg,rgb(var(--constellation-gold-rgb)),#8a5a1f)',
];

// eslint-disable-next-line react-refresh/only-export-components
export const TW_TAGS = ['#Superpower', '#ParentingWins', '#SmallWins'];
// eslint-disable-next-line react-refresh/only-export-components
export const TW_AUDIENCES = ['Everyone', 'Circle only'];
export const TW_MAX = 280;
export const TW_RING_CIRCUMFERENCE = 94.2;

export function WhatsAppIcon({
  size = 24,
  color = 'rgb(var(--whatsapp-bright-rgb))',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      style={{ width: size, height: size }}
    >
      <path d="M20.5 11.8a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 20.5 11.8z" />
      <path d="M8.8 8.4c.3-.6 1.3-.5 1.5 0l.6 1.4-.7 1a5 5 0 0 0 2.9 2.9l1-.7 1.4.6c.5.2.6 1.2 0 1.5-1.5.8-3.6.2-5.2-1.4s-2.3-3.8-1.5-5.3z" />
    </svg>
  );
}

export function InstagramIcon({
  size = 24,
  color = 'rgb(var(--instagram-pink-rgb))',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      style={{ width: size, height: size }}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1.1" fill={color} stroke="none" />
    </svg>
  );
}

export function TwitterIcon({
  size = 24,
  color = 'rgb(var(--twitter-sent-rgb))',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.9}
      style={{ width: size, height: size }}
    >
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export function LinkIcon({ size = 15, color }: { size?: number; color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <path d="M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.5 6" />
      <path d="M14 11a4 4 0 0 0-5.7 0L5.7 13.6a4 4 0 0 0 5.7 5.7L12.5 18" />
    </svg>
  );
}

export function CheckTickIcon({
  size = 11,
  color = 'rgb(var(--constellation-ink-rgb))',
  opacity = 1,
}: {
  size?: number;
  color?: string;
  opacity?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={3.2}
      style={{ width: size, height: size, opacity }}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function CloseIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      style={{ width: size, height: size }}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ShieldIcon({ size = 14, color = '#5c7688' }: { size?: number; color?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.9}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      style={{ width: size, height: size }}
    >
      <path d="M4 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      style={{ width: size, height: size }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function PencilIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      style={{ width: size, height: size }}
    >
      <path d="M4 20h4l10-10-4-4L4 16z" />
    </svg>
  );
}

export function ToastBanner({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      exit={{ opacity: 0, y: -8, x: '-50%' }}
      transition={{ duration: 0.3 }}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 34,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '14px 24px',
        borderRadius: 999,
        background: 'rgba(8,14,26,.95)',
        border: '1px solid rgb(var(--constellation-gold-rgb) / .45)',
        boxShadow: '0 20px 50px rgba(2,6,15,.8)',
      }}
    >
      <CheckTickIcon size={16} color="rgb(var(--constellation-gold-rgb))" opacity={1} />
      <div
        style={{
          fontWeight: 700,
          fontSize: cfs(14),
          letterSpacing: '.04em',
          color: 'rgb(var(--constellation-gold-pale-rgb))',
        }}
      >
        {message}
      </div>
    </motion.div>
  );
}

export function ModalBackdrop({
  gradient,
  onClose,
  children,
}: {
  gradient: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 26,
        background: gradient,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ position: 'relative', width: '100%', maxHeight: '100%', overflow: 'auto' }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function ModalCloseButton({
  onClick,
  color,
  border,
}: {
  onClick: () => void;
  color: string;
  border: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      style={{
        position: 'absolute',
        top: 16,
        right: 18,
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: `1px solid ${border}`,
        background: 'transparent',
        color,
      }}
    >
      <CloseIcon />
    </button>
  );
}
