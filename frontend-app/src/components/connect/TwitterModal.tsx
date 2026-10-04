import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { css, rgb } from '@/theme';
import {
  BrandBadge,
  caps,
  cfs,
  ChevronDownIcon,
  InviteLinkBox,
  linkifyUrl,
  MiniShareCard,
  ModalBackdrop,
  ModalCloseButton,
  ModalHeader,
  ModalPanel,
  PillButton,
  rj,
  SentPanel,
  TW_RING_CIRCUMFERENCE,
  TwitterIcon,
  type InviteTone,
} from './shared';
import {
  TW_BACKDROP_INNER,
  TW_BACKDROP_OUTER,
  TW_BADGE_FROM,
  TW_DONE_BG,
  TW_PANEL_FROM,
  TW_PANEL_SHADOW,
  TW_PANEL_TO,
} from './palette';

interface TwitterTagOption {
  label: string;
  active: boolean;
  onToggle: () => void;
}

interface TwitterModalProps {
  mode: 'compose' | 'sent';
  handle: string;
  /** The composed tweet text — mutated only by toggling `tags`, not typed directly. */
  composer: { text: string };
  /** Reply-audience selector (Everyone / Mentioned only, etc.). */
  audienceControl: { value: string; onToggle: () => void };
  tags: TwitterTagOption[];
  /** The shared card being posted — same content shown across every destination. */
  card: { kind: string; title: string; caption: string; date: string };
  inviteLink: { url: string; onCopy: () => void };
  /** Character-count ring around the post button (`color` is a resolved RN color). */
  ring: { charsLeft: number; color: string; offset: number };
  post: { disabled: boolean; onPost: () => void };
  /** Modal-level navigation, not part of any specific field above. */
  chrome: { onClose: () => void; onBack: () => void };
  sentLine: string;
}

const BACKDROP = `radial-gradient(ellipse at 50% 40%,${TW_BACKDROP_INNER},${TW_BACKDROP_OUTER} 72%)`;
const PANEL_BG = `linear-gradient(165deg,${TW_PANEL_FROM},${TW_PANEL_TO})`;
const PANEL_SHADOW = `0 30px 90px ${TW_PANEL_SHADOW}`;
const BADGE_BG = css(
  `linear-gradient(150deg,${TW_BADGE_FROM},rgb(var(--twitter-badge-b-rgb) / .95))`,
);
const CARD_BG = css(
  'linear-gradient(120deg,rgb(var(--constellation-panel-b-rgb)),rgb(var(--constellation-panel-deep-rgb)))',
);
const POST_BG = css(
  'linear-gradient(135deg,rgb(var(--twitter-bright-rgb)),rgb(var(--twitter-cta-deep-rgb)))',
);
const POST_GLOW = css('0 0 26px rgb(var(--twitter-slate-rgb) / .25)');
const SENT_GLOW = css('0 0 30px rgb(var(--twitter-slate-rgb) / .2)');
const SKY = rgb('twitter-sky');
const TONE: InviteTone = {
  boxBg: rgb('twitter-sky', 0.06),
  boxBorder: rgb('twitter-sky', 0.32),
  iconBg: rgb('twitter-sky', 0.12),
  iconBorder: rgb('twitter-sky', 0.28),
  icon: SKY,
  title: rgb('twitter-bright'),
  meta: rgb('twitter-meta'),
  btnBorder: rgb('twitter-sky', 0.42),
  btnText: rgb('twitter-sky-light'),
};

