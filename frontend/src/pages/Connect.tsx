import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { SPINNER } from '@/lib/animations';

/**
 * Multiplies a design-time pixel value by `--cx-type-scale`, which is 1 on phones
 * and 1.2 from the tablet breakpoint up (see the style block in the component).
 *
 * The design mockup for this page has NO media queries — every size is a fixed
 * pixel value at every width, with only the hero moving via its own clamp(). This
 * scaling is therefore a deliberate departure from it, matching what Observations
 * already does. Do not "restore mockup fidelity" here without checking that first.
 */
const cfs = (px: number) => `calc(${px}px * var(--cx-type-scale, 1))`;

const IC = {
  star: 'M12 3l2.2 5.6L20 9.4l-4 4 1 6-5-2.9-5 2.9 1-6-4-4 5.8-.8z',
  build: 'M15 4a4 4 0 0 0 5 5l-9 9a3 3 0 1 1-4-4z',
  mic: 'M12 4a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 12 4zM6 11a6 6 0 0 0 12 0M12 17v4',
  chart: 'M4 20V10M11 20V4M18 20v-7',
  school: 'M3 9l9-4 9 4-9 4zM7 12v4c0 1.5 2.2 3 5 3s5-1.5 5-3v-4',
  sport: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4.5 9h15M4.5 15h15M12 4c-2.5 4-2.5 12 0 16M12 4c2.5 4 2.5 12 0 16',
  friends: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c1-3.5 3.2-5.2 6-5.2S14 16.5 15 20M16 5.5a3 3 0 0 1 0 6M18 14.6c1.7.8 2.8 2.4 3.3 5.4',
  kind: 'M12 20s-7-4.4-7-9.3A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.7C19 15.6 12 20 12 20z',
};

interface AccomplishmentItem {
  kind: string;
  when: string;
  title: string;
  caption: string;
  icon: string;
}

const BASE_ITEMS: AccomplishmentItem[] = [
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

interface WaContact {
  name: string;
  meta: string;
  initials: string;
}

const WA_CONTACTS: WaContact[] = [
  { name: 'Family', meta: 'Group · 8 members', initials: 'FM' },
  { name: 'Grandparents', meta: 'Group · 4 members', initials: 'GP' },
  { name: 'Cousins', meta: 'Group · 11 members', initials: 'CZ' },
  { name: 'Class parents', meta: 'Group · 26 members', initials: 'CP' },
  { name: 'Coach Raghav', meta: 'Contact', initials: 'CR' },
];

interface IgDest {
  name: string;
  meta: string;
  ratio: string;
  cta: string;
  sent: string;
  line: string;
}

const IG_DESTS: IgDest[] = [
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

const IG_BGS = [
  'linear-gradient(160deg,#2a1236,#0b0710)',
  'linear-gradient(160deg,#f0a4d4,#8a3fd0)',
  'linear-gradient(160deg,#0f2a3a,#04121c)',
  'linear-gradient(160deg,#f0c98a,#8a5a1f)',
];

const TW_TAGS = ['#Superpower', '#ParentingWins', '#SmallWins'];
const TW_AUDIENCES = ['Everyone', 'Circle only'];
const TW_MAX = 280;
const TW_RING_CIRCUMFERENCE = 94.2;

function WhatsAppIcon({ size = 24, color = '#57dc96' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} style={{ width: size, height: size }}>
      <path d="M20.5 11.8a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 20.5 11.8z" />
      <path d="M8.8 8.4c.3-.6 1.3-.5 1.5 0l.6 1.4-.7 1a5 5 0 0 0 2.9 2.9l1-.7 1.4.6c.5.2.6 1.2 0 1.5-1.5.8-3.6.2-5.2-1.4s-2.3-3.8-1.5-5.3z" />
    </svg>
  );
}

function InstagramIcon({ size = 24, color = '#e278be' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} style={{ width: size, height: size }}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1.1" fill={color} stroke="none" />
    </svg>
  );
}

function TwitterIcon({ size = 24, color = '#cfe1ee' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} style={{ width: size, height: size }}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

function LinkIcon({ size = 15, color }: { size?: number; color: string }) {
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

function CheckTickIcon({
  size = 11,
  color = '#08131f',
  opacity = 1,
}: {
  size?: number;
  color?: string;
  opacity?: number;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3.2} style={{ width: size, height: size, opacity }}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function CloseIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} style={{ width: size, height: size }}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ShieldIcon({ size = 14, color = '#5c7688' }: { size?: number; color?: string }) {
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

function ArrowRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} style={{ width: size, height: size }}>
      <path d="M4 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ChevronDownIcon({ size = 10 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} style={{ width: size, height: size }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function PencilIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: size, height: size }}>
      <path d="M4 20h4l10-10-4-4L4 16z" />
    </svg>
  );
}

function ToastBanner({ message }: { message: string }) {
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
        border: '1px solid rgba(240,201,138,.45)',
        boxShadow: '0 20px 50px rgba(2,6,15,.8)',
      }}
    >
      <CheckTickIcon size={16} color="#f0c98a" opacity={1} />
      <div style={{ fontWeight: 700, fontSize: cfs(14), letterSpacing: '.04em', color: '#f5e6c4' }}>{message}</div>
    </motion.div>
  );
}

