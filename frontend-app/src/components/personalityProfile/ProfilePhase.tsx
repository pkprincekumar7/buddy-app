/**
 * The scrolling profile page (web PersonalityProfile PROFILE PHASE): share
 * row, header, trait diagram, the section cards and the onward CTAs.
 */
import React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import PageScroll from '@/components/layout/PageScroll';
import { css, rgb, textGlowRoom } from '@/theme';
import { PP } from './palette';
import { PAGE_IN } from './animations';
import { ArrowRightIcon, InstagramIcon, WhatsAppIcon } from './ProfileIcons';
import TraitDiagram from './TraitDiagram';
import {
  MindWorksCard,
  OwnWordsCard,
  ParentNote,
  StrengthsCard,
  ThinkersCard,
  type FamousPerson,
  type TraitScore,
} from './ProfileSections';
import { GOLD_PILL, SERIF, goldPillText } from './styles';

const PAGE_BG = css(
  'linear-gradient(180deg,rgb(var(--constellation-navy-black-rgb)) 0%, rgb(var(--constellation-black-navy-rgb)) 50%, rgb(var(--constellation-black-navy2-rgb)) 100%)',
);
const WRAPPER_BG = css(
  `radial-gradient(120% 80% at 50% -10%, ${PP.wrapperGlowTop} 0%, rgb(var(--constellation-navy-glow-rgb) / 0) 60%), radial-gradient(90% 60% at 50% 108%, ${PP.wrapperGlowBottom} 0%, rgb(var(--constellation-navy-glow-rgb) / 0) 65%), linear-gradient(180deg,rgb(var(--constellation-navy-black-rgb)) 0%, rgb(var(--constellation-black-navy-rgb)) 50%, rgb(var(--constellation-black-navy2-rgb)) 100%)`,
);
const WRAPPER_SHADOW = css('0 24px 80px rgb(var(--black-rgb) / .5)');
const DIVIDER_BG = css(
  'linear-gradient(90deg, transparent, rgb(var(--constellation-gold-light-rgb) / .85), transparent)',
);
const DIAMOND_GLOW = css(
  '0 0 18px 5px rgb(var(--constellation-gold-light-rgb) / .65)',
);
const GOLD_HAZY = rgb('constellation-gold-hazy');

export interface ProfilePhaseProps {
  childName: string;
  childAge: string;
  typeTitle: string;
  initials: string;
  avatarId: string;
  avatarUrl: string;
  traits: string[];
  traitScores: TraitScore[];
  famousPeople: FamousPerson[];
  strengths: string[];
  childQuote: string;
  parentNote: string;
  onShare: (platform: 'instagram' | 'whatsapp') => void;
  onReplay: () => void;
  onExploreGrow: () => void;
}