export default function TwitterModal({
  mode,
  handle,
  composer,
  audienceControl,
  tags,
  card,
  inviteLink,
  ring,
  post,
  chrome,
  sentLine,
}: TwitterModalProps) {
  const { text } = composer;
  const { value: audience, onToggle: onToggleAudience } = audienceControl;
  const { url: inviteUrl, onCopy: onCopyInvite } = inviteLink;
  const { charsLeft: left, color: ringColor, offset: ringOffset } = ring;
  const { disabled: postDisabled, onPost } = post;
  const { onClose, onBack } = chrome;
  const fullInviteUrl = `https://${inviteUrl}`;

  return (
    <ModalBackdrop
      gradient={BACKDROP}
      onClose={onClose}
      label="Post on Twitter"
    >
      <ModalPanel
        background={PANEL_BG}
        border={rgb('twitter-slate', 0.3)}
        shadow={PANEL_SHADOW}
      >
        <ModalCloseButton
          onPress={onClose}
          color={rgb('twitter-muted')}
          border={rgb('twitter-slate', 0.24)}
        />

        {mode === 'compose' ? (
          <View>
            <ModalHeader
              badge={
                <BrandBadge
                  background={BADGE_BG}
                  border={rgb('twitter-slate', 0.45)}
                >
                  <TwitterIcon size={18} />
                </BrandBadge>
              }
              title="Post on Twitter"
              titleColor={rgb('twitter-bright')}
              subtitle={handle}
              subtitleColor={rgb('twitter-muted')}
            />

            <View
              style={{
                marginTop: 20,
                borderRadius: 16,
                paddingVertical: 16,
                paddingHorizontal: 17,
                backgroundColor: rgb('twitter-surface', 0.7),
                borderWidth: 1,
                borderColor: rgb('twitter-slate', 0.14),
              }}
            >
              <View style={{ minWidth: 0 }}>
                <Pressable
                  onPress={onToggleAudience}
                  accessibilityRole="button"
                  accessibilityLabel={`Audience: ${audience}`}
                  style={{
                    alignSelf: 'flex-start',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 7,
                    paddingVertical: 5,
                    paddingHorizontal: 13,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: rgb('twitter-sky', 0.5),
                  }}
                >
                  <Text
                    style={[rj.bold, caps(cfs(10.5), 0.14), { color: SKY }]}
                  >
                    {audience}
                  </Text>
                  <ChevronDownIcon color={SKY} />
                </Pressable>
                <Text
                  style={[
                    rj.semibold,
                    {
                      marginTop: 11,
                      width: '100%',
                      fontSize: cfs(17),
                      lineHeight: 17 * 1.45,
                      color: rgb('twitter-bright'),
                    },
                  ]}
                >
                  {linkifyUrl(text, fullInviteUrl)}
                </Text>

                <MiniShareCard
                  card={card}
                  background={CARD_BG}
                  border={rgb('twitter-slate', 0.2)}
                  marginTop={6}
                  narrowText
                />
                <Text
                  style={[
                    rj.semibold,
                    {
                      marginTop: 7,
                      fontSize: cfs(12),
                      color: rgb('twitter-meta'),
                    },
                  ]}
                >
                  Card attached as an image · alt text added automatically
                </Text>

                <InviteLinkBox
                  title="Join Superpower link in the post"
                  inviteUrl={inviteUrl}
                  onCopy={onCopyInvite}
                  tone={TONE}
                  compact
                  marginTop={11}
                />
              </View>
            </View>

            <View
              style={{
                marginTop: 16,
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {tags.map(t => (
                <Pressable
                  key={t.label}
                  onPress={t.onToggle}
                  accessibilityRole="button"
                  accessibilityLabel={t.label}
                  accessibilityState={{ selected: t.active }}
                >
                  <Animated.View
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: t.active
                        ? rgb('twitter-sky', 0.14)
                        : rgb('twitter-surface', 0.7),
                      borderWidth: 1,
                      borderColor: t.active
                        ? rgb('twitter-sky', 0.55)
                        : rgb('twitter-slate', 0.16),
                      transitionProperty: ['backgroundColor', 'borderColor'],
                      transitionDuration: 200,
                    }}
                  >
                    <Text
                      style={[
                        rj.bold,
                        {
                          fontSize: cfs(12),
                          letterSpacing: 12 * 0.04,
                          color: t.active
                            ? rgb('twitter-sky-light')
                            : rgb('twitter-inactive'),
                        },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </Animated.View>
                </Pressable>
              ))}
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                marginTop: 20,
                paddingTop: 16,
                borderTopWidth: 1,
                borderTopColor: rgb('twitter-slate', 0.14),
              }}
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                accessible
                accessibilityLabel={`${left} characters left`}
              >
                <View style={{ width: 26, height: 26, flexShrink: 0 }}>
                  <Svg
                    viewBox="0 0 36 36"
                    width={26}
                    height={26}
                    style={{ transform: [{ rotate: '-90deg' }] }}
                  >
                    <Circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke={rgb('twitter-slate', 0.2)}
                      strokeWidth={3.4}
                    />
                    <Circle
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
                  </Svg>
                </View>
                <Text
                  style={[rj.bold, { fontSize: cfs(13), color: ringColor }]}
                >
                  {left}
                </Text>
              </View>
              <Pressable
                onPress={onPost}
                disabled={postDisabled}
                accessibilityRole="button"
                accessibilityLabel="Post"
                accessibilityState={{ disabled: postDisabled }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 9,
                  paddingVertical: 13,
                  paddingHorizontal: 30,
                  borderRadius: 999,
                  experimental_backgroundImage: POST_BG,
                  boxShadow: POST_GLOW,
                  opacity: postDisabled ? 0.4 : 1,
                }}
              >
                <Text
                  style={[
                    rj.bold,
                    caps(cfs(13), 0.16),
                    { color: rgb('twitter-ink') },
                  ]}
                >
                  Post
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <SentPanel
            ring={{
              background: rgb('twitter-slate', 0.12),
              border: rgb('twitter-slate', 0.5),
              shadow: SENT_GLOW,
            }}
            tick={rgb('twitter-sent')}
            title="Posted on Twitter"
            titleColor={rgb('twitter-bright')}
            line={sentLine}
            lineColor={rgb('twitter-muted')}
            lineMaxWidth={380}
          >
            <PillButton
              label="Done"
              onPress={onClose}
              color={rgb('twitter-sent')}
              border={rgb('twitter-slate', 0.4)}
              background={TW_DONE_BG}
              paddingHorizontal={30}
            />
            <PillButton
              label="Edit and repost"
              onPress={onBack}
              color={rgb('twitter-meta')}
              paddingHorizontal={22}
            />
          </SentPanel>
        )}
      </ModalPanel>
    </ModalBackdrop>
  );
}