function AccomplishmentCardPreview({
  kind,
  title,
  caption,
  date,
  childName,
  childAge,
  inviteUrl,
}: {
  kind: string;
  title: string;
  caption: string;
  date: string;
  childName: string;
  childAge: string;
  inviteUrl: string;
}) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 24,
        overflow: 'hidden',
        aspectRatio: '4/5',
        background: 'linear-gradient(165deg,#16233b,#070b15)',
        border: '1px solid rgba(240,201,138,.38)',
        boxShadow: '0 30px 80px rgba(2,6,15,.75)',
      }}
    >
      <svg
        viewBox="0 0 360 450"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}
      >
        <path
          d="M32 286 L100 234 L160 260 L222 198 L286 224 L330 168"
          fill="none"
          stroke="rgba(240,201,138,.35)"
          strokeWidth={1}
        />
        <circle cx="32" cy="286" r="3" fill="#f0c98a" />
        <circle cx="100" cy="234" r="3" fill="#f0c98a" />
        <circle cx="160" cy="260" r="3" fill="#f0c98a" />
        <circle cx="222" cy="198" r="3" fill="#f0c98a" />
        <circle cx="286" cy="224" r="3" fill="#f0c98a" />
        <circle cx="330" cy="168" r="4.5" fill="#f0c98a" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, padding: 28, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#f0c98a', boxShadow: '0 0 12px #f0c98a' }} />
            <div style={{ fontWeight: 700, fontSize: cfs(10), letterSpacing: '.24em', textTransform: 'uppercase', color: '#f0c98a' }}>
              {kind}
            </div>
          </div>
          <div style={{ fontWeight: 700, fontSize: cfs(10), letterSpacing: '.16em', textTransform: 'uppercase', color: '#7e97a8' }}>
            {date}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: cfs(12), letterSpacing: '.2em', textTransform: 'uppercase', color: '#7e97a8' }}>
            {childName}
            {childAge && ` · Age ${childAge}`}
          </div>
          <div style={{ marginTop: 10, fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: cfs(26), lineHeight: 1.16, color: '#f7fdff' }}>
            {title}
          </div>
          <div style={{ marginTop: 12, fontSize: cfs(15.5), fontWeight: 600, lineHeight: 1.45, color: '#b9cedb' }}>{caption}</div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            paddingTop: 16,
            borderTop: '1px solid rgba(240,201,138,.22)',
          }}
        >
          <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: cfs(12), letterSpacing: '.14em', color: '#f7fdff', whiteSpace: 'nowrap' }}>
            SUPERPOWER
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: cfs(9.5),
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: '#f0c98a',
              textAlign: 'right',
              lineHeight: 1.35,
              // The invite URL is one long unbreakable token, and a flex item
              // defaults to min-width:auto — so it refused to shrink, pushed this
              // row past the card, and the card's overflow:hidden clipped the URL
              // to "…/JOIN/RAH". On a card whose whole purpose is being shared,
              // a truncated join link is a broken feature, not a cosmetic issue.
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            Join free
            <br />
            {inviteUrl}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccomplishmentRow({
  item,
  active,
  onPick,
}: {
  item: AccomplishmentItem;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onPick();
      }}
      style={{
        cursor: 'pointer',
        display: 'grid',
        gridTemplateColumns: '38px 1fr auto',
        gap: 14,
        alignItems: 'center',
        borderRadius: 15,
        padding: '15px 17px',
        background: active ? 'linear-gradient(150deg,rgba(38,54,82,.9),rgba(8,13,24,.8))' : 'rgba(9,13,22,.6)',
        border: `1px solid ${active ? 'rgba(240,201,138,.55)' : 'rgba(75,233,255,.12)'}`,
        transition: 'all .22s ease',
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(150deg,#1c2b46,#0a1220)',
          border: '1.5px solid rgba(240,201,138,.55)',
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#f0c98a" strokeWidth={1.8} style={{ width: 18, height: 18 }}>
          <path d={item.icon} />
        </svg>
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: cfs(15.5), color: '#eafdff' }}>{item.title}</div>
        <div style={{ marginTop: 2, fontWeight: 600, fontSize: cfs(13.5), color: '#8ba1b1' }}>{item.caption}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: cfs(10), letterSpacing: '.16em', textTransform: 'uppercase', color: '#6f8a9c', whiteSpace: 'nowrap' }}>
          {item.when}
        </div>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: `1.5px solid ${active ? '#f0c98a' : 'rgba(120,145,165,.4)'}`,
            background: active ? '#f0c98a' : 'transparent',
            transition: 'all .2s ease',
          }}
        />
      </div>
    </div>
  );
}

