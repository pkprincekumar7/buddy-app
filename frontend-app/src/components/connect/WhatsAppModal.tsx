import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { css, rgb } from '@/theme';
import {
  ArrowRightIcon,
  BrandBadge,
  caps,
  cfs,
  CheckTickIcon,
  InviteLinkBox,
  linkifyUrl,
  MiniShareCard,
  ModalBackdrop,
  ModalCloseButton,
  ModalHeader,
  ModalPanel,
  orb,
  PillButton,
  rj,
  SectionLabel,
  SentPanel,
  WhatsAppIcon,
  type InviteTone,
  type WaContact,
} from './shared';
import {
  WA_DONE_BG,
  WA_PANEL_FROM,
  WA_PANEL_SHADOW,
  WA_PANEL_TO,
} from './palette';

interface WhatsAppModalProps {
  mode: 'compose' | 'sent';
  childName: string;
  /** The shared card being posted — same content shown across every destination. */
  card: { kind: string; title: string; caption: string; date: string };
  message: string;
  contacts: WaContact[];
  picked: number[];
  onTogglePicked: (i: number) => void;
  inviteUrl: string;
  onCopyInvite: () => void;
  onSend: () => void;
  onClose: () => void;
  sentLine: string;
}

const BACKDROP = css(
  'radial-gradient(ellipse at 50% 40%,rgb(var(--constellation-overlay-rgb) / .72),rgb(var(--constellation-void-rgb) / .94) 72%)',
);
const PANEL_BG = `linear-gradient(165deg,${WA_PANEL_FROM},${WA_PANEL_TO})`;
const PANEL_SHADOW = `0 30px 90px ${WA_PANEL_SHADOW}`;
const BADGE_BG = css(
  'linear-gradient(150deg,rgb(var(--whatsapp-badge-a-rgb) / .95),rgb(var(--whatsapp-badge-b-rgb) / .95))',
);
const CARD_BG = css(
  'linear-gradient(165deg,rgb(var(--constellation-panel-a-rgb)),rgb(var(--constellation-panel-deep-rgb)))',
);
const SEND_BG = css(
  'linear-gradient(135deg,rgb(var(--whatsapp-bright-rgb)),rgb(var(--whatsapp-dark-rgb)))',
);
const SEND_GLOW = css('0 0 26px rgb(var(--whatsapp-green-rgb) / .4)');
const SENT_GLOW = css('0 0 30px rgb(var(--whatsapp-green-rgb) / .25)');
const TONE: InviteTone = {
  boxBg: rgb('whatsapp-green', 0.07),
  boxBorder: rgb('whatsapp-green', 0.35),
  iconBg: rgb('whatsapp-green', 0.14),
  iconBorder: rgb('whatsapp-green', 0.3),
  icon: rgb('whatsapp-bright'),
  title: rgb('whatsapp-text'),
  meta: rgb('whatsapp-meta'),
  btnBorder: rgb('whatsapp-green', 0.45),
  btnText: rgb('whatsapp-cta'),
};

