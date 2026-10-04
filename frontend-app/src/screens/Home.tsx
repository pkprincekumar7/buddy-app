import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Brain,
  Dumbbell,
  Heart,
  Palette,
  Plus,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useNavigate } from '@/lib/router';
import { api } from '@/api/client';
import ChildCard from '@/components/shared/ChildCard';
import PageLoader from '@/components/shared/PageLoader';
import PageScroll from '@/components/layout/PageScroll';
import {
  Reveal,
  RevealProvider,
  useRevealNotifier,
} from '@/components/home/Reveal';
import { Button } from '@/components/ui/button';
import { PILLAR_GLOW_COLORS } from '@/lib/gradientColors';
import { color, css, glow, recipe, rgb, type HslToken } from '@/theme';

// The web's Android-browser APK download banner (IS_ANDROID_BROWSER) is web-only —
// "the React Native app has its own update flow" — so it is intentionally not ported.

// FEATURE HIDDEN on the web (`{false && (...)}`): children management section.
// Flip to true together with the web when re-enabling (see the web comment).
const SHOW_CHILDREN_SECTION = false;

const PILLARS: {
  icon: LucideIcon;
  label: string;
  from: HslToken;
  to: HslToken;
  glow: string;
  description: string;
}[] = [
  {
    icon: Brain,
    label: 'Mind',
    from: 'info-medium',
    to: 'info-strong',
    glow: PILLAR_GLOW_COLORS.mind,
    description: 'Cognitive growth & curiosity',
  },
  {
    icon: Heart,
    label: 'Heart',
    from: 'error-medium',
    to: 'error-strong',
    glow: PILLAR_GLOW_COLORS.heart,
    description: 'Emotional intelligence',
  },
  {
    icon: Dumbbell,
    label: 'Body',
    from: 'success',
    to: 'success-strong',
    glow: PILLAR_GLOW_COLORS.body,
    description: 'Physical wellbeing',
  },
  {
    icon: Palette,
    label: 'Talents',
    from: 'personality',
    to: 'personality-alt-strong',
    glow: PILLAR_GLOW_COLORS.talents,
    description: 'Skill discovery',
  },
  {
    icon: Star,
    label: 'Character',
    from: 'warning-medium',
    to: 'warning-strong',
    glow: PILLAR_GLOW_COLORS.character,
    description: 'Values & integrity',
  },
  {
    icon: Rocket,
    label: 'Future',
    from: 'primary-medium',
    to: 'primary-stronger',
    glow: PILLAR_GLOW_COLORS.future,
    description: 'Life direction',
  },
];

const PILLAR_STYLES = PILLARS.map(p => ({
  experimental_backgroundImage: css(
    `linear-gradient(to bottom right, hsl(var(--${p.from})), hsl(var(--${p.to})))`,
  ),
  boxShadow: glow.pillar(p.glow),
}));

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Users,
    title: 'Parent Onboarding',
    description:
      "Share insights about your child's personality, interests, and your family values to create their unique baseline profile.",
  },
  {
    icon: Sparkles,
    title: 'Weekly Missions',
    description:
      'Balanced activities across all 6 pillars keep growth consistent, fun, and achievable without overwhelm.',
  },
  {
    icon: Shield,
    title: 'Growth Insights',
    description:
      'Receive observations about emerging strengths, patterns, and conversation prompts to deepen connection.',
  },
];

// Web `blur-3xl` ambient glows → soft radial gradients (RN has no CSS blur).
const softGlow = (token: HslToken, alpha: number) =>
  css(`radial-gradient(hsl(var(--${token}) / ${alpha}) 35%, transparent 70%)`);
const HERO_GLOW_TOP = {
  experimental_backgroundImage: softGlow('primary', 0.04),
};
const HERO_GLOW_LEFT = {
  experimental_backgroundImage: softGlow('primary', 0.05),
};
const HERO_GLOW_RIGHT = {
  experimental_backgroundImage: softGlow('personality', 0.04),
};
const CTA_TINT = {
  experimental_backgroundImage: css(
    'linear-gradient(to bottom right, hsl(var(--primary-medium) / 0.04), transparent, hsl(var(--personality) / 0.04))',
  ),
};
const CTA_GLOW = { experimental_backgroundImage: softGlow('primary', 0.06) };
const FOOTER_LOGO = {
  experimental_backgroundImage: css(
    'linear-gradient(to bottom right, hsl(var(--primary)), hsl(var(--primary-dark)))',
  ),
};

