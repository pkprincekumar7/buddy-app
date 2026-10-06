import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Share, Text, TextInput, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { useNavigate, useParams } from '@/lib/router';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import Spinner from '@/components/shared/Spinner';
import PageScroll from '@/components/layout/PageScroll';
import { css, rgb } from '@/theme';

import {
  caps,
  cfs,
  FADE_UP,
  orb,
  rj,
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
  type AccomplishmentItem,
} from '@/components/connect/shared';
import {
  AccomplishmentCardPreview,
  AccomplishmentRow,
} from '@/components/connect/AccomplishmentCards';
import WhatsAppModal from '@/components/connect/WhatsAppModal';
import InstagramModal from '@/components/connect/InstagramModal';
import TwitterModal from '@/components/connect/TwitterModal';
import {
  IG_SHARE_TILE_FROM,
  TW_RING_OVER,
  TW_SHARE_TILE_FROM,
} from '@/components/connect/palette';

type ItemEdits = Partial<Record<'title' | 'caption', string>>;

const EMPTY_ITEM: AccomplishmentItem = {
  kind: '',
  when: '',
  title: '',
  caption: '',
  icon: '',
};

const PAGE_BG = css(
  'radial-gradient(ellipse at 80% -5%,rgb(var(--constellation-cyan-rgb) / .12),rgb(var(--constellation-navy-deepest-rgb) / 0) 50%),radial-gradient(ellipse at 10% 65%,rgb(var(--constellation-gold-rgb) / .08),rgb(var(--constellation-navy-deepest-rgb) / 0) 45%)',
);
const WA_TILE_BG = css(
  'linear-gradient(160deg,rgb(var(--whatsapp-badge-a-rgb) / .85),rgb(var(--whatsapp-badge-b-rgb) / .85))',
);
const IG_TILE_BG = css(
  `linear-gradient(160deg,${IG_SHARE_TILE_FROM},rgb(var(--instagram-badge-b-rgb) / .85))`,
);
const TW_TILE_BG = css(
  `linear-gradient(160deg,${TW_SHARE_TILE_FROM},rgb(var(--twitter-badge-b-rgb) / .85))`,
);
const EDIT_INPUT_BASE = {
  marginTop: 7,
  width: '100%',
  borderRadius: 11,
  paddingVertical: 11,
  paddingHorizontal: 13,
  backgroundColor: rgb('constellation-surface', 0.85),
  borderWidth: 1,
  borderColor: rgb('constellation-cyan', 0.24),
  color: rgb('constellation-cyan-pale'),
} as const;

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
        // Mark Connect as visited — this advances which circle the
        // DimensionCircles hub points to next (there is none left after this).
        if (!child.connect_visited) {
          api.entities.Child.markProgress(childId, 'connect_visited').catch(
            console.error,
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const items = useMemo(
    () =>
      BASE_ITEMS.map(it =>
        it.title.includes('{name}')
          ? {
              ...it,
              title: it.title.replace('{name}', childName || 'Your child'),
            }
          : it,
      ),
    [childName],
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<number, ItemEdits>>({});

  const currentItem = items[activeIndex] ?? items[0] ?? EMPTY_ITEM;
  const currentEdit = edits[activeIndex] ?? {};
  const title = currentEdit.title ?? currentItem.title;
  const caption = currentEdit.caption ?? currentItem.caption;
  const touched =
    currentEdit.title !== undefined || currentEdit.caption !== undefined;

  const editField = (field: 'title' | 'caption', value: string) => {
    setEdits(prev => ({
      ...prev,
      [activeIndex]: { ...prev[activeIndex], [field]: value },
    }));
  };
  const resetCard = () => {
    if (!touched) return;
    setEdits(prev => {
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

  const nameSlug =
    (childName || 'friend').toLowerCase().replace(/[^a-z0-9]+/g, '') ||
    'friend';
  const inviteUrl = `superpower.app/join/${nameSlug}`;
  const inviteLine = `Join Superpower for free and see your child's transformation: https://${inviteUrl}`;
  const handle = `@${nameSlug}.parent`;

  // Web copies the join link to the clipboard. No clipboard module is installed
  // in the app, so the native share sheet (which offers "Copy") stands in; the
  // same confirmation toast shows once the sheet is done.
  const copyInvite = () => {
    const link = `https://${inviteUrl}`;
    void Share.share(Platform.OS === 'ios' ? { url: link } : { message: link })
      .then(res => {
        if (res.action !== Share.dismissedAction) showToast('Join link copied');
      })
      .catch((e: unknown) => console.error(e));
  };

  const cardDate = useMemo(
    () =>
      new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [],
  );

  // WhatsApp share flow
  const [wa, setWa] = useState<'compose' | 'sent' | null>(null);
  const [waPicked, setWaPicked] = useState<number[]>([0]);
  const waDefaultMsg = `${title} — ${caption}\n\n${inviteLine}`;
  const waSentLine = `${waPicked
    .map(i => WA_CONTACTS[i]?.name)
    .filter(Boolean)
    .join(', ')} will see it in a moment.`;
  const shareWa = () => {
    setWa('compose');
    setWaPicked([0]);
  };
  const waClose = () => {
    setWa(null);
  };
  const toggleWaPicked = (i: number) =>
    setWaPicked(prev =>
      prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i],
    );

  // Instagram share flow
  const [ig, setIg] = useState<'compose' | 'sent' | null>(null);
  const [igDest, setIgDest] = useState(0);
  const [igBg, setIgBg] = useState(0);
  const igDefaultCap = `${caption}\n\n${title}. Proud of them.\n\n${inviteLine}`;
  const igCapLabel = igDest === 3 ? 'Message' : 'Caption';
  const igLinkLabel =
    igDest < 2
      ? 'Join Superpower link sticker added'
      : igDest === 3
      ? 'Join link included in the message'
      : 'Join link included in the caption';
  const shareIg = () => setIg('compose');
  const igShare = () => setIg('sent');
  const igBack = () => setIg('compose');
  const igClose = () => setIg(null);

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
      ? TW_RING_OVER
      : twBody.length > TW_MAX - 40
      ? rgb('constellation-gold')
      : rgb('twitter-sky');
  const twRingOffset =
    TW_RING_CIRCUMFERENCE * (1 - Math.min(twBody.length / TW_MAX, 1));
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
    setTwText(
      has ? base.replace(` ${tag}`, '').replace(tag, '') : `${base} ${tag}`,
    );
    setTwTags(has ? twTags.filter(t => t !== tag) : [...twTags, tag]);
  };
  const twSentLine =
    twAud === 1
      ? 'Your Circle can see it. It will not appear in retweets.'
      : 'It is live. The card renders as a large image in timelines.';

  if (isLoading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: rgb('constellation-navy-deepest') }}
      >
        <Spinner
          style={{
            borderColor: rgb('constellation-cyan-bright', 0.6),
            borderTopColor: 'transparent',
          }}
        />
      </View>
    );
  }

  const name = childName || 'Your child';
  const cardData = { kind: currentItem.kind, title, caption, date: cardDate };

  return (
    <View className="flex-1 bg-background">
      <PageScroll
        contentContainerStyle={{ flexGrow: 1 }}
        automaticallyAdjustKeyboardInsets
      >
        <View
          style={{
            flexGrow: 1,
            backgroundColor: rgb('constellation-navy-deepest'),
            experimental_backgroundImage: PAGE_BG,
            paddingTop: 48,
            paddingHorizontal: 40,
            paddingBottom: 90,
          }}
        >
          <Animated.View entering={FADE_UP.d0} style={{ alignItems: 'center' }}>
            <Text
              accessibilityRole="header"
              style={[
                orb.black,
                {
                  textAlign: 'center',
                  fontSize: 28,
                  lineHeight: 28 * 1.12,
                  color: rgb('constellation-text-frost'),
                },
              ]}
            >
              Share {childName || 'their'}&rsquo;s wins
            </Text>
            <Text
              style={[
                rj.semibold,
                {
                  marginTop: 14,
                  maxWidth: 520,
                  textAlign: 'center',
                  fontSize: cfs(17),
                  lineHeight: 17 * 1.5,
                  color: rgb('constellation-slate-pale'),
                },
              ]}
            >
              Pick a moment, choose where it goes. The card is already made.
            </Text>
          </Animated.View>

          <View style={{ flexDirection: 'column', gap: 36, marginTop: 44 }}>
            <Animated.View entering={FADE_UP.d100}>
              <AccomplishmentCardPreview
                kind={currentItem.kind}
                title={title}
                caption={caption}
                date={cardDate}
                childName={name}
                childAge={childAge}
                inviteUrl={inviteUrl}
              />

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginTop: 14,
                }}
              >
                <Pressable
                  onPress={() => setEditing(v => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    editing ? 'Done editing' : 'Customise card'
                  }
                  accessibilityState={{ expanded: editing }}
                >
                  <Animated.View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingVertical: 9,
                      paddingHorizontal: 16,
                      borderRadius: 999,
                      backgroundColor: rgb('constellation-card', 0.7),
                      borderWidth: 1,
                      borderColor: editing
                        ? rgb('constellation-gold', 0.6)
                        : rgb('constellation-cyan', 0.2),
                      transitionProperty: 'borderColor',
                      transitionDuration: 200,
                    }}
                  >
                    <PencilIcon
                      color={
                        editing
                          ? rgb('constellation-gold-pale')
                          : rgb('constellation-slate-light')
                      }
                    />
                    <Text
                      style={[
                        rj.bold,
                        caps(cfs(11), 0.16),
                        {
                          color: editing
                            ? rgb('constellation-gold-pale')
                            : rgb('constellation-slate-light'),
                        },
                      ]}
                    >
                      {editing ? 'Done editing' : 'Customise card'}
                    </Text>
                  </Animated.View>
                </Pressable>
                <Pressable
                  onPress={resetCard}
                  accessibilityRole="button"
                  accessibilityLabel="Reset"
                  accessibilityState={{ disabled: !touched }}
                >
                  <Animated.Text
                    style={[
                      rj.bold,
                      caps(cfs(11), 0.16),
                      {
                        color: rgb('constellation-slate-dim'),
                        opacity: touched ? 1 : 0.25,
                        transitionProperty: 'opacity',
                        transitionDuration: 200,
                      },
                    ]}
                  >
                    Reset
                  </Animated.Text>
                </Pressable>
              </View>

              {editing && (
                <View
                  style={{
                    marginTop: 12,
                    borderRadius: 16,
                    paddingVertical: 16,
                    paddingHorizontal: 18,
                    backgroundColor: rgb('constellation-card', 0.75),
                    borderWidth: 1,
                    borderColor: rgb('constellation-gold', 0.28),
                  }}
                >
                  <Text
                    style={[
                      rj.bold,
                      caps(cfs(10.5), 0.18),
                      { color: rgb('constellation-slate') },
                    ]}
                  >
                    Headline
                  </Text>
                  <TextInput
                    value={title}
                    onChangeText={v => editField('title', v)}
                    accessibilityLabel="Headline"
                    selectionColor={rgb('constellation-cyan')}
                    style={[EDIT_INPUT_BASE, rj.bold, { fontSize: cfs(15) }]}
                  />
                  <Text
                    style={[
                      rj.bold,
                      caps(cfs(10.5), 0.18),
                      { marginTop: 12, color: rgb('constellation-slate') },
                    ]}
                  >
                    Caption
                  </Text>
                  <TextInput
                    value={caption}
                    onChangeText={v => editField('caption', v)}
                    accessibilityLabel="Caption"
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    selectionColor={rgb('constellation-cyan')}
                    style={[
                      EDIT_INPUT_BASE,
                      rj.semibold,
                      {
                        fontSize: cfs(14.5),
                        lineHeight: 14.5 * 1.5,
                        // rows={3}: three lines of text + vertical padding + border.
                        minHeight: 3 * 14.5 * 1.5 + 22 + 2,
                      },
                    ]}
                  />
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <ShareTile
                  label="WhatsApp"
                  a11y="Share on WhatsApp"
                  onPress={shareWa}
                  background={WA_TILE_BG}
                  border={rgb('whatsapp-green', 0.28)}
                  textColor={rgb('whatsapp-cta')}
                  icon={<WhatsAppIcon />}
                />
                <ShareTile
                  label="Instagram"
                  a11y="Share to Instagram"
                  onPress={shareIg}
                  background={IG_TILE_BG}
                  border={rgb('instagram-pink', 0.28)}
                  textColor={rgb('instagram-cta')}
                  icon={<InstagramIcon />}
                />
                <ShareTile
                  label="Twitter"
                  a11y="Post on Twitter"
                  onPress={shareX}
                  background={TW_TILE_BG}
                  border={rgb('twitter-slate', 0.24)}
                  textColor={rgb('twitter-sent')}
                  icon={<TwitterIcon />}
                />
              </View>
            </Animated.View>

            <Animated.View entering={FADE_UP.d180}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  columnGap: 14,
                  rowGap: 14,
                }}
              >
                <Text
                  accessibilityRole="header"
                  style={[
                    orb.bold,
                    caps(cfs(14), 0.1),
                    { color: rgb('constellation-cyan-pale') },
                  ]}
                >
                  {childName || 'Their'}&rsquo;s accomplishments
                </Text>
                <Text
                  style={[
                    rj.bold,
                    caps(cfs(11), 0.16),
                    { color: rgb('constellation-slate') },
                  ]}
                >
                  Tap one to load the card
                </Text>
              </View>

              <View style={{ flexDirection: 'column', gap: 10, marginTop: 16 }}>
                {items.map((item, index) => (
                  <AccomplishmentRow
                    key={item.title}
                    item={item}
                    active={activeIndex === index}
                    onPick={() => setActiveIndex(index)}
                  />
                ))}
              </View>

              <View
                style={{
                  marginTop: 18,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 9,
                }}
              >
                <ShieldIcon />
                <Text
                  style={[
                    rj.semibold,
                    {
                      flexShrink: 1,
                      fontSize: cfs(13),
                      color: rgb('constellation-slate'),
                    },
                  ]}
                >
                  Nothing leaves Superpower until you tap a channel. {name}
                  &rsquo;s answers are never included in a card.
                </Text>
              </View>
            </Animated.View>
          </View>
        </View>
      </PageScroll>

      {(wa === 'compose' || wa === 'sent') && (
        <WhatsAppModal
          mode={wa}
          childName={name}
          card={cardData}
          message={waDefaultMsg}
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

      {(ig === 'compose' || ig === 'sent') && (
        <InstagramModal
          mode={ig}
          handle={handle}
          childName={name}
          card={cardData}
          backdrop={IG_BGS[igBg] ?? IG_BGS[0] ?? ''}
          background={{ options: IG_BGS, active: igBg, onPick: setIgBg }}
          destination={{ options: IG_DESTS, active: igDest, onPick: setIgDest }}
          captionInput={{ label: igCapLabel, value: igDefaultCap }}
          inviteLink={{
            label: igLinkLabel,
            url: inviteUrl,
            onCopy: copyInvite,
          }}
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

      {(tw === 'compose' || tw === 'sent') && (
        <TwitterModal
          mode={tw}
          handle={handle}
          composer={{ text: twBody }}
          audienceControl={{
            value: TW_AUDIENCES[twAud] ?? TW_AUDIENCES[0] ?? '',
            onToggle: () => setTwAud(a => (a === 0 ? 1 : 0)),
          }}
          tags={TW_TAGS.map(label => ({
            label,
            active: twTags.includes(label),
            onToggle: () => toggleTwTag(label),
          }))}
          card={cardData}
          inviteLink={{ url: inviteUrl, onCopy: copyInvite }}
          ring={{ charsLeft: twLeft, color: twRingColor, offset: twRingOffset }}
          post={{ disabled: twPostDisabled, onPost: twPost }}
          chrome={{ onClose: twClose, onBack: twBack }}
          sentLine={twSentLine}
        />
      )}

      {toast ? <ToastBanner message={toast} /> : null}
    </View>
  );
}

/** One of the three channel tiles under the card (web: 3-column grid). */
function ShareTile({
  label,
  a11y,
  onPress,
  background,
  border,
  textColor,
  icon,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  background: string;
  border: string;
  textColor: string;
  icon: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={{
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 16,
        paddingHorizontal: 8,
        borderRadius: 15,
        experimental_backgroundImage: background,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      {icon}
      <Text
        numberOfLines={1}
        style={[rj.bold, caps(cfs(11.5), 0.1), { color: textColor }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
