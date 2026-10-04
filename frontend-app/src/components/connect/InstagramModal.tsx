import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { css, gradient, rgb } from '@/theme';
import {
  ArrowRightIcon,
  BrandBadge,
  caps,
  cfs,
  InstagramIcon,
  InviteLinkBox,
  linkifyUrl,
  ModalBackdrop,
  ModalCloseButton,
  ModalHeader,
  ModalPanel,
  orb,
  PillButton,
  rj,
  SectionLabel,
  SentPanel,
  ShieldIcon,
  type IgDest,
  type InviteTone,
} from './shared';
import {
  IG_BACKDROP_INNER,
  IG_BACKDROP_OUTER,
  IG_BADGE_FROM,
  IG_CTA_MID,
  IG_DONE_BG,
  IG_PANEL_FROM,
  IG_PANEL_SHADOW,
  IG_PANEL_TO,
  IG_STORY_CARD_SHADOW,
} from './palette';

interface InstagramModalProps {
  mode: 'compose' | 'sent';
  handle: string;
  childName: string;
  /** The shared card being posted — same content shown across every destination. */
  card: { kind: string; title: string; caption: string; date: string };
  /** A ready `experimental_backgroundImage` value. */
  backdrop: string;
  /** Background-swatch picker for the share card. */
  background: {
    options: string[];
    active: number;
    onPick: (i: number) => void;
  };
  /** Where the post is being shared to (Story, Feed, etc.). */
  destination: {
    options: IgDest[];
    active: number;
    onPick: (i: number) => void;
  };
  /** The composed caption text field — distinct from `card.caption`. */
  captionInput: { label: string; value: string };
  inviteLink: { label: string; url: string; onCopy: () => void };
  cta: string;
  ratio: string;
  onShare: () => void;
  /** Modal-level navigation, not part of any specific field above. */
  chrome: { onClose: () => void; onBack: () => void };
  /** Confirmation copy shown once mode === 'sent'. */
  sent: { title: string; line: string };
}

const BACKDROP = `radial-gradient(ellipse at 50% 40%,${IG_BACKDROP_INNER},${IG_BACKDROP_OUTER} 72%)`;
const PANEL_BG = `linear-gradient(165deg,${IG_PANEL_FROM},${IG_PANEL_TO})`;
const PANEL_SHADOW = `0 30px 90px ${IG_PANEL_SHADOW}`;
const BADGE_BG = css(
  `linear-gradient(150deg,${IG_BADGE_FROM},rgb(var(--instagram-badge-b-rgb) / .95))`,
);
const STORY_CARD_BG = css(
  'linear-gradient(165deg,rgb(var(--constellation-panel-a-rgb)),rgb(var(--constellation-panel-deep-rgb)))',
);
const STORY_CARD_SHADOW = `0 14px 34px ${IG_STORY_CARD_SHADOW}`;
const DOT_GLOW = css('0 0 7px rgb(var(--constellation-gold-rgb))');
const SHARE_BG = css(
  `linear-gradient(135deg,rgb(var(--instagram-violet-rgb)),${IG_CTA_MID} 55%,rgb(var(--instagram-violet-deep-rgb)))`,
);
const SHARE_GLOW = css('0 0 26px rgb(var(--instagram-pink-rgb) / .38)');
const SENT_GLOW = css('0 0 30px rgb(var(--instagram-pink-rgb) / .25)');
const PINK = rgb('instagram-pink');
const GOLD = rgb('constellation-gold');
const TONE: InviteTone = {
  boxBg: rgb('instagram-pink', 0.07),
  boxBorder: rgb('instagram-pink', 0.35),
  iconBg: rgb('instagram-pink', 0.14),
  iconBorder: rgb('instagram-pink', 0.3),
  icon: PINK,
  title: rgb('instagram-bright'),
  meta: rgb('instagram-meta'),
  btnBorder: rgb('instagram-pink', 0.45),
  btnText: rgb('instagram-cta'),
};