// Web `bg-gradient-to-r from-primary to-primary-light bg-clip-text` on the
// headline span. RN can't clip a gradient to text without a masked view, so
// each word takes the gradient's color at its position along the span.
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map(c => c + c)
          .join('')
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const ch = (i: 0 | 1 | 2) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
const HEADLINE_ACCENT_WORDS = ['Unlock', 'Their', 'Super', 'Powers'];
const HEADLINE_ACCENT_COLORS = HEADLINE_ACCENT_WORDS.map((_, i) =>
  mixHex(
    color.primary,
    color['primary-light'],
    (i + 0.5) / HEADLINE_ACCENT_WORDS.length,
  ),
);

// framer `initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2 }}`.
const HERO_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 30 }] },
  100: {
    opacity: 1,
    transform: [{ translateY: 0 }],
    easing: Easing.out(Easing.ease),
  },
}).duration(1200);

// Web h1/h2/p sizes with their leading/tracking resolved to px.
const s = StyleSheet.create({
  h1: { fontSize: 36, lineHeight: 45, letterSpacing: -0.9 },
  h2: { fontSize: 30, lineHeight: 36, letterSpacing: -0.75 },
  leadLg: { lineHeight: 29.25 }, // text-lg leading-relaxed
  leadBase: { lineHeight: 26 }, // text-base leading-relaxed
  leadSm: { lineHeight: 22.75 }, // text-sm leading-relaxed
  iconLeft: { marginRight: 8 }, // web mr-2 on top of the button's gap-2
  iconRight: { marginLeft: 8 },
  iconLeftSm: { marginRight: 6 },
  heroGlowTop: { left: '50%', marginLeft: -300 }, // left-1/2 -translate-x-1/2 (w-[600px])
  ctaGlow: { left: '50%', marginLeft: -192 }, // left-1/2 -translate-x-1/2 (w-96)
});

const ICON_WHITE = rgb('white');