export default function WhatsAppModal({
  mode,
  childName,
  card,
  message,
  contacts,
  picked,
  onTogglePicked,
  inviteUrl,
  onCopyInvite,
  onSend,
  onClose,
  sentLine,
}: WhatsAppModalProps) {
  const fullInviteUrl = `https://${inviteUrl}`;
  const disabled = picked.length === 0;
  const count =
    picked.length === 0
      ? 'Choose at least one'
      : `${picked.length} ${
          picked.length === 1 ? 'chat selected' : 'chats selected'
        }`;

  return (
    <ModalBackdrop
      gradient={BACKDROP}
      onClose={onClose}
      label="Share on WhatsApp"
    >
      <ModalPanel
        background={PANEL_BG}
        border={rgb('whatsapp-green', 0.35)}
        shadow={PANEL_SHADOW}
      >
        <ModalCloseButton
          onPress={onClose}
          color={rgb('whatsapp-muted')}
          border={rgb('whatsapp-green', 0.28)}
        />

        {mode === 'compose' ? (
          <View>
            <ModalHeader
              badge={
                <BrandBadge
                  background={BADGE_BG}
                  border={rgb('whatsapp-green', 0.5)}
                >
                  <WhatsAppIcon size={19} />
                </BrandBadge>
              }
              title="Share on WhatsApp"
              titleColor={rgb('whatsapp-text')}
              subtitle={`${childName}’s card, ready to go`}
              subtitleColor={rgb('whatsapp-muted')}
            />

            <View
              style={{
                marginTop: 20,
                borderRadius: 16,
                paddingVertical: 16,
                paddingHorizontal: 17,
                backgroundColor: rgb('whatsapp-surface', 0.6),
                borderWidth: 1,
                borderColor: rgb('whatsapp-green', 0.16),
              }}
            >
              <SectionLabel color={rgb('whatsapp-label')}>Message</SectionLabel>
              <View
                style={{
                  marginTop: 7,
                  width: '100%',
                  borderRadius: 11,
                  paddingVertical: 11,
                  paddingHorizontal: 13,
                  backgroundColor: rgb('whatsapp-surface', 0.85),
                  borderWidth: 1,
                  borderColor: rgb('whatsapp-green', 0.24),
                }}
              >
                <Text
                  style={[
                    rj.semibold,
                    {
                      fontSize: cfs(14.5),
                      lineHeight: 14.5 * 1.5,
                      color: rgb('whatsapp-text'),
                    },
                  ]}
                >
                  {linkifyUrl(message, fullInviteUrl)}
                </Text>
              </View>

              <MiniShareCard
                card={card}
                background={CARD_BG}
                border={rgb('constellation-gold', 0.35)}
                marginTop={12}
              />
            </View>

            <InviteLinkBox
              title="Join Superpower link included"
              inviteUrl={inviteUrl}
              onCopy={onCopyInvite}
              tone={TONE}
              marginTop={12}
            />

            <SectionLabel color={rgb('whatsapp-label')} marginTop={20}>
              Send to
            </SectionLabel>
            <View style={{ flexDirection: 'column', gap: 8, marginTop: 11 }}>
              {contacts.map((c, i) => {
                const on = picked.includes(i);
                return (
                  <Pressable
                    key={c.name}
                    onPress={() => onTogglePicked(i)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${c.name}, ${c.meta}`}
                  >
                    <Animated.View
                      style={{
                        flexDirection: 'row',
                        gap: 12,
                        alignItems: 'center',
                        borderRadius: 13,
                        paddingVertical: 11,
                        paddingHorizontal: 14,
                        backgroundColor: on
                          ? rgb('whatsapp-green', 0.1)
                          : rgb('whatsapp-surface', 0.6),
                        borderWidth: 1,
                        borderColor: on
                          ? rgb('whatsapp-green', 0.5)
                          : rgb('whatsapp-green', 0.14),
                        transitionProperty: ['backgroundColor', 'borderColor'],
                        transitionDuration: 200,
                      }}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: rgb('whatsapp-green', 0.12),
                          borderWidth: 1,
                          borderColor: rgb('whatsapp-green', 0.3),
                        }}
                      >
                        <Text
                          style={[
                            orb.bold,
                            {
                              fontSize: cfs(12),
                              color: rgb('whatsapp-initials'),
                            },
                          ]}
                        >
                          {c.initials}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[
                            rj.bold,
                            {
                              fontSize: cfs(14.5),
                              color: rgb('whatsapp-text'),
                            },
                          ]}
                        >
                          {c.name}
                        </Text>
                        <Text
                          style={[
                            rj.semibold,
                            {
                              marginTop: 1,
                              fontSize: cfs(12.5),
                              color: rgb('whatsapp-meta'),
                            },
                          ]}
                        >
                          {c.meta}
                        </Text>
                      </View>
                      <View style={{ width: 20, alignItems: 'center' }}>
                        <Animated.View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 6,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 1.5,
                            borderColor: on
                              ? rgb('whatsapp-bright')
                              : rgb('whatsapp-faint', 0.4),
                            backgroundColor: on
                              ? rgb('whatsapp-bright')
                              : 'transparent',
                            transitionProperty: [
                              'backgroundColor',
                              'borderColor',
                            ],
                            transitionDuration: 200,
                          }}
                        >
                          <CheckTickIcon
                            size={11}
                            color={rgb('whatsapp-ink-deep')}
                            opacity={on ? 1 : 0}
                          />
                        </Animated.View>
                      </View>
                    </Animated.View>
                  </Pressable>
                );
              })}
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 22,
              }}
            >
              <Text
                style={[
                  rj.bold,
                  caps(cfs(12), 0.1),
                  { flexShrink: 1, color: rgb('whatsapp-label') },
                ]}
              >
                {count}
              </Text>
              <Pressable
                onPress={onSend}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 9,
                  paddingVertical: 13,
                  paddingHorizontal: 28,
                  borderRadius: 999,
                  experimental_backgroundImage: SEND_BG,
                  boxShadow: SEND_GLOW,
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                <Text
                  style={[
                    rj.bold,
                    caps(cfs(13), 0.16),
                    { color: rgb('whatsapp-ink') },
                  ]}
                >
                  Send
                </Text>
                <ArrowRightIcon color={rgb('whatsapp-ink')} />
              </Pressable>
            </View>
          </View>
        ) : (
          <SentPanel
            ring={{
              background: rgb('whatsapp-green', 0.14),
              border: rgb('whatsapp-green', 0.55),
              shadow: SENT_GLOW,
            }}
            tick={rgb('whatsapp-bright')}
            title="Sent on WhatsApp"
            titleColor={rgb('whatsapp-text')}
            line={sentLine}
            lineColor={rgb('whatsapp-muted')}
            lineMaxWidth={360}
          >
            <PillButton
              label="Done"
              onPress={onClose}
              color={rgb('whatsapp-cta')}
              border={rgb('whatsapp-green', 0.45)}
              background={WA_DONE_BG}
              paddingHorizontal={30}
            />
          </SentPanel>
        )}
      </ModalPanel>
    </ModalBackdrop>
  );
}
