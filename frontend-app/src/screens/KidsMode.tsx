import React, { useEffect } from 'react';
import Animated, {
  Easing,
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { Pressable } from '@/components/ui/pressable';
import { Navigate, navigationRef, useNavigate, useParams } from '@/lib/router';
import PageLoader from '@/components/shared/PageLoader';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import PageScroll from '@/components/layout/PageScroll';
import { useChildren } from '@/hooks/useChildren';
import { useKidActivity } from '@/hooks/useKidActivity';
import { useKidPowers } from '@/hooks/useKidPowers';
import { useKidQuests } from '@/hooks/useKidQuests';
import { useKidWorlds } from '@/hooks/useKidWorlds';
import { useTts } from '@/lib/TtsContext';
import { speakText, stopSpeech } from '@/lib/tts';
import { childViewHome, isKidsArea, type KidsArea } from '@/lib/childView';
import { AREA_NAMES, AREA_SPLASH, READ_ALOUD, areaOpen } from '@/lib/kidsAreas';
import KidsHeader from '@/components/kids/KidsHeader';
import ReleaseCheckIn from '@/components/kids/ReleaseCheckIn';
import DiscoverPowers from '@/components/kids/DiscoverPowers';
import TransformQuests from '@/components/kids/TransformQuests';
import GrowWorlds from '@/components/kids/GrowWorlds';
import ConnectWins from '@/components/kids/ConnectWins';
import { winsFrom } from '@/lib/kidsWins';
import { PAGE, button, card, color, text } from '@/components/kids/palette';
import { enter } from '@/components/kids/enter';

const HIDDEN = { opacity: 0 } as const;

/**
 * The kids page (web pages/KidsMode.tsx; docs/child-view-build-plan.md, Phase 2). The circle
 * is the route's `sub` (/Kids/:childId/:area).
 */
export default function KidsMode() {
  const navigate = useNavigate();
  const { childId, sub } = useParams<{ childId?: string; sub?: string }>();
  const area: KidsArea | null = isKidsArea(sub) ? sub : null;
  const children = useChildren();
  const child = children.list.find(c => c.id === childId);
  const kid = useKidActivity(childId);
  const powers = useKidPowers(area === 'discover' ? childId : undefined);
  // Grow's worlds and Transform's quests, for their tabs and for Connect's wins.
  const open = (a: KidsArea) =>
    Boolean(child && areaOpen(a, child.progress, kid.activity?.circles_done));
  const growWorlds = useKidWorlds(
    (area === 'grow' || area === 'connect') && open('grow')
      ? childId
      : undefined,
  );
  const quests = useKidQuests(
    (area === 'transform' || area === 'connect') && open('transform')
      ? childId
      : undefined,
  );
  const { ttsEnabled, toggleTts } = useTts();

  // The circle's avatar video on entry (Grow, Transform), as its parent page plays it; not
  // when coming back. The ambient track and the read-aloud wait for it.
  const splashStage = area ? AREA_SPLASH[area] : undefined;
  const [splashOn, startSplashTimer] = useStageSplash(0);
  const playSplash =
    splashStage !== undefined && splashOn && area !== null && open(area);
  // Hidden at once while the video plays, then faded in, as the parent pages do.
  // Fades in on every entry, as the parent pages do; hidden while a video plays.
  const pageOpacity = useSharedValue(0);
  useEffect(() => {
    pageOpacity.value = playSplash
      ? 0
      : withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [playSplash, pageOpacity]);
  const pageStyle = useAnimatedStyle(() => ({ opacity: pageOpacity.value }));
  const reduced = useReducedMotion();
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();
  useEffect(() => {
    setAmbientSuppressed(playSplash);
    return () => setAmbientSuppressed(false);
  }, [playSplash, setAmbientSuppressed]);

  useEffect(() => {
    if (ttsEnabled && area && !playSplash) speakText(READ_ALOUD[area]);
    return () => stopSpeech();
  }, [ttsEnabled, area, playSplash]);

  if (!childId) return <Navigate to="/Home" replace />;
  if (!area) return <Navigate to={childViewHome(childId)} replace />;
  if (children.isLoading || kid.isLoading) return <PageLoader />;
  if (!child) return <Navigate to={childViewHome(childId)} replace />;

  const isOpen = (a: KidsArea) =>
    areaOpen(a, child.progress, kid.activity?.circles_done);
  // Home: back to the circles (the hub below), or the hub itself when opened directly. As in
  // the prototype there are no tabs: the hub is the way between circles.
  const home = () =>
    navigationRef.canGoBack()
      ? navigate(-1)
      : navigate(childViewHome(childId), { replace: true });

  return (
    <View className="flex-1" style={PAGE}>
      <Animated.View
        className="flex-1"
        // Hidden in the same frame the video starts (not after an effect), faded in after.
        style={playSplash ? HIDDEN : pageStyle}
      >
        {/* As on the web: no Layout Back row (KidsHeader has Home), and the kids
            background and glow (PAGE, below) show through. */}
        <PageScroll
          hideBackRow
          className="bg-transparent"
          // The kids bar is sticky under the app header, as on the web.
          stickyHeaderIndices={[0]}
        >
          <KidsHeader
            area={area}
            areaName={AREA_NAMES[area]}
            readAloud={ttsEnabled}
            onHome={home}
            onToggleReadAloud={toggleTts}
          />
          <Animated.View
            key={area}
            className="px-4 pb-14 pt-6"
            style={enter('up', 0, reduced)}
          >
            {!isOpen(area) ? (
              <View className="items-center" style={card(area)}>
                <Lock size={32} color={color(area)} />
                <Text
                  accessibilityRole="header"
                  className="mt-2.5 text-center text-xl"
                  style={text.heading}
                >
                  {AREA_NAMES[area]} opens later
                </Text>
                <Text
                  className="mt-2.5 text-center text-[15px]"
                  style={text.body}
                >
                  Keep going!
                </Text>
              </View>
            ) : kid.isLoadingError || !kid.activity ? (
              <View className="items-center" style={card(area)}>
                <Text className="text-center text-[15px]" style={text.body}>
                  We couldn&apos;t load this.
                </Text>
                <Pressable
                  onPress={() => void kid.refetch()}
                  disabled={kid.isFetching}
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                  className="mt-4 h-11 items-center justify-center px-6"
                  style={({ pressed }) => button(area, pressed)}
                >
                  <Text
                    className="text-sm"
                    style={[text.heading, { color: color('ink') }]}
                  >
                    {kid.isFetching ? 'Trying…' : 'Try again'}
                  </Text>
                </Pressable>
              </View>
            ) : area === 'discover' ? (
              powers.isLoading ? (
                <PageLoader />
              ) : powers.powers ? (
                <DiscoverPowers
                  childName={child.name}
                  avatarUrl={child.avatar_url}
                  powers={powers.powers}
                  activity={kid.activity}
                  send={kid.send}
                />
              ) : (
                <View className="items-center" style={card(area)}>
                  <Text className="text-center text-[15px]" style={text.body}>
                    {powers.notReady
                      ? 'Your powers are still on their way.'
                      : 'We couldn’t load your powers.'}
                  </Text>
                  <Pressable
                    onPress={() => void powers.refetch()}
                    disabled={powers.isFetching}
                    accessibilityRole="button"
                    accessibilityLabel="Look again"
                    className="mt-4 h-11 items-center justify-center px-6"
                    style={({ pressed }) => button(area, pressed)}
                  >
                    <Text
                      className="text-sm"
                      style={[text.heading, { color: color('ink') }]}
                    >
                      {powers.isFetching ? 'Looking…' : 'Look again'}
                    </Text>
                  </Pressable>
                </View>
              )
            ) : area === 'grow' ? (
              growWorlds.isLoading ? (
                <PageLoader />
              ) : growWorlds.worlds ? (
                <GrowWorlds
                  worlds={growWorlds.worlds}
                  saving={growWorlds.saving}
                  addRun={growWorlds.addRun}
                  awaitProgress={kid.awaitProgress}
                />
              ) : (
                <View className="items-center" style={card(area)}>
                  <Text className="text-center text-[15px]" style={text.body}>
                    We couldn’t load the worlds.
                  </Text>
                  <Pressable
                    onPress={() => void growWorlds.refetch()}
                    disabled={growWorlds.isFetching}
                    accessibilityRole="button"
                    accessibilityLabel="Try again"
                    className="mt-4 h-11 items-center justify-center px-6"
                    style={({ pressed }) => button(area, pressed)}
                  >
                    <Text
                      className="text-sm"
                      style={[text.heading, { color: color('ink') }]}
                    >
                      {growWorlds.isFetching ? 'Trying…' : 'Try again'}
                    </Text>
                  </Pressable>
                </View>
              )
            ) : area === 'transform' ? (
              quests.isLoading ? (
                <PageLoader />
              ) : quests.quests ? (
                <TransformQuests
                  quests={quests.quests}
                  sending={quests.sending || kid.sending}
                  pick={quests.pick}
                  log={quests.log}
                  awaitProgress={kid.awaitProgress}
                />
              ) : (
                <View className="items-center" style={card(area)}>
                  <Text className="text-center text-[15px]" style={text.body}>
                    We couldn’t load your quests.
                  </Text>
                  <Pressable
                    onPress={() => void quests.refetch()}
                    disabled={quests.isFetching}
                    accessibilityRole="button"
                    accessibilityLabel="Try again"
                    className="mt-4 h-11 items-center justify-center px-6"
                    style={({ pressed }) => button(area, pressed)}
                  >
                    <Text
                      className="text-sm"
                      style={[text.heading, { color: color('ink') }]}
                    >
                      {quests.isFetching ? 'Trying…' : 'Try again'}
                    </Text>
                  </Pressable>
                </View>
              )
            ) : area === 'release' ? (
              <ReleaseCheckIn
                key={kid.day}
                activity={kid.activity}
                day={kid.day}
                sending={kid.sending}
                send={kid.send}
              />
            ) : growWorlds.isLoading || quests.isLoading ? (
              <PageLoader />
            ) : (
              <ConnectWins
                wins={winsFrom({
                  activity: kid.activity,
                  quests: quests.quests,
                  worlds: growWorlds.worlds,
                  day: kid.day,
                })}
                childName={child.name}
                avatarUrl={child.avatar_url}
                activity={kid.activity}
                sending={kid.sending}
                send={kid.send}
              />
            )}
          </Animated.View>
        </PageScroll>
      </Animated.View>
      {playSplash ? (
        <StageSplash stage={splashStage} onReady={startSplashTimer} />
      ) : null}
    </View>
  );
}