export default function ProfilePhase(p: ProfilePhaseProps) {
  const { width: vw } = useWindowDimensions();
  const isWide = vw >= 700;
  // clamp(18px, calc(18px + (100vw - 375px) * 18 / 477), 36px)
  const pad = Math.min(36, Math.max(18, 18 + ((vw - 375) * 18) / 477));
  const sharePill = {
    ...GOLD_PILL,
    gap: isWide ? 8 : 0,
    paddingVertical: 9,
    paddingHorizontal: isWide ? 16 : 12,
  };

  return (
    <PageScroll contentContainerStyle={{ flexGrow: 1 }}>
      <View
        style={{
          flexGrow: 1,
          experimental_backgroundImage: PAGE_BG,
          paddingTop: 40,
          paddingHorizontal: 16,
          paddingBottom: 80,
        }}
      >
        <Animated.View
          style={[
            {
              width: '100%',
              maxWidth: 820,
              alignSelf: 'center',
              padding: pad,
              experimental_backgroundImage: WRAPPER_BG,
              borderWidth: 1,
              borderColor: rgb('constellation-blue-line', 0.28),
              borderRadius: isWide ? 22 : 14,
              boxShadow: WRAPPER_SHADOW,
              overflow: 'hidden',
            },
            PAGE_IN,
          ]}
        >
          <View style={{ gap: 26 }}>
            {/* ── Share row ── */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  letterSpacing: 11 * 0.22,
                  textTransform: 'uppercase',
                  color: rgb('constellation-blue-mid'),
                }}
              >
                Share on
              </Text>
              <Pressable
                onPress={() => p.onShare('instagram')}
                accessibilityRole="button"
                accessibilityLabel="Share on Instagram"
                style={sharePill}
              >
                <InstagramIcon color={GOLD_HAZY} />
                {isWide ? (
                  <Text style={goldPillText(12)}>Instagram</Text>
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => p.onShare('whatsapp')}
                accessibilityRole="button"
                accessibilityLabel="Share on WhatsApp"
                style={sharePill}
              >
                <WhatsAppIcon color={GOLD_HAZY} />
                {isWide ? <Text style={goldPillText(12)}>WhatsApp</Text> : null}
              </Pressable>
            </View>

            {/* ── Header ── */}
            <View style={{ alignItems: 'center', gap: 6, marginTop: -14 }}>
              <Text
                style={{
                  fontSize: 13,
                  letterSpacing: 13 * 0.42,
                  textTransform: 'uppercase',
                  textAlign: 'center',
                  color: rgb('constellation-blue-strong'),
                }}
              >
                Personality Analysis
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                <Text
                  accessibilityRole="header"
                  style={[
                    SERIF,
                    {
                      flexShrink: 1,
                      fontSize: isWide ? 54 : 32,
                      lineHeight: isWide ? 54 : 32,
                      textAlign: 'center',
                      color: rgb('constellation-blue-pale'),
                      textShadowColor: PP.headerTitleGlow,
                      textShadowOffset: { width: 0, height: 0 },
                      textShadowRadius: 26,
                      ...textGlowRoom(26),
                    },
                  ]}
                >
                  {p.childName} the{' '}
                  <Text
                    style={{
                      fontStyle: 'italic',
                      color: rgb('constellation-blue-deep'),
                    }}
                  >
                    {p.typeTitle}
                  </Text>
                </Text>
                <View
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: rgb('constellation-gold-light'),
                    borderRadius: 2,
                    transform: [{ rotate: '45deg' }],
                    boxShadow: DIAMOND_GLOW,
                    flexShrink: 0,
                  }}
                />
              </View>
              <View
                style={{
                  width: 120,
                  height: 1,
                  experimental_backgroundImage: DIVIDER_BG,
                  marginTop: 4,
                  marginBottom: 2,
                }}
              />
              <Text
                style={{
                  fontSize: 14,
                  letterSpacing: 14 * 0.18,
                  textTransform: 'uppercase',
                  color: PP.headerMeta,
                  textAlign: 'center',
                }}
              >
                {[
                  p.childName,
                  p.childAge ? `Age ${p.childAge}` : '',
                  p.typeTitle,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>

            {/* ── Trait diagram ── */}
            {p.traits.length > 0 && (
              <TraitDiagram
                traits={p.traits}
                childName={p.childName}
                initials={p.initials}
                avatarId={p.avatarId}
                avatarUrl={p.avatarUrl}
              />
            )}

            {p.traitScores.length > 0 && (
              <MindWorksCard
                childName={p.childName}
                traitScores={p.traitScores}
              />
            )}
            {p.famousPeople.length > 0 && (
              <ThinkersCard
                childName={p.childName}
                famousPeople={p.famousPeople}
              />
            )}
            {p.strengths.length > 0 && (
              <StrengthsCard strengths={p.strengths} isWide={isWide} />
            )}
            {p.childQuote ? (
              <OwnWordsCard childName={p.childName} childQuote={p.childQuote} />
            ) : null}
            {p.parentNote ? <ParentNote parentNote={p.parentNote} /> : null}

            {/* ── Replay link + onward CTA ── */}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Pressable
                onPress={p.onReplay}
                accessibilityRole="button"
                accessibilityLabel="Replay the reveal"
                style={{ paddingVertical: 6, paddingHorizontal: 10 }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    letterSpacing: 13 * 0.22,
                    textTransform: 'uppercase',
                    color: PP.replayLink,
                  }}
                >
                  Replay the reveal
                </Text>
              </Pressable>
              <Pressable
                onPress={p.onExploreGrow}
                accessibilityRole="button"
                accessibilityLabel="Explore Grow"
                style={{
                  ...GOLD_PILL,
                  gap: 8,
                  paddingVertical: 11,
                  paddingHorizontal: 22,
                }}
              >
                <Text style={goldPillText(13)}>Explore Grow</Text>
                <ArrowRightIcon color={GOLD_HAZY} />
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </PageScroll>
  );
}
