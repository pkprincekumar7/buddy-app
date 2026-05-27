import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import Svg, {
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
  Defs,
} from 'react-native-svg';
import { Sparkles, Sprout } from 'lucide-react-native';
import { useSlideUpWhenReady } from '@/lib/animations';
import {
  personalityTypes,
  personalityCategories,
  type MbtiResult,
} from '@/lib/personalityLogic';
import { getInitials, nameToColor } from '@/lib/avatarUtils';

// ── Gradient lookup tables (match web personalityTypes/personalityCategories colors) ────
// Source: frontend/src/components/shared/PersonalityAnalysis.tsx – each type's `.color` field.
const TYPE_GRADIENT: Record<string, { from: string; to: string }> = {
  Ambitious:          { from: '#ef4444', to: '#db2777' },  // from-red-500 to-pink-600
  Determined:         { from: '#f97316', to: '#dc2626' },  // from-orange-500 to-red-600
  Outgoing:           { from: '#facc15', to: '#f97316' },  // from-yellow-400 to-orange-500
  Creative:           { from: '#c084fc', to: '#ec4899' },  // from-purple-400 to-pink-500
  Enthusiastic:       { from: '#34d399', to: '#eab308' },  // from-emerald-400 to-yellow-500
  Restless:           { from: '#fb923c', to: '#ef4444' },  // from-orange-400 to-red-500
  'Highly Energetic': { from: '#ef4444', to: '#eab308' },  // from-red-500 to-yellow-500
  Thinker:            { from: '#60a5fa', to: '#6366f1' },  // from-blue-400 to-indigo-500
  Playful:            { from: '#f472b6', to: '#a855f7' },  // from-pink-400 to-purple-500
};

const CATEGORY_GRADIENT: Record<string, { from: string; to: string }> = {
  motivators:  { from: '#ef4444', to: '#ea580c' },  // from-red-500 to-orange-600
  socializers: { from: '#facc15', to: '#f97316' },  // from-yellow-400 to-orange-500
  creatives:   { from: '#c084fc', to: '#ec4899' },  // from-purple-400 to-pink-500
  adventurers: { from: '#fb923c', to: '#ef4444' },  // from-orange-400 to-red-500
};

// ── Timing constants matching web PersonalityAnalysis ────────────────────────
// Web uses seconds; these are milliseconds for Reanimated.
const ANIM_BAR_ROW_BASE = 1900;
const ANIM_BAR_W_STEP   =  300;
const ANIM_FAMOUS_BASE  = 2700;
const ANIM_FAMOUS_STEP  =  300;

// Card background (hsl(0 0% 8%) ≈ #141414) — used as mask overlay for gradient bars
// so the unrevealed right portion matches the card surface.
const CARD_BG = '#141414';

const FAMOUS_LABEL: Record<string, string> = {
  Ambitious:          'Achievers',
  Determined:         'Strivers',
  Outgoing:           'Socializers',
  Creative:           'Creators',
  Enthusiastic:       'Enthusiasts',
  Restless:           'Explorers',
  'Highly Energetic': 'Energizers',
  Thinker:            'Thinkers',
  Playful:            'Players',
};

interface FamousPersonItem {
  name: string;
  image?: string;
}

interface PersonalityAnalysisProps {
  mbtiResult: MbtiResult;
  childName?: string;
  /**
   * When false, all entrance animations are held back (e.g. while a StageSplash
   * is still visible). Flip to true to release them.  Defaults to true so the
   * component works standalone.
   */
  ready?: boolean;
}

// ── GradientBadge ─────────────────────────────────────────────────────────────
// Renders a rounded pill with a horizontal SVG LinearGradient background.
// Mirrors web's `bg-gradient-to-r ${category.color}` on the category badge div.
function GradientBadge({
  gradient,
  children,
}: {
  gradient: { from: string; to: string };
  children: React.ReactNode;
}) {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  return (
    <View
      className="rounded-2xl overflow-hidden p-4 items-center"
      style={{ backgroundColor: gradient.from }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setDims({ w: width, h: height });
      }}
    >
      {dims.w > 0 && dims.h > 0 && (
        <Svg
          width={dims.w}
          height={dims.h}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <Defs>
            <SvgLinearGradient id="catGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={gradient.from} />
              <Stop offset="100%" stopColor={gradient.to} />
            </SvgLinearGradient>
          </Defs>
          <Rect width={dims.w} height={dims.h} fill="url(#catGrad)" />
        </Svg>
      )}
      {children}
    </View>
  );
}

