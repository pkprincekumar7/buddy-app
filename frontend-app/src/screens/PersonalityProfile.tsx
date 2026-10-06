/**
 * Personality Profile ("Discover") — port of frontend/src/pages/PersonalityProfile.tsx.
 * Loads the child's saved personality view_model, plays the reveal, then shows
 * the scrolling profile. View pieces live in components/personalityProfile/.
 */
import React, { useEffect, useState } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { useNavigate, useParams } from '@/lib/router';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { env } from '@/lib/env';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { rgb } from '@/theme';
import RevealPhase from '@/components/personalityProfile/RevealPhase';
import ProfilePhase from '@/components/personalityProfile/ProfilePhase';
import { SPIN_1S } from '@/components/personalityProfile/animations';
import type {
  FamousPerson,
  TraitScore,
} from '@/components/personalityProfile/ProfileSections';

type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

const SCENE = [
  StyleSheet.absoluteFill,
  { backgroundColor: rgb('constellation-navy-black') },
];

export default function PersonalityProfile() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [profile, setProfile] = useState<ProfileType>(null);
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [vmProfile, setVmProfile] = useState<Record<string, unknown> | null>(
    null,
  );
  const [vmScores, setVmScores] = useState<Record<string, number> | null>(null);
  const [avatarId, setAvatarId] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [displayPhase, setDisplayPhase] = useState<'reveal' | 'profile'>(
    'reveal',
  );

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          navigate('/Home', { replace: true });
          return;
        }
        const vm = child.personality?.view_model;
        if (!vm?.profile?.name) {
          navigate(`/PersonalityJourney/${childId}`, { replace: true });
          return;
        }
        const merged = mergeChildDraft(
          normalizeOnboardingChildDataBlob(child) ?? {},
        );
        setChildName(merged.name || '');
        setChildAge(
          String(
            ((merged as Record<string, unknown>).age as string | number) ?? '',
          ),
        );
        setVmProfile(vm.profile);
        setVmScores((vm.scores as Record<string, number>) ?? null);
        setAvatarId(typeof child.avatar_id === 'string' ? child.avatar_id : '');
        setAvatarUrl(
          typeof child.avatar_url === 'string' ? child.avatar_url : '',
        );
        setProfile(onboardingProfileFromViewModel(vm));
        setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityProfile] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  // Auto-advance reveal → profile
  useEffect(() => {
    if (isLoadingAuth || isInitializing) return;
    const t = setTimeout(() => setDisplayPhase('profile'), 5500);
    return () => clearTimeout(t);
  }, [isLoadingAuth, isInitializing]);

  const status =
    isLoadingAuth || isInitializing ? 'loading' : initError ? 'error' : 'ready';

  if (status === 'loading') {
    return (
      <View style={[SCENE, { alignItems: 'center', justifyContent: 'center' }]}>
        <Animated.View
          accessibilityRole="progressbar"
          accessibilityLabel="Loading"
          style={[
            {
              width: 36,
              height: 36,
              borderRadius: 18,
              borderWidth: 2,
              borderColor: rgb('constellation-gold-light', 0.55),
              borderTopColor: 'transparent',
            },
            SPIN_1S,
          ]}
        />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View
        style={[
          SCENE,
          {
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
          },
        ]}
      >
        <Text
          style={{ color: rgb('constellation-blue-mid'), textAlign: 'center' }}
        >
          Something went wrong. Please try again.
        </Text>
        <Pressable
          onPress={() => navigate('/Home')}
          accessibilityRole="button"
          accessibilityLabel="Go Back"
          style={{
            paddingVertical: 10,
            paddingHorizontal: 32,
            borderRadius: 100,
            borderWidth: 1,
            borderColor: rgb('constellation-gold-light', 0.6),
            backgroundColor: rgb('constellation-blue-royal', 0.45),
          }}
        >
          <Text style={{ color: rgb('constellation-gold-hazy'), fontSize: 14 }}>
            Go Back
          </Text>
        </Pressable>
      </View>
    );
  }

  const personalityType = profile?.personality_type ?? '';
  const typeTitle =
    personalityType?.split(' - ')[1] ?? personalityType ?? 'Unique';
  const summary = profile?.summary ?? '';
  const traits = (vmProfile?.traits as string[] | undefined) ?? [];
  const strengths = (profile?.top_strengths as string[] | undefined) ?? [];
  const famousPeople =
    (vmProfile?.famous_people as FamousPerson[] | undefined) ?? [];
  const traitScoresFromProfile =
    (vmProfile?.trait_scores as TraitScore[] | undefined) ?? [];
  // Fallback: derive from view_model.scores when profile.trait_scores is absent (older data)
  const traitScores: TraitScore[] =
    traitScoresFromProfile.length > 0
      ? traitScoresFromProfile
      : Object.entries(vmScores ?? {})
          .map(([label, score]) => ({ label, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
  const childQuote =
    typeof vmProfile?.child_quote === 'string' ? vmProfile.child_quote : '';
  const parentNote =
    typeof vmProfile?.parent_note === 'string' ? vmProfile.parent_note : '';
  const initials = childName
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  function handleShare(platform: 'instagram' | 'whatsapp') {
    const text = `${childName}'s personality analysis is in — ${typeTitle}!`;
    // Web shares window.location.href; the app has no page URL, so share the
    // web route for this page on the configured web/CDN origin.
    const url = `${env.CDN_BASE_URL}/PersonalityProfile/${childId ?? ''}`;
    if (platform === 'whatsapp') {
      Linking.openURL(
        `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`,
      ).catch((err: unknown) =>
        console.warn('[PersonalityProfile] WhatsApp share failed:', err),
      );
      return;
    }
    // Instagram: no direct URL share — use the native share sheet (web: Web Share API)
    Share.share({
      title: `${childName} the ${typeTitle}`,
      message: `${text} ${url}`,
    }).catch((err: unknown) =>
      console.warn('[PersonalityProfile] Share failed:', err),
    );
  }

  // ── REVEAL PHASE ──
  if (displayPhase === 'reveal') {
    return (
      <RevealPhase
        childName={childName}
        typeTitle={typeTitle}
        summary={summary}
        onContinue={() => setDisplayPhase('profile')}
      />
    );
  }

  // ── PROFILE PHASE ──
  return (
    <ProfilePhase
      childName={childName}
      childAge={childAge}
      typeTitle={typeTitle}
      initials={initials}
      avatarId={avatarId}
      avatarUrl={avatarUrl}
      traits={traits}
      traitScores={traitScores}
      famousPeople={famousPeople}
      strengths={strengths}
      childQuote={childQuote}
      parentNote={parentNote}
      onShare={handleShare}
      onReplay={() => setDisplayPhase('reveal')}
      onExploreGrow={() => navigate(`/GrowthAreas/${childId ?? ''}`)}
    />
  );
}