function ModalBackdrop({
  gradient,
  onClose,
  children,
}: {
  gradient: string;
  onClose: () => void;
  children: React.ReactNode;
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

function ModalCloseButton({ onClick, color, border }: { onClick: () => void; color: string; border: string }) {
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

interface WhatsAppModalProps {
  mode: 'compose' | 'sent';
  childName: string;
  title: string;
  message: string;
  onMessageChange: (v: string) => void;
  contacts: WaContact[];
  picked: number[];
  onTogglePicked: (i: number) => void;
  inviteUrl: string;
  onCopyInvite: () => void;
  onSend: () => void;
  onClose: () => void;
  sentLine: string;
}

function WhatsAppModal({
  mode,
  childName,
  title,
  message,
  onMessageChange,
  contacts,
  picked,
  onTogglePicked,
  inviteUrl,
  onCopyInvite,
  onSend,
  onClose,
  sentLine,
}: WhatsAppModalProps) {
  const disabled = picked.length === 0;
  const count =
    picked.length === 0 ? 'Choose at least one' : `${picked.length} ${picked.length === 1 ? 'chat selected' : 'chats selected'}`;

  return (
    <ModalBackdrop gradient="radial-gradient(ellipse at 50% 40%,rgba(8,14,26,.72),rgba(2,3,9,.94) 72%)" onClose={onClose}>
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          borderRadius: 22,
          padding: '26px 28px 24px',
          background: 'linear-gradient(165deg,rgba(16,32,26,.97),rgba(7,12,14,.97))',
          border: '1px solid rgba(80,220,150,.35)',
          boxShadow: '0 30px 90px rgba(2,8,6,.8)',
        }}
      >
        <ModalCloseButton onClick={onClose} color="#8fbfa8" border="rgba(80,220,150,.28)" />

        {mode === 'compose' ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(150deg,rgba(18,42,32,.95),rgba(8,16,14,.95))',
                  border: '1.5px solid rgba(80,220,150,.5)',
                }}
              >
                <WhatsAppIcon size={19} />
              </div>
              <div>
                <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: cfs(17), color: '#eafff4' }}>
                  Share on WhatsApp
                </div>
                <div style={{ marginTop: 2, fontWeight: 600, fontSize: cfs(13.5), color: '#8fbfa8' }}>
                  {childName}&rsquo;s card, ready to go
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                marginTop: 20,
                borderRadius: 16,
                padding: 14,
                background: 'rgba(5,12,10,.6)',
                border: '1px solid rgba(80,220,150,.16)',
              }}
            >
              <div
                style={{
                  width: 74,
                  height: 92,
                  flexShrink: 0,
                  borderRadius: 10,
                  overflow: 'hidden',
                  position: 'relative',
                  background: 'linear-gradient(165deg,#16233b,#070b15)',
                  border: '1px solid rgba(240,201,138,.35)',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, padding: 8, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#f0c98a', boxShadow: '0 0 7px #f0c98a' }} />
                  <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: cfs(6.5), lineHeight: 1.25, color: '#f7fdff' }}>
                    {title}
                  </div>
                  <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: cfs(4.5), letterSpacing: '.1em', color: 'rgba(247,253,255,.75)' }}>
                    SUPERPOWER
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: cfs(10.5), letterSpacing: '.18em', textTransform: 'uppercase', color: '#6f9a86' }}>
                  Message
                </div>
                <textarea
                  value={message}
                  onChange={(e) => onMessageChange(e.target.value)}
                  rows={4}
                  style={{
                    marginTop: 7,
                    width: '100%',
                    resize: 'none',
                    borderRadius: 11,
                    padding: '11px 13px',
                    background: 'rgba(4,10,8,.85)',
                    border: '1px solid rgba(80,220,150,.24)',
                    outline: 'none',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 600,
                    fontSize: cfs(14.5),
                    lineHeight: 1.5,
                    color: '#eafff4',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 13,
                marginTop: 12,
                borderRadius: 14,
                padding: '13px 15px',
                background: 'rgba(80,220,150,.07)',
                border: '1px dashed rgba(80,220,150,.35)',
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(80,220,150,.14)',
                  border: '1px solid rgba(80,220,150,.3)',
                }}
              >
                <LinkIcon color="#57dc96" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: cfs(13.5), color: '#eafff4' }}>Join Superpower link included</div>
                <div style={{ marginTop: 1, fontWeight: 600, fontSize: cfs(12.5), color: '#7ba894' }}>
                  {inviteUrl} · free for any parent
                </div>
              </div>
              <button
                type="button"
                onClick={onCopyInvite}
                style={{
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: '8px 15px',
                  borderRadius: 999,
                  border: '1px solid rgba(80,220,150,.45)',
                  background: 'transparent',
                  fontWeight: 700,
                  fontSize: cfs(10.5),
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: '#a9ecc8',
                }}
              >
                Copy
              </button>
            </div>

            <div style={{ marginTop: 20, fontWeight: 700, fontSize: cfs(10.5), letterSpacing: '.18em', textTransform: 'uppercase', color: '#6f9a86' }}>
              Send to
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 11 }}>
              {contacts.map((c, i) => {
                const on = picked.includes(i);
                return (
                  <div
                    key={c.name}
                    role="checkbox"
                    aria-checked={on}
                    tabIndex={0}
                    onClick={() => onTogglePicked(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onTogglePicked(i);
                    }}
                    style={{
                      cursor: 'pointer',
                      display: 'grid',
                      gridTemplateColumns: '34px 1fr 20px',
                      gap: 12,
                      alignItems: 'center',
                      borderRadius: 13,
                      padding: '11px 14px',
                      background: on ? 'rgba(80,220,150,.10)' : 'rgba(5,12,10,.6)',
                      border: `1px solid ${on ? 'rgba(80,220,150,.5)' : 'rgba(80,220,150,.14)'}`,
                      transition: 'all .2s ease',
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(80,220,150,.12)',
                        border: '1px solid rgba(80,220,150,.3)',
                        fontFamily: 'Orbitron, sans-serif',
                        fontWeight: 700,
                        fontSize: cfs(12),
                        color: '#8fe3b8',
                      }}
                    >
                      {c.initials}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: cfs(14.5), color: '#eafff4' }}>{c.name}</div>
                      <div style={{ marginTop: 1, fontWeight: 600, fontSize: cfs(12.5), color: '#7ba894' }}>{c.meta}</div>
                    </div>
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: `1.5px solid ${on ? '#57dc96' : 'rgba(140,180,165,.4)'}`,
                        background: on ? '#57dc96' : 'transparent',
                        transition: 'all .2s ease',
                      }}
                    >
                      <CheckTickIcon size={11} color="#052015" opacity={on ? 1 : 0} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 22 }}>
              <div style={{ fontWeight: 700, fontSize: cfs(12), letterSpacing: '.1em', textTransform: 'uppercase', color: '#6f9a86' }}>
                {count}
              </div>
              <button
                type="button"
                onClick={onSend}
                disabled={disabled}
                style={{
                  cursor: disabled ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '13px 28px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'linear-gradient(135deg,#57dc96,#2aa96f)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(13),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#04140d',
                  boxShadow: '0 0 26px rgba(80,220,150,.4)',
                  opacity: disabled ? 0.4 : 1,
                  pointerEvents: disabled ? 'none' : 'auto',
                }}
              >
                Send
                <ArrowRightIcon />
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
            <div
              style={{
                width: 66,
                height: 66,
                margin: '0 auto',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(80,220,150,.14)',
                border: '1.5px solid rgba(80,220,150,.55)',
                boxShadow: '0 0 30px rgba(80,220,150,.25)',
              }}
            >
              <CheckTickIcon size={28} color="#57dc96" opacity={1} />
            </div>
            <div style={{ marginTop: 18, fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: cfs(19), color: '#eafff4' }}>
              Sent on WhatsApp
            </div>
            <div style={{ marginTop: 9, fontSize: cfs(15), fontWeight: 600, color: '#8fbfa8', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
              {sentLine}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                cursor: 'pointer',
                marginTop: 22,
                padding: '12px 30px',
                borderRadius: 999,
                border: '1px solid rgba(80,220,150,.45)',
                background: 'rgba(6,16,12,.8)',
                fontFamily: 'Rajdhani, sans-serif',
                fontWeight: 700,
                fontSize: cfs(12.5),
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: '#a9ecc8',
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

interface InstagramModalProps {
  mode: 'compose' | 'sent';
  handle: string;
  childName: string;
  cardKind: string;
  cardTitle: string;
  cardCaption: string;
  backdrop: string;
  backgrounds: string[];
  activeBg: number;
  onPickBg: (i: number) => void;
  destinations: IgDest[];
  activeDest: number;
  onPickDest: (i: number) => void;
  capLabel: string;
  capValue: string;
  onCapChange: (v: string) => void;
  linkLabel: string;
  inviteUrl: string;
  onCopyInvite: () => void;
  cta: string;
  ratio: string;
  onShare: () => void;
  onClose: () => void;
  onBack: () => void;
  sentTitle: string;
  sentLine: string;
}

function InstagramModal({
  mode,
  handle,
  childName,
  cardKind,
  cardTitle,
  cardCaption,
  backdrop,
  backgrounds,
  activeBg,
  onPickBg,
  destinations,
  activeDest,
  onPickDest,
  capLabel,
  capValue,
  onCapChange,
  linkLabel,
  inviteUrl,
  onCopyInvite,
  cta,
  ratio,
  onShare,
  onClose,
  onBack,
  sentTitle,
  sentLine,
}: InstagramModalProps) {
  return (
    <ModalBackdrop gradient="radial-gradient(ellipse at 50% 40%,rgba(26,12,30,.72),rgba(4,2,8,.94) 72%)" onClose={onClose}>
      <div
        style={{
          maxWidth: 680,
          margin: '0 auto',
          borderRadius: 22,
          padding: '26px 28px 24px',
          background: 'linear-gradient(165deg,rgba(34,18,40,.97),rgba(11,7,14,.97))',
          border: '1px solid rgba(226,120,190,.35)',
          boxShadow: '0 30px 90px rgba(8,2,10,.8)',
        }}
      >
        <ModalCloseButton onClick={onClose} color="#c691b4" border="rgba(226,120,190,.28)" />

        {mode === 'compose' ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(150deg,rgba(58,26,62,.95),rgba(16,10,20,.95))',
                  border: '1.5px solid rgba(226,120,190,.5)',
                }}
              >
                <InstagramIcon size={19} />
              </div>
              <div>
                <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: cfs(17), color: '#fbe8f5' }}>
                  Share to Instagram
                </div>
                <div style={{ marginTop: 2, fontWeight: 600, fontSize: cfs(13.5), color: '#c691b4' }}>Posting as {handle}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '214px 1fr', gap: 22, marginTop: 20, alignItems: 'start' }}>
              <div>
                <div
                  style={{
                    position: 'relative',
                    width: 214,
                    aspectRatio: '9/16',
                    borderRadius: 18,
                    overflow: 'hidden',
                    background: backdrop,
                    border: '1px solid rgba(226,120,190,.3)',
                  }}
                >
                  <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ flex: 1, height: 2.5, borderRadius: 2, background: 'rgba(255,255,255,.85)' }} />
                    <div style={{ flex: 1, height: 2.5, borderRadius: 2, background: 'rgba(255,255,255,.28)' }} />
                  </div>
                  <div style={{ position: 'absolute', top: 26, left: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div
                      style={{
                        width: 19,
                        height: 19,
                        borderRadius: '50%',
                        background: 'radial-gradient(circle at 35% 30%,#eafdff,#4be9ff 45%,#0a5b74 100%)',
                      }}
                    />
                    <div style={{ fontWeight: 700, fontSize: cfs(9.5), letterSpacing: '.06em', color: 'rgba(255,255,255,.92)' }}>
                      {handle}
                    </div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: 16,
                      right: 16,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      borderRadius: 13,
                      overflow: 'hidden',
                      aspectRatio: '4/5',
                      background: 'linear-gradient(165deg,#16233b,#070b15)',
                      border: '1px solid rgba(240,201,138,.45)',
                      boxShadow: '0 14px 34px rgba(2,4,12,.6)',
                    }}
                  >
                    <div style={{ position: 'absolute', inset: 0, padding: 13, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#f0c98a', boxShadow: '0 0 7px #f0c98a' }} />
                        <div style={{ fontWeight: 700, fontSize: cfs(6), letterSpacing: '.2em', textTransform: 'uppercase', color: '#f0c98a' }}>
                          {cardKind}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: cfs(11), lineHeight: 1.2, color: '#f7fdff' }}>
                          {cardTitle}
                        </div>
                        <div style={{ marginTop: 5, fontWeight: 600, fontSize: cfs(7.5), lineHeight: 1.4, color: '#b9cedb' }}>
                          {cardCaption}
                        </div>
                      </div>
                      <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: cfs(6), letterSpacing: '.14em', color: '#f7fdff' }}>
                        SUPERPOWER
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: 16,
                      right: 16,
                      bottom: 50,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 9,
                      background: 'rgba(10,6,12,.78)',
                      border: '1px solid rgba(255,255,255,.35)',
                    }}
                  >
                    <LinkIcon size={9} color="rgba(255,255,255,.9)" />
                    <div style={{ fontWeight: 700, fontSize: cfs(8), letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.95)' }}>
                      Join Superpower
                    </div>
                  </div>
                  <div style={{ position: 'absolute', left: 12, right: 12, bottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, borderRadius: 999, padding: '8px 12px', border: '1px solid rgba(255,255,255,.4)', fontWeight: 600, fontSize: cfs(9.5), color: 'rgba(255,255,255,.75)' }}>
                      Send message
                    </div>
                    <div style={{ width: 15, height: 15, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.6)' }} />
                  </div>
                </div>
                <div style={{ marginTop: 10, textAlign: 'center', fontWeight: 700, fontSize: cfs(10), letterSpacing: '.18em', textTransform: 'uppercase', color: '#9a7590' }}>
                  {ratio}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, fontSize: cfs(10.5), letterSpacing: '.18em', textTransform: 'uppercase', color: '#a2769a' }}>
                  Where it goes
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 11 }}>
                  {destinations.map((d, i) => {
                    const on = activeDest === i;
                    return (
                      <div
                        key={d.name}
                        role="button"
                        tabIndex={0}
                        onClick={() => onPickDest(i)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') onPickDest(i);
                        }}
                        style={{
                          cursor: 'pointer',
                          borderRadius: 13,
                          padding: '12px 13px',
                          background: on ? 'rgba(226,120,190,.14)' : 'rgba(10,5,12,.6)',
                          border: `1px solid ${on ? 'rgba(226,120,190,.6)' : 'rgba(226,120,190,.14)'}`,
                          transition: 'all .2s ease',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: cfs(13.5), color: on ? '#fbe8f5' : '#d7b6cd' }}>{d.name}</div>
                        <div style={{ marginTop: 2, fontWeight: 600, fontSize: cfs(11.5), color: '#9a7590' }}>{d.meta}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 18, fontWeight: 700, fontSize: cfs(10.5), letterSpacing: '.18em', textTransform: 'uppercase', color: '#a2769a' }}>
                  Backdrop
                </div>
                <div style={{ display: 'flex', gap: 9, marginTop: 11 }}>
                  {backgrounds.map((swatch, i) => (
                    <div
                      key={swatch}
                      role="button"
                      tabIndex={0}
                      onClick={() => onPickBg(i)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') onPickBg(i);
                      }}
                      style={{
                        cursor: 'pointer',
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        background: swatch,
                        border: `2px solid ${activeBg === i ? '#e278be' : 'rgba(226,120,190,.2)'}`,
                        transition: 'all .2s ease',
                      }}
                    />
                  ))}
                </div>

                <div style={{ marginTop: 18, fontWeight: 700, fontSize: cfs(10.5), letterSpacing: '.18em', textTransform: 'uppercase', color: '#a2769a' }}>
                  {capLabel}
                </div>
                <textarea
                  value={capValue}
                  onChange={(e) => onCapChange(e.target.value)}
                  rows={3}
                  style={{
                    marginTop: 7,
                    width: '100%',
                    resize: 'none',
                    borderRadius: 11,
                    padding: '11px 13px',
                    background: 'rgba(10,5,12,.85)',
                    border: '1px solid rgba(226,120,190,.24)',
                    outline: 'none',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 600,
                    fontSize: cfs(14.5),
                    lineHeight: 1.5,
                    color: '#fbe8f5',
                  }}
                />

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 13,
                    marginTop: 12,
                    borderRadius: 14,
                    padding: '13px 15px',
                    background: 'rgba(226,120,190,.07)',
                    border: '1px dashed rgba(226,120,190,.35)',
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(226,120,190,.14)',
                      border: '1px solid rgba(226,120,190,.3)',
                    }}
                  >
                    <LinkIcon color="#e278be" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: cfs(13.5), color: '#fbe8f5' }}>{linkLabel}</div>
                    <div style={{ marginTop: 1, fontWeight: 600, fontSize: cfs(12.5), color: '#9a7590' }}>
                      {inviteUrl} · free for any parent
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onCopyInvite}
                    style={{
                      cursor: 'pointer',
                      flexShrink: 0,
                      padding: '8px 15px',
                      borderRadius: 999,
                      border: '1px solid rgba(226,120,190,.45)',
                      background: 'transparent',
                      fontWeight: 700,
                      fontSize: cfs(10.5),
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                      color: '#f0b6dc',
                    }}
                  >
                    Copy
                  </button>
                </div>

                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldIcon size={13} color="#8a6a82" />
                  <div style={{ fontWeight: 600, fontSize: cfs(12), color: '#8a6a82' }}>
                    {childName}&rsquo;s face and full name stay off the card.
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 20 }}>
                  <button
                    type="button"
                    onClick={onShare}
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '13px 28px',
                      borderRadius: 999,
                      border: 'none',
                      background: 'linear-gradient(135deg,#f0a4d4,#c2429a 55%,#8a3fd0)',
                      fontFamily: 'Rajdhani, sans-serif',
                      fontWeight: 700,
                      fontSize: cfs(13),
                      letterSpacing: '.16em',
                      textTransform: 'uppercase',
                      color: '#1a0715',
                      boxShadow: '0 0 26px rgba(226,120,190,.38)',
                    }}
                  >
                    {cta}
                    <ArrowRightIcon />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
            <div
              style={{
                width: 66,
                height: 66,
                margin: '0 auto',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(226,120,190,.14)',
                border: '1.5px solid rgba(226,120,190,.55)',
                boxShadow: '0 0 30px rgba(226,120,190,.25)',
              }}
            >
              <CheckTickIcon size={28} color="#e278be" opacity={1} />
            </div>
            <div style={{ marginTop: 18, fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: cfs(19), color: '#fbe8f5' }}>
              {sentTitle}
            </div>
            <div style={{ marginTop: 9, fontSize: cfs(15), fontWeight: 600, color: '#c691b4', maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
              {sentLine}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 22 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  cursor: 'pointer',
                  padding: '12px 30px',
                  borderRadius: 999,
                  border: '1px solid rgba(226,120,190,.45)',
                  background: 'rgba(18,8,16,.8)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#f0b6dc',
                }}
              >
                Done
              </button>
              <button
                type="button"
                onClick={onBack}
                style={{
                  cursor: 'pointer',
                  padding: '12px 22px',
                  border: 'none',
                  background: 'transparent',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#9a7590',
                }}
              >
                Share again
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

