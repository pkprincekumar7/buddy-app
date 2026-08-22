import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { SPINNER } from '@/lib/animations';
import { useMediaQuery } from '@/hooks/use-mobile';

import {
  cfs,
  WhatsAppIcon,
  InstagramIcon,
  TwitterIcon,
  ShieldIcon,
  PencilIcon,
  ToastBanner,
  BASE_ITEMS,
  WA_CONTACTS,
  IG_DESTS,
  IG_BGS,
  TW_TAGS,
  TW_AUDIENCES,
  TW_MAX,
  TW_RING_CIRCUMFERENCE,
} from '@/components/connect/shared';
import {
  AccomplishmentCardPreview,
  AccomplishmentRow,
} from '@/components/connect/AccomplishmentCards';
import WhatsAppModal from '@/components/connect/WhatsAppModal';
import InstagramModal from '@/components/connect/InstagramModal';
import TwitterModal from '@/components/connect/TwitterModal';

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

  const isNarrow = useMediaQuery('(max-width: 859px)');

  const items = useMemo(
    () =>
      BASE_ITEMS.map((it) =>
        it.title.includes('{name}')
          ? { ...it, title: it.title.replace('{name}', childName || 'Your child') }
          : it,
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
    () =>
      new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
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
  const twRingColor =
    twBody.length > TW_MAX
      ? '#ff8189'
      : twBody.length > TW_MAX - 40
        ? 'rgb(var(--constellation-gold-rgb))'
        : '#8fd0f5';
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
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'rgb(var(--constellation-navy-deepest-rgb))' }}
      >
        <motion.div
          {...SPINNER}
          className="h-10 w-10 rounded-full border-2 border-t-transparent"
          style={{
            borderColor: 'rgb(var(--constellation-cyan-bright-rgb) / 0.6)',
            borderTopColor: 'transparent',
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at 80% -5%,rgb(var(--constellation-cyan-rgb) / .12),rgb(var(--constellation-navy-deepest-rgb) / 0) 50%),radial-gradient(ellipse at 10% 65%,rgb(var(--constellation-gold-rgb) / .08),rgb(var(--constellation-navy-deepest-rgb) / 0) 45%),rgb(var(--constellation-navy-deepest-rgb))',
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

      <main
        style={{ maxWidth: 'var(--cx-max, 1120px)', margin: '0 auto', padding: '48px 40px 90px' }}
      >
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
          <p
            style={{
              margin: '14px auto 0',
              maxWidth: 520,
              fontSize: cfs(17),
              fontWeight: 600,
              lineHeight: 1.5,
              color: '#a8c1d1',
            }}
          >
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

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 14,
              }}
            >
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
                  border: `1px solid ${editing ? 'rgb(var(--constellation-gold-rgb) / .6)' : 'rgb(var(--constellation-cyan-rgb) / .2)'}`,
                  fontWeight: 700,
                  fontSize: cfs(11),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: editing
                    ? 'rgb(var(--constellation-gold-pale-rgb))'
                    : 'rgb(var(--constellation-slate-light-rgb))',
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
                  border: '1px solid rgb(var(--constellation-gold-rgb) / .28)',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(10.5),
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: 'rgb(var(--constellation-slate-rgb))',
                  }}
                >
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
                    border: '1px solid rgb(var(--constellation-cyan-rgb) / .24)',
                    outline: 'none',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 700,
                    fontSize: cfs(15),
                    color: 'rgb(var(--constellation-cyan-pale-rgb))',
                  }}
                />
                <div
                  style={{
                    marginTop: 12,
                    fontWeight: 700,
                    fontSize: cfs(10.5),
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: 'rgb(var(--constellation-slate-rgb))',
                  }}
                >
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
                    border: '1px solid rgb(var(--constellation-cyan-rgb) / .24)',
                    outline: 'none',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontWeight: 600,
                    fontSize: cfs(14.5),
                    lineHeight: 1.5,
                    color: 'rgb(var(--constellation-cyan-pale-rgb))',
                  }}
                />
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3,1fr)',
                gap: 10,
                marginTop: 16,
              }}
            >
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
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(11.5),
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: '#a9ecc8',
                  }}
                >
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
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(11.5),
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: '#f0b6dc',
                  }}
                >
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
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: cfs(11.5),
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: '#cfe1ee',
                  }}
                >
                  Twitter
                </div>
              </div>
            </div>
          </div>

          <div style={{ animation: 'connFadeUp .7s ease .18s both' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontFamily: 'Orbitron, sans-serif',
                  fontWeight: 700,
                  fontSize: cfs(14),
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--constellation-cyan-pale-rgb))',
                }}
              >
                {childName || 'Their'}&rsquo;s accomplishments
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: cfs(11),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--constellation-slate-rgb))',
                }}
              >
                Tap one to load the card
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {items.map((item, index) => (
                <AccomplishmentRow
                  key={item.title}
                  item={item}
                  active={activeIndex === index}
                  onPick={() => setActiveIndex(index)}
                />
              ))}
            </div>

            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 9 }}>
              <ShieldIcon />
              <div
                style={{
                  fontSize: cfs(13),
                  fontWeight: 600,
                  color: 'rgb(var(--constellation-slate-rgb))',
                }}
              >
                Nothing leaves Superpower until you tap a channel. {childName || 'Your child'}
                &rsquo;s answers are never included in a card.
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
            card={{ kind: currentItem.kind, title, caption }}
            backdrop={IG_BGS[igBg] ?? IG_BGS[0]!}
            background={{ options: IG_BGS, active: igBg, onPick: setIgBg }}
            destination={{ options: IG_DESTS, active: igDest, onPick: setIgDest }}
            captionInput={{ label: igCapLabel, value: igCapValue, onChange: setIgCap }}
            inviteLink={{ label: igLinkLabel, url: inviteUrl, onCopy: copyInvite }}
            cta={IG_DESTS[igDest]?.cta ?? ''}
            ratio={IG_DESTS[igDest]?.ratio ?? ''}
            onShare={igShare}
            chrome={{ onClose: igClose, onBack: igBack }}
            sent={{
              title: IG_DESTS[igDest]?.sent ?? '',
              line: IG_DESTS[igDest]?.line ?? '',
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(tw === 'compose' || tw === 'sent') && (
          <TwitterModal
            mode={tw}
            handle={handle}
            composer={{ text: twBody, onChange: setTwText }}
            audienceControl={{
              value: TW_AUDIENCES[twAud] ?? TW_AUDIENCES[0]!,
              onToggle: () => setTwAud((a) => (a === 0 ? 1 : 0)),
            }}
            tags={TW_TAGS.map((label) => ({
              label,
              active: twTags.includes(label),
              onToggle: () => toggleTwTag(label),
            }))}
            card={{ kind: currentItem.kind, title, caption, date: cardDate }}
            inviteLink={{ url: inviteUrl, onCopy: copyInvite }}
            ring={{ charsLeft: twLeft, color: twRingColor, offset: twRingOffset }}
            post={{ disabled: twPostDisabled, onPost: twPost }}
            chrome={{ onClose: twClose, onBack: twBack }}
            sentLine={twSentLine}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{toast && <ToastBanner message={toast} />}</AnimatePresence>
    </div>
  );
}