export default function Home() {
  const navigate = useNavigate();
  const { notify, value: revealCtx } = useRevealNotifier();

  const { data: childrenRaw = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date'),
  });
  const children = Array.isArray(childrenRaw) ? childrenRaw : [];

  const handleStartJourney = () => {
    void navigate('/Onboarding');
  };

  // TO ENABLE MULTIPLE CHILDREN: replace children[0] with the child the user selected.
  const firstChild = children[0]?.id ? children[0] : null;

  if (isLoading) {
    return <PageLoader />;
  }

  return (
    <RevealProvider value={revealCtx}>
      <PageScroll onScroll={notify} scrollEventThrottle={32}>
        {/* Hero */}
        <View className="relative overflow-hidden">
          {/* Ambient glows */}
          <View
            pointerEvents="none"
            className="absolute top-0 h-[400px] w-[600px] rounded-full"
            style={[s.heroGlowTop, HERO_GLOW_TOP]}
          />
          <View
            pointerEvents="none"
            className="absolute left-10 top-40 h-72 w-72 rounded-full"
            style={HERO_GLOW_LEFT}
          />
          <View
            pointerEvents="none"
            className="absolute bottom-0 right-10 h-96 w-96 rounded-full"
            style={HERO_GLOW_RIGHT}
          />

          {/* Padding was previously shrunk when children existed (py-8) — see web comment. */}
          <View className="relative px-4 py-24">
            <Animated.View entering={HERO_ENTER} className="items-center">
              <View className="mb-8 flex-row items-center gap-2 self-center rounded-full border border-primary/20 bg-primary/10 px-4 py-2">
                <Text className="text-center text-sm font-medium text-primary">
                  A Transformational Journey for Your Child
                </Text>
              </View>

              <Text
                accessibilityRole="header"
                className="mb-6 px-4 text-center font-bold text-foreground"
                style={s.h1}
              >
                Preparing Children to{' '}
                {HEADLINE_ACCENT_WORDS.map((word, i) => (
                  <Text key={word} style={{ color: HEADLINE_ACCENT_COLORS[i] }}>
                    {word}
                    {i < HEADLINE_ACCENT_WORDS.length - 1 ? ' ' : ''}
                  </Text>
                ))}
              </Text>

              <Text
                className="mb-10 text-center text-lg text-muted-foreground"
                style={s.leadLg}
              >
                A guided journey to uncover strengths, build confidence, and
                grow into a thoughtful, capable individual.
              </Text>

              <View className="items-center justify-center gap-4">
                {children.length === 0 ? (
                  <Button
                    size="xl"
                    onPress={handleStartJourney}
                    accessibilityLabel="Start Your Journey"
                    className="rounded-full font-semibold text-primary-foreground"
                    style={recipe.btnPrimary}
                  >
                    <Sparkles
                      size={16}
                      color={color['primary-foreground']}
                      style={s.iconLeft}
                    />
                    Start Your Journey
                    <ArrowRight
                      size={16}
                      color={color['primary-foreground']}
                      style={s.iconRight}
                    />
                  </Button>
                ) : (
                  // "Continue Your Journey" is shown here because the children management
                  // section below is hidden (see the web comment).
                  <Button
                    size="xl"
                    onPress={() =>
                      void navigate(
                        firstChild
                          ? `/Onboarding/${firstChild.id}`
                          : '/Onboarding',
                      )
                    }
                    accessibilityLabel="Continue Your Journey"
                    className="rounded-full font-semibold text-primary-foreground"
                    style={recipe.btnPrimary}
                  >
                    <Sparkles
                      size={16}
                      color={color['primary-foreground']}
                      style={s.iconLeft}
                    />
                    Continue Your Journey
                    <ArrowRight
                      size={16}
                      color={color['primary-foreground']}
                      style={s.iconRight}
                    />
                  </Button>
                )}
              </View>
            </Animated.View>
          </View>
        </View>

        {/* FEATURE HIDDEN: Children management section (add child, child cards, delete child). */}
        {SHOW_CHILDREN_SECTION && (
          <View className="py-10">
            <View className="px-4">
              <Reveal y={16} delay={0.2} duration={0.6}>
                <View className="mb-4 flex-row items-center justify-between">
                  <Text
                    accessibilityRole="header"
                    className="text-lg font-semibold text-foreground"
                  >
                    Your Children
                  </Text>
                  <View className="items-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => {
                        void navigate('/Onboarding', {
                          state: { forceNew: true },
                        });
                      }}
                      disabled={children.length >= 10}
                      accessibilityLabel="Add Child"
                      className="rounded-xl"
                    >
                      <Plus
                        size={14}
                        color={color.foreground}
                        style={s.iconLeftSm}
                      />
                      Add Child
                    </Button>
                    {children.length >= 10 && (
                      <Text className="text-xs text-muted-foreground">
                        Maximum of 10 children reached.
                      </Text>
                    )}
                  </View>
                </View>

                {children.length === 0 ? (
                  <View className="flex-row flex-wrap items-center justify-center rounded-2xl border border-dashed border-border py-8">
                    <Text className="text-center text-sm text-muted-foreground">
                      No children yet.{' '}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Add your first child"
                      onPress={() => {
                        void navigate('/Onboarding', {
                          state: { forceNew: true },
                        });
                      }}
                    >
                      <Text className="text-sm text-primary underline">
                        Add your first child
                      </Text>
                    </Pressable>
                    <Text className="text-center text-sm text-muted-foreground">
                      {' '}
                      to begin their journey.
                    </Text>
                  </View>
                ) : (
                  <View className="gap-3">
                    {children.map(child => (
                      <ChildCard key={child.id} child={child} />
                    ))}
                  </View>
                )}
              </Reveal>
            </View>
          </View>
        )}

        {/* 6 Pillars */}
        <View className="px-4 py-20">
          <Reveal y={20} className="mb-14">
            <Text
              accessibilityRole="header"
              className="mb-4 text-center font-bold text-foreground"
              style={s.h2}
            >
              6 Pillars of Holistic Growth
            </Text>
            <Text className="text-center text-base text-muted-foreground">
              We nurture every dimension of your child&apos;s development for
              balanced, sustainable growth.
            </Text>
          </Reveal>

          <View className="gap-4">
            {PILLARS.map((pillar, index) => {
              const Icon = pillar.icon;
              return (
                <Reveal
                  key={pillar.label}
                  y={20}
                  delay={index * 0.12}
                  className="rounded-2xl border border-edge-faint bg-card p-6"
                >
                  <View
                    className="mb-4 h-12 w-12 items-center justify-center rounded-xl"
                    style={PILLAR_STYLES[index]}
                  >
                    <Icon size={24} color={ICON_WHITE} />
                  </View>
                  <Text
                    accessibilityRole="header"
                    className="mb-1.5 text-lg font-semibold text-foreground"
                  >
                    {pillar.label}
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    {pillar.description}
                  </Text>
                </Reveal>
              );
            })}
          </View>
        </View>

        {/* How It Works */}
        <View className="bg-section-alt px-4 py-20">
          <Reveal y={20} className="mb-14">
            <Text
              accessibilityRole="header"
              className="mb-4 text-center font-bold text-foreground"
              style={s.h2}
            >
              How It Works
            </Text>
          </Reveal>

          <View className="gap-8">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Reveal
                  key={feature.title}
                  y={20}
                  delay={index * 0.225}
                  className="items-center"
                >
                  <View className="mb-5 h-14 w-14 items-center justify-center rounded-2xl border border-edge bg-surface-elevated">
                    <Icon size={24} color={color.primary} />
                  </View>
                  <Text
                    accessibilityRole="header"
                    className="mb-2 text-center text-lg font-semibold text-foreground"
                  >
                    {feature.title}
                  </Text>
                  <Text
                    className="text-center text-sm text-muted-foreground"
                    style={s.leadSm}
                  >
                    {feature.description}
                  </Text>
                </Reveal>
              );
            })}
          </View>
        </View>

        {/* CTA — only shown to first-time visitors with no children yet */}
        {children.length === 0 && (
          <View className="px-4 py-20">
            <Reveal
              scale={0.97}
              className="relative overflow-hidden rounded-3xl border border-edge-faint bg-section-dark p-10"
            >
              <View
                pointerEvents="none"
                className="absolute inset-0"
                style={CTA_TINT}
              />
              <View
                pointerEvents="none"
                className="absolute top-0 h-32 w-96 rounded-full"
                style={[s.ctaGlow, CTA_GLOW]}
              />
              <View className="relative items-center">
                <Text
                  accessibilityRole="header"
                  className="mb-4 text-center font-bold text-foreground"
                  style={s.h2}
                >
                  Begin Your Child&apos;s Journey Today
                </Text>
                <Text
                  className="mb-8 text-center text-base text-muted-foreground"
                  style={s.leadBase}
                >
                  No pressure. No comparisons. Just guided, consistent growth
                  towards becoming their best self.
                </Text>
                <Button
                  size="xl"
                  onPress={handleStartJourney}
                  accessibilityLabel="Get Started Free"
                  className="rounded-full font-semibold text-primary-foreground"
                  style={recipe.btnPrimary}
                >
                  Get Started Free
                  <ArrowRight
                    size={16}
                    color={color['primary-foreground']}
                    style={s.iconRight}
                  />
                </Button>
              </View>
            </Reveal>
          </View>
        )}

        {/* Footer */}
        <View className="border-t border-edge-faint px-4 py-8">
          <View className="mb-2 flex-row items-center justify-center gap-2">
            <View
              className="h-5 w-5 items-center justify-center rounded-md"
              style={FOOTER_LOGO}
            >
              <Text className="text-[10px] font-bold text-white">B</Text>
            </View>
            <Text className="text-sm font-semibold text-foreground">
              Buddy360
            </Text>
          </View>
          <Text className="text-center text-xs text-muted-foreground">
            A Growth Companion for Raising Self-Aware, Capable, and
            Purpose-Driven Humans
          </Text>
        </View>
      </PageScroll>
    </RevealProvider>
  );
}