// ── SlideSection ─────────────────────────────────────────────────────────────
// Gated slide-up wrapper — fires only once, when `ready` flips to true.
function SlideSection({
  delayMs,
  ready,
  children,
}: {
  delayMs: number;
  ready: boolean;
  children: React.ReactNode;
}) {
  const anim = useSlideUpWhenReady(ready, delayMs, 1000);
  return <Animated.View style={anim}>{children}</Animated.View>;
}

// ── FadeItem ──────────────────────────────────────────────────────────────────
// Lighter slide-up (shorter duration) for inline items like trait chips.
function FadeItem({
  delayMs,
  ready,
  children,
}: {
  delayMs: number;
  ready: boolean;
  children: React.ReactNode;
}) {
  const anim = useSlideUpWhenReady(ready, delayMs, 700);
  return <Animated.View style={anim}>{children}</Animated.View>;
}

// ── AnimatedBarRow ────────────────────────────────────────────────────────────
// SVG LinearGradient bar with animated mask-reveal.
// Technique: full-width gradient SVG is always rendered; an Animated.View
// "mask" covers the right portion from width=trackPx → width=(trackPx−targetPx),
// progressively revealing the gradient from left to right.
// Mirrors web's Framer Motion `width: 0 → percentage%` on the gradient div.
function AnimatedBarRow({
  name,
  percentage,
  gradient,
  delayMs,
  ready,
}: {
  name: string;
  percentage: number;
  gradient: { from: string; to: string };
  delayMs: number;
  ready: boolean;
}) {
  const rowOpacity = useSharedValue(0);
  const rowTransX  = useSharedValue(-16);
  // Start with a huge mask so gradient is hidden until ready fires.
  const maskWidth  = useSharedValue(9999);
  const [trackPx, setTrackPx] = useState(0);

  // Unique SVG gradient ID per bar — scoped within each <Svg> element.
  const gradId = `grad_${name.replace(/[\s']/g, '_')}`;

  useEffect(() => {
    if (!ready) return;
    const ease = Easing.out(Easing.ease);
    rowOpacity.value = withDelay(delayMs, withTiming(1, { duration: 700, easing: ease }));
    rowTransX.value  = withDelay(delayMs, withTiming(0, { duration: 700, easing: ease }));
  // rowOpacity / rowTransX are stable refs — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!ready || trackPx === 0) return;
    const targetPx  = trackPx * (percentage / 100);
    const finalMask = trackPx - targetPx;
    // Reset mask to full coverage so it starts from the right baseline,
    // then animate the reveal with the same 2.4 s easeInOut as web.
    maskWidth.value = trackPx;
    maskWidth.value = withDelay(delayMs + 100, withTiming(finalMask, {
      duration: 2400,
      easing: Easing.inOut(Easing.ease),
    }));
  // maskWidth is a stable ref — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, trackPx]);

  const rowStyle = useAnimatedStyle(() => ({
    opacity:   rowOpacity.value,
    transform: [{ translateX: rowTransX.value }],
  }));

  const maskStyle = useAnimatedStyle(() => ({
    position:        'absolute',
    right:           0,
    top:             0,
    bottom:          0,
    width:           maskWidth.value,
    backgroundColor: CARD_BG,
  }));

  return (
    <Animated.View style={rowStyle}>
      <View className="flex-row justify-between mb-1.5">
        <Text className="text-xs font-medium text-slate-300">{name}</Text>
        <Text className="text-xs text-slate-500">{Math.round(percentage)}%</Text>
      </View>
      {/* Track — bg-ghost-light = rgba(255,255,255,0.06), matches web */}
      <View
        style={{
          height:          8,
          borderRadius:    999,
          backgroundColor: 'rgba(255,255,255,0.06)',
          overflow:        'hidden',
        }}
        onLayout={(e) => setTrackPx(e.nativeEvent.layout.width)}
      >
        {trackPx > 0 && (
          <>
            {/* Full-width gradient — mask controls what's visible */}
            <Svg
              width={trackPx}
              height={8}
              style={{ position: 'absolute', top: 0, left: 0 }}
            >
              <Defs>
                <SvgLinearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0%" stopColor={gradient.from} />
                  <Stop offset="100%" stopColor={gradient.to} />
                </SvgLinearGradient>
              </Defs>
              <Rect width={trackPx} height={8} fill={`url(#${gradId})`} rx={4} />
            </Svg>
            {/* Animated mask — shrinks from right to reveal gradient */}
            <Animated.View style={maskStyle} />
          </>
        )}
      </View>
    </Animated.View>
  );
}

// ── FamousPersonCard ──────────────────────────────────────────────────────────
// Scale 0.85 → 1 + opacity fade, gated on `ready`.
// Uses border-c-md (border-2 border-white/10) matching web.
// SVG data URIs are invisible in RN Image — falls back to native initials circle.
function FamousPersonCard({
  person,
  index,
  ready,
}: {
  person: FamousPersonItem;
  index: number;
  ready: boolean;
}) {
  const opacity = useSharedValue(0);
  const scale   = useSharedValue(0.85);
  const delayMs = ANIM_FAMOUS_BASE + index * ANIM_FAMOUS_STEP;

  useEffect(() => {
    if (!ready) return;
    const ease = Easing.out(Easing.ease);
    opacity.value = withDelay(delayMs, withTiming(1, { duration: 700, easing: ease }));
    scale.value   = withDelay(delayMs, withTiming(1, { duration: 700, easing: ease }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const animStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const isHttpsImage =
    typeof person.image === 'string' && person.image.startsWith('https://');
  const initials = getInitials(person.name);
  const bgColor  = nameToColor(person.name);

  return (
    <Animated.View style={animStyle} className="items-center gap-2">
      {/* border-c-md = border-2 border-white/10 */}
      <View
        className="h-14 w-14 rounded-full overflow-hidden"
        style={{ borderWidth: 2, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: '#1e293b' }}
      >
        {isHttpsImage ? (
          <Image
            source={{ uri: person.image! }}
            className="h-full w-full"
            resizeMode="cover"
          />
        ) : (
          <View
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: bgColor }}
          >
            <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '600' }}>
              {initials}
            </Text>
          </View>
        )}
      </View>
      {/* max-w-[80px] matches web */}
      <Text
        className="text-xs font-medium text-slate-400 text-center leading-tight"
        style={{ maxWidth: 80 }}
      >
        {person.name}
      </Text>
    </Animated.View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PersonalityAnalysis({
  mbtiResult,
  childName,
  ready = true,
}: PersonalityAnalysisProps) {
  const { scores, profile } = mbtiResult;

  const categoryKey  = profile?.category ?? 'creatives';
  const category     = personalityCategories[categoryKey] ?? personalityCategories['creatives']!;
  const categoryGrad = CATEGORY_GRADIENT[categoryKey] ?? CATEGORY_GRADIENT['creatives']!;

  // Top 3 personality types by score
  const topTypes = Object.entries(scores)
    .filter(([typeName]) => personalityTypes[typeName])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([typeName, score]) => ({ name: typeName, score }));

  const growthAreasList = Array.isArray(profile?.growth_areas) ? profile.growth_areas : [];
  const traitsList      = Array.isArray(profile?.traits)       ? profile.traits       : [];
  const strengthsList   = Array.isArray(profile?.strengths)    ? profile.strengths    : [];
  const famousList: FamousPersonItem[] = Array.isArray(profile?.famous_people)
    ? (profile.famous_people as FamousPersonItem[])
    : [];

  const famousHeading = profile?.name
    ? (FAMOUS_LABEL[profile.name] ?? `${profile.name}s`)
    : 'Role Models';

  return (
    <View className="gap-5">

      {/* ── Section 1 — Category Badge ─────────────────────────────────────── */}
      {/* Web: bg-gradient-to-r ${category.color} rounded-2xl p-4 text-center  */}
      <SlideSection delayMs={100} ready={ready}>
        <GradientBadge gradient={categoryGrad}>
          <Text className="text-sm font-medium text-white" style={{ opacity: 0.9 }}>
            {category.name}
          </Text>
          <Text className="mt-1 text-xs text-white text-center" style={{ opacity: 0.75 }}>
            {category.description}
          </Text>
        </GradientBadge>
      </SlideSection>

      {/* ── Section 2 — Main Type Card ─────────────────────────────────────── */}
      {/* Web: border-edge rounded-2xl bg-card p-6                              */}
      <SlideSection delayMs={800} ready={ready}>
        <View
          className="rounded-2xl bg-card p-6"
          style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <View className="items-center mb-4">
            <View className="flex-row items-center gap-2 mb-2">
              {/* Web: <Sparkles className="h-6 w-6 text-teal-400" /> */}
              <Sparkles size={24} color="#2dd4bf" />
              <Text className="text-2xl font-bold text-white">{profile?.name}</Text>
            </View>
            {/* Web: text-sm text-slate-500 */}
            <Text className="text-sm text-slate-500">{childName}'s personality type</Text>
          </View>

          {/* Traits chips — bg-ghost-light border-edge-faint = bg-white/6 border-white/6 */}
          <View className="flex-row flex-wrap justify-center gap-2 mb-4">
            {traitsList.map((trait, i) => (
              <FadeItem key={trait} delayMs={1000 + i * 200} ready={ready}>
                <View
                  className="rounded-full px-3 py-1"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    borderWidth:      1,
                    borderColor:      'rgba(255,255,255,0.06)',
                  }}
                >
                  <Text className="text-xs text-slate-300">{trait}</Text>
                </View>
              </FadeItem>
            ))}
          </View>

          <Text className="text-sm leading-relaxed text-slate-400 text-center">
            {profile?.description}
          </Text>
        </View>
      </SlideSection>

      {/* ── Section 3 — Personality Profile Breakdown ─────────────────────── */}
      {/* Web: border-edge rounded-2xl bg-card p-6                              */}
      <SlideSection delayMs={1600} ready={ready}>
        <View
          className="rounded-2xl bg-card p-6"
          style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <Text className="text-sm font-semibold text-white mb-4">
            Personality Profile Breakdown
          </Text>
          <View className="gap-4">
            {topTypes.map((item, index) => {
              const maxScore   = topTypes[0]?.score ?? 0;
              const percentage = maxScore > 0 ? (item.score / maxScore) * 100 : 0;
              const itemProfile = personalityTypes[item.name];
              if (!itemProfile) return null;
              const grad = TYPE_GRADIENT[item.name] ?? { from: '#14b8a6', to: '#0ea5e9' };
              return (
                <AnimatedBarRow
                  key={item.name}
                  name={itemProfile.name}
                  percentage={percentage}
                  gradient={grad}
                  delayMs={ANIM_BAR_ROW_BASE + index * ANIM_BAR_W_STEP}
                  ready={ready}
                />
              );
            })}
          </View>
        </View>
      </SlideSection>

      {/* ── Section 4 — Famous People ──────────────────────────────────────── */}
      {/* Web: border-edge rounded-2xl bg-surface-elevated p-6                  */}
      <SlideSection delayMs={2400} ready={ready}>
        <View
          className="rounded-2xl bg-surface-elevated p-6"
          style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <Text className="text-sm font-semibold text-white mb-1">
            Famous {famousHeading}
          </Text>
          <Text className="text-xs text-slate-500 mb-5">
            People {childName} may relate to
          </Text>
          {/* Web: flex flex-wrap justify-center gap-6 */}
          <View className="flex-row justify-center flex-wrap gap-6">
            {famousList.map((person, i) => (
              <FamousPersonCard
                key={person.name}
                person={person}
                index={i}
                ready={ready}
              />
            ))}
          </View>
        </View>
      </SlideSection>

      {/* ── Section 5 — Strengths ──────────────────────────────────────────── */}
      {/* Web: rounded-2xl border border-emerald-500/15 bg-card p-5             */}
      <SlideSection delayMs={3200} ready={ready}>
        <View
          className="rounded-2xl bg-card p-5"
          style={{ borderWidth: 1, borderColor: 'rgba(16,185,129,0.15)' }}
        >
          <Text className="text-sm font-semibold text-emerald-400 mb-3">💪 Strengths</Text>
          <View className="gap-2">
            {strengthsList.map((s, i) => (
              <FadeItem key={s} delayMs={3500 + i * 150} ready={ready}>
                <View className="flex-row items-center gap-2.5">
                  <View className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <Text className="text-sm text-slate-400 flex-1">{s}</Text>
                </View>
              </FadeItem>
            ))}
          </View>
        </View>
      </SlideSection>

      {/* ── Section 6 — Growth Areas ───────────────────────────────────────── */}
      {/* Web: rounded-2xl border border-amber-500/15 bg-card p-5               */}
      {growthAreasList.length > 0 && (
        <SlideSection delayMs={4000} ready={ready}>
          <View
            className="rounded-2xl bg-card p-5"
            style={{ borderWidth: 1, borderColor: 'rgba(245,158,11,0.15)' }}
          >
            <View className="flex-row items-center gap-2 mb-3">
              {/* Web: <Sprout className="h-4 w-4 shrink-0" /> */}
              <Sprout size={16} color="#fbbf24" />
              <Text className="text-sm font-semibold text-amber-400">Growth Areas</Text>
            </View>
            <View className="gap-2">
              {growthAreasList.map((item, i) => (
                <FadeItem key={`${String(item)}-${i}`} delayMs={4300 + i * 150} ready={ready}>
                  <View className="flex-row items-start gap-2.5">
                    <View className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                    <Text className="text-sm text-slate-400 flex-1">{String(item)}</Text>
                  </View>
                </FadeItem>
              ))}
            </View>
          </View>
        </SlideSection>
      )}

    </View>
  );
}