interface TwitterTagOption {
  label: string;
  active: boolean;
  onToggle: () => void;
}

interface TwitterModalProps {
  mode: 'compose' | 'sent';
  handle: string;
  text: string;
  onTextChange: (v: string) => void;
  audience: string;
  onToggleAudience: () => void;
  tags: TwitterTagOption[];
  cardKind: string;
  cardTitle: string;
  cardCaption: string;
  cardDate: string;
  inviteUrl: string;
  onCopyInvite: () => void;
  left: number;
  ringColor: string;
  ringOffset: number;
  postDisabled: boolean;
  onPost: () => void;
  onClose: () => void;
  onBack: () => void;
  sentLine: string;
}

function TwitterModal({
  mode,
  handle,
  text,
  onTextChange,
  audience,
  onToggleAudience,
  tags,
  cardKind,
  cardTitle,
  cardCaption,
  cardDate,
  inviteUrl,
  onCopyInvite,
  left,
  ringColor,
  ringOffset,
  postDisabled,
  onPost,
  onClose,
  onBack,
  sentLine,
}: TwitterModalProps) {
  return (
    <ModalBackdrop gradient="radial-gradient(ellipse at 50% 40%,rgba(12,18,26,.72),rgba(2,4,8,.94) 72%)" onClose={onClose}>
      <div
        style={{
          maxWidth: 580,
          margin: '0 auto',
          borderRadius: 22,
          padding: '26px 28px 24px',
          background: 'linear-gradient(165deg,rgba(19,25,35,.97),rgba(7,9,14,.97))',
          border: '1px solid rgba(180,205,225,.3)',
          boxShadow: '0 30px 90px rgba(2,5,10,.8)',
        }}
      >
        <ModalCloseButton onClick={onClose} color="#9fb3c4" border="rgba(180,205,225,.24)" />

        {mode === 'compose' ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(150deg,rgba(28,38,52,.95),rgba(8,11,17,.95))',
                  border: '1.5px solid rgba(180,205,225,.45)',
                }}
              >
                <TwitterIcon size={18} />
              </div>
              <div>
                <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: cfs(17), color: '#eaf3fa' }}>
                  Post on Twitter
                </div>
                <div style={{ marginTop: 2, fontWeight: 600, fontSize: cfs(13.5), color: '#9fb3c4' }}>{handle}</div>
              </div>
            </div>

            <div
              style={{
                marginTop: 20,
                borderRadius: 16,
                padding: '16px 17px',
                background: 'rgba(6,9,14,.7)',
                border: '1px solid rgba(180,205,225,.14)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 13 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle at 35% 30%,#eafdff,#4be9ff 45%,#0a5b74 100%)',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={onToggleAudience}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onToggleAudience();
                    }}
                    style={{
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '5px 13px',
                      borderRadius: 999,
                      border: '1px solid rgba(120,190,235,.5)',
                      fontWeight: 700,
                      fontSize: cfs(10.5),
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                      color: '#8fd0f5',
                    }}
                  >
                    {audience}
                    <ChevronDownIcon />
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => onTextChange(e.target.value)}
                    rows={4}
                    style={{
                      marginTop: 11,
                      width: '100%',
                      resize: 'none',
                      border: 'none',
                      background: 'transparent',
                      outline: 'none',
                      fontFamily: 'Rajdhani, sans-serif',
                      fontWeight: 600,
                      fontSize: cfs(17),
                      lineHeight: 1.45,
                      color: '#eaf3fa',
                    }}
                  />

                  <div
                    style={{
                      marginTop: 6,
                      position: 'relative',
                      borderRadius: 14,
                      overflow: 'hidden',
                      aspectRatio: '16/9',
                      background: 'linear-gradient(120deg,#0e1626,#070b15)',
                      border: '1px solid rgba(180,205,225,.2)',
                    }}
                  >
                    <div style={{ position: 'absolute', inset: 0, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f0c98a', boxShadow: '0 0 8px #f0c98a' }} />
                          <div style={{ fontWeight: 700, fontSize: cfs(8.5), letterSpacing: '.2em', textTransform: 'uppercase', color: '#f0c98a' }}>
                            {cardKind}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: cfs(8.5), letterSpacing: '.16em', textTransform: 'uppercase', color: '#7e97a8' }}>
                          {cardDate}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: cfs(17), lineHeight: 1.18, color: '#f7fdff', maxWidth: '82%' }}>
                          {cardTitle}
                        </div>
                        <div style={{ marginTop: 7, fontWeight: 600, fontSize: cfs(12), lineHeight: 1.4, color: '#b9cedb', maxWidth: '74%' }}>
                          {cardCaption}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: cfs(9.5), letterSpacing: '.14em', color: '#f7fdff' }}>
                          SUPERPOWER
                        </div>
                        <div style={{ fontWeight: 700, fontSize: cfs(8.5), letterSpacing: '.14em', textTransform: 'uppercase', color: '#7e97a8' }}>
                          superpower.app
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 7, fontWeight: 600, fontSize: cfs(12), color: '#7d92a4' }}>
                    Card attached as an image · alt text added automatically
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      marginTop: 11,
                      borderRadius: 13,
                      padding: '12px 14px',
                      background: 'rgba(143,208,245,.06)',
                      border: '1px dashed rgba(143,208,245,.32)',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(143,208,245,.12)',
                        border: '1px solid rgba(143,208,245,.28)',
                      }}
                    >
                      <LinkIcon size={14} color="#8fd0f5" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: cfs(13), color: '#eaf3fa' }}>Join Superpower link in the post</div>
                      <div style={{ marginTop: 1, fontWeight: 600, fontSize: cfs(12), color: '#7d92a4' }}>
                        {inviteUrl} · free for any parent
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onCopyInvite}
                      style={{
                        cursor: 'pointer',
                        flexShrink: 0,
                        padding: '7px 14px',
                        borderRadius: 999,
                        border: '1px solid rgba(143,208,245,.42)',
                        background: 'transparent',
                        fontWeight: 700,
                        fontSize: cfs(10.5),
                        letterSpacing: '.14em',
                        textTransform: 'uppercase',
                        color: '#bfe3fa',
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {tags.map((t) => (
                <div
                  key={t.label}
                  role="button"
                  tabIndex={0}
                  onClick={t.onToggle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') t.onToggle();
                  }}
                  style={{
                    cursor: 'pointer',
                    padding: '8px 14px',
                    borderRadius: 999,
                    background: t.active ? 'rgba(143,208,245,.14)' : 'rgba(6,9,14,.7)',
                    border: `1px solid ${t.active ? 'rgba(143,208,245,.55)' : 'rgba(180,205,225,.16)'}`,
                    fontWeight: 700,
                    fontSize: cfs(12),
                    letterSpacing: '.04em',
                    color: t.active ? '#bfe3fa' : '#8fa5b6',
                    transition: 'all .2s ease',
                  }}
                >
                  {t.label}
                </div>
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid rgba(180,205,225,.14)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ position: 'relative', width: 26, height: 26, flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ width: 26, height: 26, transform: 'rotate(-90deg)' }}>
                    <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(180,205,225,.2)" strokeWidth={3.4} />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke={ringColor}
                      strokeWidth={3.4}
                      strokeLinecap="round"
                      strokeDasharray={TW_RING_CIRCUMFERENCE}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                </div>
                <div style={{ fontWeight: 700, fontSize: cfs(13), color: ringColor }}>{left}</div>
              </div>
              <button
                type="button"
                onClick={onPost}
                disabled={postDisabled}
                style={{
                  cursor: postDisabled ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '13px 30px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'linear-gradient(135deg,#eaf3fa,#a9c4d8)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(13),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#0a1017',
                  boxShadow: '0 0 26px rgba(180,205,225,.25)',
                  opacity: postDisabled ? 0.4 : 1,
                  pointerEvents: postDisabled ? 'none' : 'auto',
                }}
              >
                Post
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
            <div
              style={{
                width: 66,
                height: 66,
                margin: '0 auto',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(180,205,225,.12)',
                border: '1.5px solid rgba(180,205,225,.5)',
                boxShadow: '0 0 30px rgba(180,205,225,.2)',
              }}
            >
              <CheckTickIcon size={28} color="#cfe1ee" opacity={1} />
            </div>
            <div style={{ marginTop: 18, fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: cfs(19), color: '#eaf3fa' }}>
              Posted on Twitter
            </div>
            <div style={{ marginTop: 9, fontSize: cfs(15), fontWeight: 600, color: '#9fb3c4', maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
              {sentLine}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 22 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  cursor: 'pointer',
                  padding: '12px 30px',
                  borderRadius: 999,
                  border: '1px solid rgba(180,205,225,.4)',
                  background: 'rgba(10,14,20,.8)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#cfe1ee',
                }}
              >
                Done
              </button>
              <button
                type="button"
                onClick={onBack}
                style={{
                  cursor: 'pointer',
                  padding: '12px 22px',
                  border: 'none',
                  background: 'transparent',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#7d92a4',
                }}
              >
                Edit and repost
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

type ItemEdits = Partial<Record<'title' | 'caption', string>>;

export default function Connect() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          void navigate('/Home', { replace: true });
          return;
        }
        setChildName(child.name ?? '');
        setChildAge(child.age != null ? String(child.age) : '');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const [isNarrow, setIsNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 860 : false));
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 860);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const items = useMemo(
    () =>
      BASE_ITEMS.map((it) =>
        it.title.includes('{name}') ? { ...it, title: it.title.replace('{name}', childName || 'Your child') } : it,
      ),
    [childName],
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<number, ItemEdits>>({});

  const currentItem = items[activeIndex] ?? items[0]!;
  const currentEdit = edits[activeIndex] ?? {};
  const title = currentEdit.title ?? currentItem.title;
  const caption = currentEdit.caption ?? currentItem.caption;
  const touched = currentEdit.title !== undefined || currentEdit.caption !== undefined;

  const editField = (field: 'title' | 'caption', value: string) => {
    setEdits((prev) => ({ ...prev, [activeIndex]: { ...prev[activeIndex], [field]: value } }));
  };
  const resetCard = () => {
    if (!touched) return;
    setEdits((prev) => {
      const next = { ...prev };
      delete next[activeIndex];
      return next;
    });
  };

  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(''), 2400);
  };
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const nameSlug = (childName || 'friend').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'friend';
  const inviteUrl = `superpower.app/join/${nameSlug}`;
  const inviteLine = `Join Superpower and see your own child’s growth: https://${inviteUrl}`;
  const handle = `@${nameSlug}.parent`;

  const copyInvite = () => {
    void navigator.clipboard?.writeText(`https://${inviteUrl}`).catch(() => {});
    showToast('Join link copied');
  };

  const cardDate = useMemo(
    () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    [],
  );

  // WhatsApp share flow
  const [wa, setWa] = useState<'compose' | 'sent' | null>(null);
  const [waMsg, setWaMsg] = useState<string | null>(null);
  const [waPicked, setWaPicked] = useState<number[]>([0]);
  const waDefaultMsg = `${title} — ${caption}\n\n${inviteLine}`;
  const waMsgValue = waMsg ?? waDefaultMsg;
  const waSentLine = `${waPicked
    .map((i) => WA_CONTACTS[i]?.name)
    .filter(Boolean)
    .join(', ')} will see it in a moment.`;
  const shareWa = () => {
    setWa('compose');
    setWaMsg(null);
    setWaPicked([0]);
  };
  const waClose = () => {
    setWa(null);
    setWaMsg(null);
  };
  const toggleWaPicked = (i: number) =>
    setWaPicked((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  // Instagram share flow
  const [ig, setIg] = useState<'compose' | 'sent' | null>(null);
  const [igDest, setIgDest] = useState(0);
  const [igBg, setIgBg] = useState(0);
  const [igCap, setIgCap] = useState<string | null>(null);
  const igDefaultCap = `${caption}\n\n${title}. Proud of them.\n\n${inviteLine}`;
  const igCapValue = igCap ?? igDefaultCap;
  const igCapLabel = igDest === 3 ? 'Message' : 'Caption';
  const igLinkLabel =
    igDest < 2
      ? 'Join Superpower link sticker added'
      : igDest === 3
        ? 'Join link included in the message'
        : 'Join link included in the caption';
  const shareIg = () => {
    setIg('compose');
    setIgCap(null);
  };
  const igShare = () => setIg('sent');
  const igBack = () => setIg('compose');
  const igClose = () => {
    setIg(null);
    setIgCap(null);
  };

  // Twitter / X share flow
  const [tw, setTw] = useState<'compose' | 'sent' | null>(null);
  const [twText, setTwText] = useState<string | null>(null);
  const [twAud, setTwAud] = useState(0);
  const [twTags, setTwTags] = useState<string[]>([]);
  const twDefaultBody = `${title}. ${caption}\n\n${inviteLine}`;
  const twBody = twText ?? twDefaultBody;
  const twLeft = TW_MAX - twBody.length;
  const twRingColor = twBody.length > TW_MAX ? '#ff8189' : twBody.length > TW_MAX - 40 ? '#f0c98a' : '#8fd0f5';
  const twRingOffset = TW_RING_CIRCUMFERENCE * (1 - Math.min(twBody.length / TW_MAX, 1));
  const twPostDisabled = twBody.trim().length === 0 || twBody.length > TW_MAX;
  const shareX = () => {
    setTw('compose');
    setTwText(null);
    setTwTags([]);
  };
  const twPost = () => setTw('sent');
  const twBack = () => setTw('compose');
  const twClose = () => {
    setTw(null);
    setTwText(null);
    setTwTags([]);
  };
  const toggleTwTag = (tag: string) => {
    const has = twTags.includes(tag);
    const base = twText ?? twDefaultBody;
    setTwText(has ? base.replace(` ${tag}`, '').replace(tag, '') : `${base} ${tag}`);
    setTwTags(has ? twTags.filter((t) => t !== tag) : [...twTags, tag]);
  };
  const twSentLine =
    twAud === 1
      ? 'Your Circle can see it. It will not appear in retweets.'
      : 'It is live. The card renders as a large image in timelines.';

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#04060d' }}>
        <motion.div
          {...SPINNER}
          className="h-10 w-10 rounded-full border-2 border-t-transparent"
          style={{ borderColor: 'rgba(30,196,232,0.6)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at 80% -5%,rgba(75,233,255,.12),rgba(4,6,13,0) 50%),radial-gradient(ellipse at 10% 65%,rgba(240,201,138,.08),rgba(4,6,13,0) 45%),#04060d',
        fontFamily: 'Rajdhani, sans-serif',
        color: '#e7f5f9',
      }}
      className="conn-root"
    >
      <style>{`
        /* Two knobs, stepped together on large displays: the content column and
           the share-card column beside it. The design mockup caps the column at
           1120px, which leaves ~800px of empty gutter on a 1920 screen; widening
           past that is a deliberate departure, matching what the Observations page
           already does. Type is NOT scaled here — every size stays at its mockup
           value, so this only changes how much room the components get.

           --cx-card must grow with --cx-max: the layout is a fixed card track
           followed by 1fr, so widening the container alone would hand every extra
           pixel to the list and leave the card preview stranded at 360px. */
        .conn-root { --cx-max: 1120px; --cx-card: 360px; --cx-type-scale: 1; }
        /* A flat +20% from the tablet breakpoint up, applied via cfs(). Phones stay
           at 1: these sizes were drawn against a 1120px desktop layout, and the
           smallest labels here are 9.5px, already at the legibility floor. */
        @media (min-width: 768px)  { .conn-root { --cx-type-scale: 1.2; } }
        @media (min-width: 1440px) { .conn-root { --cx-max: 1320px; --cx-card: 420px; } }
        @media (min-width: 1800px) { .conn-root { --cx-max: 1560px; --cx-card: 480px; } }
        @keyframes connFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
      `}</style>

      <main style={{ maxWidth: 'var(--cx-max, 1120px)', margin: '0 auto', padding: '48px 40px 90px' }}>
        <section style={{ textAlign: 'center', animation: 'connFadeUp .7s ease both' }}>
          <h1
            style={{
              margin: '0 auto',
              maxWidth: 720,
              fontFamily: 'Orbitron, sans-serif',
              fontWeight: 900,
              fontSize: 'calc(clamp(28px,4vw,44px) * var(--cx-type-scale, 1))',
              lineHeight: 1.12,
            }}
          >
            Share {childName || 'their'}&rsquo;s wins
          </h1>
          <p style={{ margin: '14px auto 0', maxWidth: 520, fontSize: cfs(17), fontWeight: 600, lineHeight: 1.5, color: '#a8c1d1' }}>
            Pick a moment, choose where it goes. The card is already made.
          </p>
        </section>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: isNarrow ? '1fr' : 'var(--cx-card, 360px) 1fr',
            gap: 36,
            marginTop: 44,
            alignItems: 'start',
          }}
        >
          <div
            style={{
              position: isNarrow ? 'static' : 'sticky',
              top: isNarrow ? undefined : 110,
              animation: 'connFadeUp .7s ease .1s both',
            }}
          >
            <AccomplishmentCardPreview
              kind={currentItem.kind}
              title={title}
              caption={caption}
              date={cardDate}
              childName={childName || 'Your child'}
              childAge={childAge}
              inviteUrl={inviteUrl}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setEditing((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setEditing((v) => !v);
                }}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 16px',
                  borderRadius: 999,
                  background: 'rgba(9,13,22,.7)',
                  border: `1px solid ${editing ? 'rgba(240,201,138,.6)' : 'rgba(75,233,255,.2)'}`,
                  fontWeight: 700,
                  fontSize: cfs(11),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: editing ? '#f5e6c4' : '#8ba1b1',
                  transition: 'all .2s ease',
                }}
              >
                <PencilIcon />
                {editing ? 'Done editing' : 'Customise card'}
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={resetCard}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') resetCard();
                }}
                style={{
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: cfs(11),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#5c7688',
                  opacity: touched ? 1 : 0.25,
                  transition: 'opacity .2s ease',
                }}
              >
                Reset
              </div>
            </div>

            {editing && (
              <div
                style={{
                  marginTop: 12,
                  borderRadius: 16,
                  padding: '16px 18px',
                  background: 'rgba(9,13,22,.75)',
                  border: '1px solid rgba(240,201,138,.28)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: cfs(10.5), letterSpacing: '.18em', textTransform: 'uppercase', color: '#6f8a9c' }}>
                  Headline
                </div>
                <input
                  value={title}
                  onChange={(e) => editField('title', e.target.value)}
                  style={{
                    marginTop: 7,
                    width: '100%',
                    borderRadius: 11,
                    padding: '11px 13px',
                    background: 'rgba(5,9,18,.85)',
                    border: '1px solid rgba(75,233,255,.24)',
                    outline: 'none',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 700,
                    fontSize: cfs(15),
                    color: '#eafdff',
                  }}
                />
                <div style={{ marginTop: 12, fontWeight: 700, fontSize: cfs(10.5), letterSpacing: '.18em', textTransform: 'uppercase', color: '#6f8a9c' }}>
                  Caption
                </div>
                <textarea
                  value={caption}
                  onChange={(e) => editField('caption', e.target.value)}
                  rows={3}
                  style={{
                    marginTop: 7,
                    width: '100%',
                    resize: 'none',
                    borderRadius: 11,
                    padding: '11px 13px',
                    background: 'rgba(5,9,18,.85)',
                    border: '1px solid rgba(75,233,255,.24)',
                    outline: 'none',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 600,
                    fontSize: cfs(14.5),
                    lineHeight: 1.5,
                    color: '#eafdff',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 16 }}>
              <div
                role="button"
                tabIndex={0}
                onClick={shareWa}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') shareWa();
                }}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '16px 8px',
                  borderRadius: 15,
                  background: 'linear-gradient(160deg,rgba(18,42,32,.85),rgba(8,16,14,.85))',
                  border: '1px solid rgba(80,220,150,.28)',
                  transition: 'all .22s ease',
                }}
              >
                <WhatsAppIcon />
                <div style={{ fontWeight: 700, fontSize: cfs(11.5), letterSpacing: '.1em', textTransform: 'uppercase', color: '#a9ecc8' }}>
                  WhatsApp
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={shareIg}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') shareIg();
                }}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '16px 8px',
                  borderRadius: 15,
                  background: 'linear-gradient(160deg,rgba(48,24,54,.85),rgba(16,10,20,.85))',
                  border: '1px solid rgba(226,120,190,.28)',
                  transition: 'all .22s ease',
                }}
              >
                <InstagramIcon />
                <div style={{ fontWeight: 700, fontSize: cfs(11.5), letterSpacing: '.1em', textTransform: 'uppercase', color: '#f0b6dc' }}>
                  Instagram
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={shareX}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') shareX();
                }}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '16px 8px',
                  borderRadius: 15,
                  background: 'linear-gradient(160deg,rgba(24,32,44,.85),rgba(8,11,17,.85))',
                  border: '1px solid rgba(180,205,225,.24)',
                  transition: 'all .22s ease',
                }}
              >
                <TwitterIcon />
                <div style={{ fontWeight: 700, fontSize: cfs(11.5), letterSpacing: '.1em', textTransform: 'uppercase', color: '#cfe1ee' }}>
                  Twitter
                </div>
              </div>
            </div>
          </div>

          <div style={{ animation: 'connFadeUp .7s ease .18s both' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div
                style={{
                  fontFamily: 'Orbitron, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(14),
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: '#eafdff',
                }}
              >
                {childName || 'Their'}&rsquo;s accomplishments
              </div>
              <div style={{ fontWeight: 700, fontSize: cfs(11), letterSpacing: '.16em', textTransform: 'uppercase', color: '#6f8a9c' }}>
                Tap one to load the card
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {items.map((item, index) => (
                <AccomplishmentRow key={item.title} item={item} active={activeIndex === index} onPick={() => setActiveIndex(index)} />
              ))}
            </div>

            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 9 }}>
              <ShieldIcon />
              <div style={{ fontSize: cfs(13), fontWeight: 600, color: '#6f8a9c' }}>
                Nothing leaves Superpower until you tap a channel. {childName || 'Your child'}&rsquo;s answers are never
                included in a card.
              </div>
            </div>
          </div>
        </section>
      </main>

      <AnimatePresence>
        {(wa === 'compose' || wa === 'sent') && (
          <WhatsAppModal
            mode={wa}
            childName={childName || 'Your child'}
            title={title}
            message={waMsgValue}
            onMessageChange={setWaMsg}
            contacts={WA_CONTACTS}
            picked={waPicked}
            onTogglePicked={toggleWaPicked}
            inviteUrl={inviteUrl}
            onCopyInvite={copyInvite}
            onSend={() => setWa('sent')}
            onClose={waClose}
            sentLine={waSentLine}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(ig === 'compose' || ig === 'sent') && (
          <InstagramModal
            mode={ig}
            handle={handle}
            childName={childName || 'Your child'}
            cardKind={currentItem.kind}
            cardTitle={title}
            cardCaption={caption}
            backdrop={IG_BGS[igBg] ?? IG_BGS[0]!}
            backgrounds={IG_BGS}
            activeBg={igBg}
            onPickBg={setIgBg}
            destinations={IG_DESTS}
            activeDest={igDest}
            onPickDest={setIgDest}
            capLabel={igCapLabel}
            capValue={igCapValue}
            onCapChange={setIgCap}
            linkLabel={igLinkLabel}
            inviteUrl={inviteUrl}
            onCopyInvite={copyInvite}
            cta={IG_DESTS[igDest]?.cta ?? ''}
            ratio={IG_DESTS[igDest]?.ratio ?? ''}
            onShare={igShare}
            onClose={igClose}
            onBack={igBack}
            sentTitle={IG_DESTS[igDest]?.sent ?? ''}
            sentLine={IG_DESTS[igDest]?.line ?? ''}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(tw === 'compose' || tw === 'sent') && (
          <TwitterModal
            mode={tw}
            handle={handle}
            text={twBody}
            onTextChange={setTwText}
            audience={TW_AUDIENCES[twAud] ?? TW_AUDIENCES[0]!}
            onToggleAudience={() => setTwAud((a) => (a === 0 ? 1 : 0))}
            tags={TW_TAGS.map((label) => ({
              label,
              active: twTags.includes(label),
              onToggle: () => toggleTwTag(label),
            }))}
            cardKind={currentItem.kind}
            cardTitle={title}
            cardCaption={caption}
            cardDate={cardDate}
            inviteUrl={inviteUrl}
            onCopyInvite={copyInvite}
            left={twLeft}
            ringColor={twRingColor}
            ringOffset={twRingOffset}
            postDisabled={twPostDisabled}
            onPost={twPost}
            onClose={twClose}
            onBack={twBack}
            sentLine={twSentLine}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{toast && <ToastBanner message={toast} />}</AnimatePresence>
    </div>
  );
}