/** The 214px story mock-up: progress bars, handle, and the mini card. */
function StoryPreview({
  handle,
  card,
  backdrop,
  ratio,
}: {
  handle: string;
  card: InstagramModalProps['card'];
  backdrop: string;
  ratio: string;
}) {
  return (
    // Phone width: the web's single-column branch centres the preview.
    <View style={{ alignSelf: 'center' }}>
      <View
        accessible
        accessibilityLabel={`Story preview: ${card.title}`}
        style={{
          width: 214,
          borderRadius: 18,
          overflow: 'hidden',
          experimental_backgroundImage: backdrop,
          borderWidth: 1,
          borderColor: rgb('instagram-pink', 0.3),
          paddingTop: 12,
          paddingHorizontal: 16,
          paddingBottom: 16,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View
            style={{
              flex: 1,
              height: 2.5,
              borderRadius: 2,
              backgroundColor: rgb('white', 0.85),
            }}
          />
          <View
            style={{
              flex: 1,
              height: 2.5,
              borderRadius: 2,
              backgroundColor: rgb('white', 0.28),
            }}
          />
        </View>
        <View
          style={{
            marginTop: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <View
            style={{
              width: 19,
              height: 19,
              borderRadius: 9.5,
              experimental_backgroundImage: gradient.orbCyan,
            }}
          />
          <Text
            style={[
              rj.bold,
              {
                fontSize: cfs(9.5),
                letterSpacing: 9.5 * 0.06,
                color: rgb('white', 0.92),
              },
            ]}
          >
            {handle}
          </Text>
        </View>
        {/* Shadow on the wrapper so the card's overflow clip can't swallow it. */}
        <View
          style={{
            marginTop: 14,
            borderRadius: 13,
            boxShadow: STORY_CARD_SHADOW,
          }}
        >
          <View
            style={{
              position: 'relative',
              borderRadius: 13,
              overflow: 'hidden',
              aspectRatio: 4 / 5,
              experimental_backgroundImage: STORY_CARD_BG,
              borderWidth: 1,
              borderColor: rgb('constellation-gold', 0.45),
            }}
          >
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                padding: 13,
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
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                  <View
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 2.5,
                      backgroundColor: GOLD,
                      boxShadow: DOT_GLOW,
                    }}
                  />
                  <Text style={[rj.bold, caps(cfs(6), 0.2), { color: GOLD }]}>
                    {card.kind}
                  </Text>
                </View>
                <Text
                  style={[
                    rj.bold,
                    caps(cfs(6), 0.16),
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
                      fontSize: cfs(11),
                      lineHeight: 11 * 1.2,
                      color: rgb('constellation-cyan-palest'),
                    },
                  ]}
                >
                  {card.title}
                </Text>
                <Text
                  style={[
                    rj.semibold,
                    {
                      marginTop: 5,
                      fontSize: cfs(7.5),
                      lineHeight: 7.5 * 1.4,
                      color: rgb('constellation-caption'),
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
                    fontSize: cfs(6),
                    letterSpacing: 6 * 0.14,
                    color: rgb('constellation-cyan-palest'),
                  },
                ]}
              >
                SUPERPOWER
              </Text>
            </View>
          </View>
        </View>
      </View>
      <Text
        style={[
          rj.bold,
          caps(cfs(10), 0.18),
          { marginTop: 10, textAlign: 'center', color: rgb('instagram-meta') },
        ]}
      >
        {ratio}
      </Text>
    </View>
  );
}

export default function InstagramModal({
  mode,
  handle,
  childName,
  card,
  backdrop,
  background,
  destination,
  captionInput,
  inviteLink,
  cta,
  ratio,
  onShare,
  chrome,
  sent,
}: InstagramModalProps) {
  const {
    options: backgrounds,
    active: activeBg,
    onPick: onPickBg,
  } = background;
  const {
    options: destinations,
    active: activeDest,
    onPick: onPickDest,
  } = destination;
  const { label: capLabel, value: capValue } = captionInput;
  const { label: linkLabel, url: inviteUrl, onCopy: onCopyInvite } = inviteLink;
  const { onClose, onBack } = chrome;
  const { title: sentTitle, line: sentLine } = sent;
  const fullInviteUrl = `https://${inviteUrl}`;

  // Web: `grid-template-columns: 1fr 1fr` — laid out here as rows of two.
  const destRows: { d: IgDest; i: number }[][] = [];
  destinations.forEach((d, i) => {
    const row = destRows[Math.floor(i / 2)];
    if (row) row.push({ d, i });
    else destRows.push([{ d, i }]);
  });

  return (
    <ModalBackdrop
      gradient={BACKDROP}
      onClose={onClose}
      label="Share to Instagram"
    >
      <ModalPanel
        background={PANEL_BG}
        border={rgb('instagram-pink', 0.35)}
        shadow={PANEL_SHADOW}
      >
        <ModalCloseButton
          onPress={onClose}
          color={rgb('instagram-muted')}
          border={rgb('instagram-pink', 0.28)}
        />

        {mode === 'compose' ? (
          <View>
            <ModalHeader
              badge={
                <BrandBadge
                  background={BADGE_BG}
                  border={rgb('instagram-pink', 0.5)}
                >
                  <InstagramIcon size={19} />
                </BrandBadge>
              }
              title="Share to Instagram"
              titleColor={rgb('instagram-bright')}
              subtitle={`Posting as ${handle}`}
              subtitleColor={rgb('instagram-muted')}
            />

            <View style={{ flexDirection: 'column', gap: 22, marginTop: 20 }}>
              <StoryPreview
                handle={handle}
                card={card}
                backdrop={backdrop}
                ratio={ratio}
              />

              <View>
                <SectionLabel color={rgb('instagram-label')}>
                  Where it goes
                </SectionLabel>
                <View style={{ gap: 8, marginTop: 11 }}>
                  {destRows.map(row => (
                    <View
                      key={row[0]?.d.name ?? ''}
                      style={{ flexDirection: 'row', gap: 8 }}
                    >
                      {row.map(({ d, i }) => {
                        const on = activeDest === i;
                        return (
                          <Pressable
                            key={d.name}
                            onPress={() => onPickDest(i)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on, checked: on }}
                            accessibilityLabel={`${d.name}, ${d.meta}`}
                            style={{ flex: 1 }}
                          >
                            <Animated.View
                              style={{
                                flex: 1,
                                borderRadius: 13,
                                paddingVertical: 12,
                                paddingHorizontal: 13,
                                backgroundColor: on
                                  ? rgb('instagram-pink', 0.14)
                                  : rgb('instagram-surface', 0.6),
                                borderWidth: 1,
                                borderColor: on
                                  ? rgb('instagram-pink', 0.6)
                                  : rgb('instagram-pink', 0.14),
                                transitionProperty: [
                                  'backgroundColor',
                                  'borderColor',
                                ],
                                transitionDuration: 200,
                              }}
                            >
                              <Text
                                style={[
                                  rj.bold,
                                  {
                                    fontSize: cfs(13.5),
                                    color: on
                                      ? rgb('instagram-bright')
                                      : rgb('instagram-inactive'),
                                  },
                                ]}
                              >
                                {d.name}
                              </Text>
                              <Text
                                style={[
                                  rj.semibold,
                                  {
                                    marginTop: 2,
                                    fontSize: cfs(11.5),
                                    color: rgb('instagram-meta'),
                                  },
                                ]}
                              >
                                {d.meta}
                              </Text>
                            </Animated.View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>

                <SectionLabel color={rgb('instagram-label')} marginTop={18}>
                  Backdrop
                </SectionLabel>
                <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
                  {backgrounds.map((swatch, i) => (
                    <Pressable
                      key={swatch}
                      onPress={() => onPickBg(i)}
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: activeBg === i,
                        checked: activeBg === i,
                      }}
                      accessibilityLabel={`Backdrop ${i + 1}`}
                    >
                      <Animated.View
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 12,
                          experimental_backgroundImage: swatch,
                          borderWidth: 2,
                          borderColor:
                            activeBg === i ? PINK : rgb('instagram-pink', 0.2),
                          transitionProperty: 'borderColor',
                          transitionDuration: 200,
                        }}
                      />
                    </Pressable>
                  ))}
                </View>

                <SectionLabel color={rgb('instagram-label')} marginTop={18}>
                  {capLabel}
                </SectionLabel>
                <View
                  style={{
                    marginTop: 7,
                    width: '100%',
                    borderRadius: 11,
                    paddingVertical: 11,
                    paddingHorizontal: 13,
                    backgroundColor: rgb('instagram-surface', 0.85),
                    borderWidth: 1,
                    borderColor: rgb('instagram-pink', 0.24),
                  }}
                >
                  <Text
                    style={[
                      rj.semibold,
                      {
                        fontSize: cfs(14.5),
                        lineHeight: 14.5 * 1.5,
                        color: rgb('instagram-bright'),
                      },
                    ]}
                  >
                    {linkifyUrl(capValue, fullInviteUrl)}
                  </Text>
                </View>

                <InviteLinkBox
                  title={linkLabel}
                  inviteUrl={inviteUrl}
                  onCopy={onCopyInvite}
                  tone={TONE}
                  marginTop={12}
                />

                <View
                  style={{
                    marginTop: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <ShieldIcon size={13} color={rgb('instagram-note')} />
                  <Text
                    style={[
                      rj.semibold,
                      {
                        flexShrink: 1,
                        fontSize: cfs(12),
                        color: rgb('instagram-note'),
                      },
                    ]}
                  >
                    {childName}&rsquo;s face and full name stay off the card.
                  </Text>
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    marginTop: 20,
                  }}
                >
                  <Pressable
                    onPress={onShare}
                    accessibilityRole="button"
                    accessibilityLabel={cta}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 9,
                      paddingVertical: 13,
                      paddingHorizontal: 28,
                      borderRadius: 999,
                      experimental_backgroundImage: SHARE_BG,
                      boxShadow: SHARE_GLOW,
                    }}
                  >
                    <Text
                      style={[
                        rj.bold,
                        caps(cfs(13), 0.16),
                        { color: rgb('instagram-ink') },
                      ]}
                    >
                      {cta}
                    </Text>
                    <ArrowRightIcon color={rgb('instagram-ink')} />
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        ) : (
          <SentPanel
            ring={{
              background: rgb('instagram-pink', 0.14),
              border: rgb('instagram-pink', 0.55),
              shadow: SENT_GLOW,
            }}
            tick={PINK}
            title={sentTitle}
            titleColor={rgb('instagram-bright')}
            line={sentLine}
            lineColor={rgb('instagram-muted')}
            lineMaxWidth={380}
          >
            <PillButton
              label="Done"
              onPress={onClose}
              color={rgb('instagram-cta')}
              border={rgb('instagram-pink', 0.45)}
              background={IG_DONE_BG}
              paddingHorizontal={30}
            />
            <PillButton
              label="Share again"
              onPress={onBack}
              color={rgb('instagram-meta')}
              paddingHorizontal={22}
            />
          </SentPanel>
        )}
      </ModalPanel>
    </ModalBackdrop>
  );
}
