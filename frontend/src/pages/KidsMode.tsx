import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { Lock } from 'lucide-react';
import PageLoader from '@/components/shared/PageLoader';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
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
import { areaVars } from '@/components/kids/palette';

/**
 * The kids page (docs/child-view-build-plan.md, Phase 2): child view's version of each
 * circle, at `/Kids/:childId/:area`. The stars come from the server (useKidActivity); the
 * read-aloud uses the voice preference the header's voice button sets.
 */
export default function KidsMode() {
  const navigate = useNavigate();
  const location = useLocation();
  const { childId, area: areaParam } = useParams<{ childId: string; area: string }>();
  const area: KidsArea | null = isKidsArea(areaParam) ? areaParam : null;
  const children = useChildren();
  const child = children.list.find((c) => c.id === childId);
  const kid = useKidActivity(childId);
  const powers = useKidPowers(area === 'discover' ? childId : undefined);
  // Grow's worlds and Transform's quests, for their tabs and for Connect's wins.
  const open = (a: KidsArea) =>
    Boolean(child && areaOpen(a, child.progress, kid.activity?.circles_done));
  const growWorlds = useKidWorlds(
    (area === 'grow' || area === 'connect') && open('grow') ? childId : undefined,
  );
  const quests = useKidQuests(
    (area === 'transform' || area === 'connect') && open('transform') ? childId : undefined,
  );
  const { ttsEnabled, toggleTts } = useTts();

  // The circle's avatar video on entry (Grow, Transform), as its parent page plays it; not
  // when coming back. The ambient track and the read-aloud wait for it.
  const splashStage = area ? AREA_SPLASH[area] : undefined;
  const [splashOn, startSplashTimer] = useStageSplash(0);
  const playSplash = splashStage !== undefined && splashOn && area !== null && open(area);
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

  const isOpen = (a: KidsArea) => areaOpen(a, child.progress, kid.activity?.circles_done);
  // Home: back to the circles (the hub it was opened from, or the hub itself when the page
  // was opened directly). As in the prototype there are no tabs: the hub is the way between.
  const home = () =>
    void (location.key !== 'default'
      ? navigate(-1)
      : navigate(childViewHome(childId), { replace: true }));

  return (
    <>
      {/* Hidden while the circle's video plays, then faded in, as the parent pages do. */}
      <motion.div
        className="kids-page"
        style={areaVars(area)}
        // Fades in on every entry, as the parent pages do; hidden while a video plays.
        initial={{ opacity: 0 }}
        animate={{ opacity: playSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        <KidsHeader
          areaName={AREA_NAMES[area]}
          readAloud={ttsEnabled}
          onHome={home}
          onToggleReadAloud={toggleTts}
        />
        <main key={area} className="kids-enter-up px-4 pb-16 pt-8 sm:px-7">
          {!isOpen(area) ? (
            <div className="kids-card mx-auto max-w-xl text-center">
              <Lock className="mx-auto h-10 w-10 text-kids-area" aria-hidden="true" />
              <h1 className="mt-3 font-orbitron text-3xl font-black text-kids-text">
                {AREA_NAMES[area]} opens later
              </h1>
              <p className="mt-3 text-xl font-semibold text-kids-body">Keep going!</p>
            </div>
          ) : kid.isLoadingError || !kid.activity ? (
            <div className="kids-card mx-auto max-w-xl text-center">
              <p className="text-xl font-semibold text-kids-body">We couldn&apos;t load this.</p>
              <button
                type="button"
                onClick={() => void kid.refetch()}
                disabled={kid.isFetching}
                className="kids-btn mt-5 h-14 px-8 text-lg"
              >
                {kid.isFetching ? 'Trying…' : 'Try again'}
              </button>
            </div>
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
              <div className="kids-card mx-auto max-w-xl text-center">
                <p className="text-xl font-semibold text-kids-body">
                  {powers.notReady
                    ? 'Your powers are still on their way.'
                    : "We couldn't load your powers."}
                </p>
                <button
                  type="button"
                  onClick={() => void powers.refetch()}
                  disabled={powers.isFetching}
                  className="kids-btn mt-5 h-14 px-8 text-lg"
                >
                  {powers.isFetching ? 'Looking…' : 'Look again'}
                </button>
              </div>
            )
          ) : area === 'grow' ? (
            growWorlds.isLoading ? (
              <PageLoader />
            ) : growWorlds.worlds ? (
              <GrowWorlds
                worlds={growWorlds.worlds}
                saving={growWorlds.saving}
                addRun={growWorlds.addRun}
                send={kid.send}
              />
            ) : (
              <div className="kids-card mx-auto max-w-xl text-center">
                <p className="text-xl font-semibold text-kids-body">
                  We couldn&apos;t load the worlds.
                </p>
                <button
                  type="button"
                  onClick={() => void growWorlds.refetch()}
                  disabled={growWorlds.isFetching}
                  className="kids-btn mt-5 h-14 px-8 text-lg"
                >
                  {growWorlds.isFetching ? 'Trying…' : 'Try again'}
                </button>
              </div>
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
                send={kid.send}
              />
            ) : (
              <div className="kids-card mx-auto max-w-xl text-center">
                <p className="text-xl font-semibold text-kids-body">
                  We couldn&apos;t load your quests.
                </p>
                <button
                  type="button"
                  onClick={() => void quests.refetch()}
                  disabled={quests.isFetching}
                  className="kids-btn mt-5 h-14 px-8 text-lg"
                >
                  {quests.isFetching ? 'Trying…' : 'Try again'}
                </button>
              </div>
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
        </main>
      </motion.div>
      <AnimatePresence>
        {playSplash && <StageSplash stage={splashStage} onReady={startSplashTimer} />}
      </AnimatePresence>
    </>
  );
}
