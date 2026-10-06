import React, { useEffect, useState } from 'react';
import { Image, Text, View, useWindowDimensions } from 'react-native';
import { Portal } from '@/components/ui/portal';
import Animated, {
  Easing,
  Keyframe,
  cubicBezier,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { cn } from '@/lib/utils';
import { env } from '@/lib/env';
import { gradient, raw, recipe } from '@/theme';
import type { PhaseSplash } from './flow';

const easeOut = Easing.out(Easing.ease);

/**
 * Web `fixed inset-0 z-50` overlay wrapped in <AnimatePresence>: an RN Modal
 * (so it covers the stack header like the web's fixed layer) that fades in
 * over `enterMs` (0 = appears at full opacity, like `initial={{ opacity: 1 }}`)
 * and stays mounted for `exitMs` while fading out after `visible` goes false.
 */
function FadeModal({
  visible,
  enterMs,
  exitMs,
  children,
}: {
  visible: boolean;
  enterMs: number;
  exitMs: number;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);
  const opacity = useSharedValue(visible && enterMs > 0 ? 0 : 1);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.value = withTiming(1, { duration: enterMs });
      return undefined;
    }
    opacity.value = withTiming(0, { duration: exitMs });
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [visible, enterMs, exitMs, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!mounted) return null;
  return (
    <Portal>
      <Animated.View className="flex-1" style={style}>
        {children}
      </Animated.View>
    </Portal>
  );
}

// ── Ivy intro splash ─────────────────────────────────────────────────────────

const IVY_INTRO_URI = `${env.CDN_BASE_URL}/app-assets/avatars/ivy-intro.jpg`;

// web: initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}, delay 0.3, 0.6s.
const GREETING_ENTERING = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 10 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: easeOut },
})
  .duration(600)
  .delay(300);

function IvyIntroScreen() {
  const { width, height } = useWindowDimensions();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // object-cover + object-top: scale to cover, centre horizontally, pin to the top edge.
  const imageFrame = (() => {
    if (!natural || natural.w <= 0 || natural.h <= 0)
      return { width, height, left: 0, top: 0 };
    const scale = Math.max(width / natural.w, height / natural.h);
    const w = natural.w * scale;
    const h = natural.h * scale;
    return { width: w, height: h, left: (width - w) / 2, top: 0 };
  })();

  return (
    <View
      className="flex-1 overflow-hidden"
      style={{ backgroundColor: raw['bg-deep-3'] }}
    >
      <Image
        source={{ uri: IVY_INTRO_URI }}
        accessibilityLabel="Ivy"
        resizeMode="cover"
        onLoad={e => {
          const { width: w, height: h } = e.nativeEvent.source;
          setNatural({ w, h });
        }}
        style={{ position: 'absolute', ...imageFrame }}
      />
      {/* Dark gradient veil */}
      <View
        className="absolute inset-0"
        style={{ experimental_backgroundImage: gradient.onboardingIntroVeil }}
      />
      {/* Greeting text */}
      <Animated.Text
        entering={GREETING_ENTERING}
        className="absolute bottom-16 left-0 right-0 px-8 text-center text-xl font-bold text-white"
        style={[recipe.onboardingIntroTextShadow, { lineHeight: 20 * 1.375 }]}
      >
        Hi, I am Ivy. Let&apos;s transform your child to their superpower
        personality.
      </Animated.Text>
    </View>
  );
}

export function IvyIntroOverlay({ visible }: { visible: boolean }) {
  return (
    <FadeModal visible={visible} enterMs={0} exitMs={500}>
      <IvyIntroScreen />
    </FadeModal>
  );
}

// ── Phase splash full-screen interstitial ─────────────────────────────────────

// web: spring (stiffness 70, damping 12) from scale .5 / opacity 0, delay .15.
const ICON_ENTERING = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.5 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: easeOut },
})
  .duration(700)
  .delay(150);

const TITLE_ENTERING = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 14 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: easeOut },
})
  .duration(500)
  .delay(300);

const HINT_ENTERING = new Keyframe({ 0: { opacity: 0 }, 100: { opacity: 1 } })
  .duration(300)
  .delay(600);

// Tailwind animate-pulse: opacity 1 → .5 → 1 over 2s, cubic-bezier(.4,0,.6,1).
const PULSE = {
  '0%': { opacity: 1 },
  '50%': { opacity: 0.5 },
  '100%': { opacity: 1 },
};

function PhaseSplashScreen({ splash }: { splash: PhaseSplash }) {
  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center gap-8 px-8">
        <Animated.View
          entering={ICON_ENTERING}
          className={cn(
            'h-24 w-24 items-center justify-center rounded-full border-4',
            splash.iconColor,
          )}
        >
          <Text className="text-5xl">{splash.icon}</Text>
        </Animated.View>

        <Animated.View entering={TITLE_ENTERING} className="max-w-xs gap-3">
          <Text
            accessibilityRole="header"
            className="text-center text-2xl font-bold text-foreground"
          >
            {splash.title}
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            {splash.subtitle}
          </Text>
        </Animated.View>

        <Animated.View entering={HINT_ENTERING}>
          <Animated.Text
            className="text-[11px] font-bold uppercase text-primary"
            style={{
              letterSpacing: 11 * 0.2,
              animationName: PULSE,
              animationDuration: '2s',
              animationIterationCount: 'infinite',
              animationTimingFunction: cubicBezier(0.4, 0, 0.6, 1),
            }}
          >
            One moment…
          </Animated.Text>
        </Animated.View>
      </View>
    </View>
  );
}

export function PhaseSplashOverlay({ splash }: { splash: PhaseSplash | null }) {
  // Keep the last splash rendered while the overlay fades out.
  const [shown, setShown] = useState<PhaseSplash | null>(splash);
  useEffect(() => {
    if (splash) setShown(splash);
  }, [splash]);
  return (
    <FadeModal visible={!!splash} enterMs={300} exitMs={300}>
      {shown ? <PhaseSplashScreen splash={shown} /> : null}
    </FadeModal>
  );
}
