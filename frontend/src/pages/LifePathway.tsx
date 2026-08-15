import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Sparkles, X } from 'lucide-react';

import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useAuth } from '@/lib/AuthContext';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { api } from '@/api/client';
import { useLifePathwayData } from '@/hooks/useLifePathwayData';
import { useLifePathwayArea } from '@/hooks/useLifePathwayArea';
import { SPINNER, MODAL_BACKDROP, MODAL_SCALE } from '@/lib/animations';
import {
  GROWTH_AREAS,
  copyTokensFor,
  fillTemplate,
  normalizeRecommendations,
} from '@/lib/growthAreaData';
import type { GrowthArea } from '@/lib/growthAreaData';
import {
  AGE_OFFSETS,
  AREA_HEX,
  ARCHETYPE_SUPERPOWER,
  CORE_MILESTONES,
  COPY,
  DEFAULT_SUPERPOWER,
  FALLBACK_MILESTONES,
  FALLBACK_MONTH_MOVES,
  MONTHS,
  NEUTRAL_HUE,
  NEUTRAL_YS,
  NODE_LEFT_PCT,
  TIMELINE,
  curve,
  deriveAreaYs,
  gapPath,
  mergeMilestones,
} from '@/lib/lifePathwayData';
import type { Milestone } from '@/lib/lifePathwayData';
import type { CompletedArea } from '@/types/api';

/**
 * Ensures a fragment can be followed by another sentence. The superpower card
 * joins the profile description to a second, static sentence, and
 * personalizedDescriptionOneLiner only trims to the first sentence *if* it finds
 * a terminator — text without one would otherwise run into the next sentence.
 * Guarded here rather than in that shared helper, which also feeds the
 * personality profile.
 */
function asSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

const GOLD = '#f0c98a';
const CYAN = '#4be9ff';
const INK = '#04060d';

export default function LifePathway() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { childData, profile, isLoading, completedAreas, savedConcern, setSavedConcern } =
    useLifePathwayData(childId);
  const [showSplash, startTimer] = useStageSplash(0);
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();

  // The journey's shared ambient bed (see AmbientAudioContext) plays through
  // this page automatically — just keep it silent while the splash video's
  // own unmuted audio plays, so the two don't overlap.
  useEffect(() => {
    setAmbientSuppressed(showSplash);
    return () => setAmbientSuppressed(false);
  }, [showSplash, setAmbientSuppressed]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [milestoneIdx, setMilestoneIdx] = useState(0);
  const [monthIdx, setMonthIdx] = useState(0);

  const [showConcernModal, setShowConcernModal] = useState(false);
  const [concernInput, setConcernInput] = useState('');
  const [concernSubmitted, setConcernSubmitted] = useState(false);

  // ── Derived child facts ────────────────────────────────────────────────────

  const childName = typeof childData?.name === 'string' ? childData.name : '';
  const gender = typeof childData?.gender === 'string' ? childData.gender : null;
  const currentAge = useMemo(
    () => Number.parseInt(String(childData?.age ?? ''), 10) || 10,
    [childData],
  );
  const ages = useMemo(() => AGE_OFFSETS.map((o) => currentAge + o), [currentAge]);
  // Last node's age. Derived rather than re-stated as `currentAge + 10` so the
  // span stays defined solely by AGE_OFFSETS.
  const journeyEndAge = ages[ages.length - 1] ?? currentAge;
  const archetype = profile?.personality_type ?? null;
  const strengths = useMemo(
    () => (profile?.top_strengths ?? []).map((s) => String(s)).filter(Boolean),
    [profile],
  );
  const traits = useMemo(() => {
    const raw = childData?.personality?.view_model?.profile?.traits;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v) => String(v))
      .filter(Boolean)
      .slice(0, 3);
  }, [childData]);

  /** Voice tokens for this child, for the few places that need one pronoun alone. */
  const voice = useMemo(() => copyTokensFor(gender), [gender]);

  /** Resolve {name}/{he}/{his}/{s} tokens in design copy. */
  const t = useCallback(
    (text: string) => fillTemplate(text, childName, gender),
    [childName, gender],
  );

  const superpower = useMemo(
    () =>
      archetype ? (ARCHETYPE_SUPERPOWER[archetype] ?? DEFAULT_SUPERPOWER) : DEFAULT_SUPERPOWER,
    [archetype],
  );

  // The generated personality description is more specific than the archetype's
  // stock lead, so it wins where present. Length-checked rather than ??-coalesced
  // because onboardingProfileFromViewModel returns '' when the view model carries
  // no description, and an empty string must fall through to the lead.
  const summaryText = profile?.summary?.trim() ?? '';
  const superpowerLead = summaryText.length > 0 ? asSentence(summaryText) : t(superpower.lead);

  // ── Growth areas offered in the dropdown (completed only) ──────────────────

  const areaOptions = useMemo(() => {
    const byId = new Map(completedAreas.map((a) => [a.area_id, a]));
    return GROWTH_AREAS.filter((g) => byId.has(g.id)).map((g) => ({
      area: g,
      completed: byId.get(g.id) as CompletedArea,
    }));
  }, [completedAreas]);

  const selected = areaOptions[Math.min(selectedIdx, Math.max(0, areaOptions.length - 1))] ?? null;
  const selectedArea: GrowthArea | null = selected?.area ?? null;

  // ── Milestone content: generated where available, templated otherwise ──────

  const {
    generated,
    status: areaStatus,
    progressMessage,
  } = useLifePathwayArea({
    childId,
    child: childData,
    area: selectedArea,
    completedArea: selected?.completed ?? null,
    archetype,
    personalityNarrative: profile?.summary ?? null,
    strengths,
    ages,
    enabled: !isLoading && !showSplash,
  });

  const isAreaLoading = areaStatus === 'loading';

  const milestones: Milestone[] = useMemo(() => {
    const fallback = selectedArea
      ? (FALLBACK_MILESTONES[selectedArea.id] ?? CORE_MILESTONES)
      : CORE_MILESTONES;
    // Ages come from the child's real age, never from the model — the chart's
    // node labels and the card heading must agree. Templating runs over the
    // merged set: fallback copy carries {he}/{his} tokens, generated copy has
    // none, and fillTemplate leaves token-free text untouched.
    return mergeMilestones(generated, fallback, ages).map((m) => ({
      ...m,
      title: t(m.title),
      guided: t(m.guided),
      power: t(m.power),
      drift: t(m.drift),
    }));
  }, [generated, selectedArea, ages, t]);

  const activeMilestone = milestones[Math.min(milestoneIdx, milestones.length - 1)];

  // ── Chart geometry ────────────────────────────────────────────────────────

  const ys = useMemo(() => (selected ? deriveAreaYs(selected.completed) : NEUTRAL_YS), [selected]);
  const hue = selectedArea?.hue ?? NEUTRAL_HUE;

  // ── 90-day moves, one row per completed area, from stored recommendations ──

  const monthMoves = useMemo(() => {
    const source = areaOptions.length
      ? areaOptions
      : GROWTH_AREAS.map((g) => ({ area: g, completed: null as CompletedArea | null }));
    return source
      .map(({ area, completed }) => {
        const recs = normalizeRecommendations(
          Array.isArray(completed?.ai_three_month_recommendations) &&
            completed.ai_three_month_recommendations.length > 0
            ? completed.ai_three_month_recommendations
            : (completed?.recommendations ?? []),
        );
        const rec = recs[monthIdx];
        const fallback = FALLBACK_MONTH_MOVES[area.id]?.[monthIdx];
        const text = rec
          ? rec.detail
            ? `${rec.title} — ${rec.detail}`
            : rec.title
          : fallback
            ? t(fallback)
            : '';
        return { area, text, color: AREA_HEX[area.id] ?? CYAN };
      })
      .filter((r) => r.text);
  }, [areaOptions, monthIdx, t]);

  // ── Concern modal ─────────────────────────────────────────────────────────

  const closeConcernModal = useCallback(() => {
    setShowConcernModal(false);
    setConcernSubmitted(false);
    setConcernInput('');
  }, []);

  useEffect(() => {
    if (!showConcernModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConcernModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showConcernModal, closeConcernModal]);

  // On bfcache restore (Back from GoalsDashboard), close any open modal.
  // Also calls closeConcernModal on component unmount via the cleanup.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) closeConcernModal();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      closeConcernModal();
    };
  }, [closeConcernModal]);

  const handleStartJourney = () => {
    if (savedConcern) {
      void navigate(`/GoalsDashboard/${childId}`);
      return;
    }
    setShowConcernModal(true);
  };

  const handleConcernSubmit = useCallback(async () => {
    const activeChildId = childData?.id;
    if (!concernInput.trim() || !activeChildId) return;
    try {
      await api.goals.patch(activeChildId, { parent_concern: concernInput.trim() });
      setSavedConcern(concernInput.trim());
    } catch (err) {
      console.warn('[LifePathway] Could not persist concern, proceeding anyway:', err);
    }
    setConcernSubmitted(true);
  }, [childData, concernInput, setSavedConcern]);

  const handleProceedToDashboard = () => {
    closeConcernModal();
    void navigate(`/GoalsDashboard/${childId}`);
  };

  // ── Shared style fragments ────────────────────────────────────────────────

  const eyebrow: React.CSSProperties = {
    fontWeight: 700,
    letterSpacing: '.28em',
    fontSize: 10.5,
    textTransform: 'uppercase',
    color: GOLD,
  };
  // size is optional: the three headings that size themselves with clamp() would
  // otherwise have to pass a throwaway 0 and rely on a later `fontSize` key
  // overriding it — which works only while the keys stay in that order.
  const orbitron = (size?: number, weight: 700 | 900 = 900): React.CSSProperties => ({
    fontFamily: 'Orbitron, sans-serif',
    fontWeight: weight,
    ...(size === undefined ? {} : { fontSize: size }),
  });
  const twoCol: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
    gap: 18,
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {isLoading ? (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <motion.div
              {...SPINNER}
              className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent"
            />
          </div>
        ) : (
          <div
            key={showSplash ? 'splash' : 'content'}
            style={{
              minHeight: '100vh',
              background:
                'radial-gradient(ellipse at 70% -10%,rgba(240,201,138,.13),rgba(4,6,13,0) 52%),radial-gradient(ellipse at 12% 30%,rgba(30,196,232,.14),rgba(4,6,13,0) 50%),radial-gradient(ellipse at 20% 95%,rgba(160,120,255,.10),rgba(4,6,13,0) 45%),#04060d',
              fontFamily: 'Rajdhani, sans-serif',
              color: '#e7f5f9',
            }}
          >
            <style>{`
              @keyframes lpFadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
              @keyframes lpFadeIn { from { opacity: 0; } to { opacity: 1; } }
              @keyframes lpDrawLine { from { stroke-dashoffset: 1600; } to { stroke-dashoffset: 0; } }
              @keyframes lpGapIn { from { opacity: 0; } to { opacity: 1; } }
              @keyframes lpPopNode { 0% { opacity: 0; transform: scale(.3); } 60% { transform: scale(1.25); } 100% { opacity: 1; transform: scale(1); } }
              @keyframes lpSwap { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
              @keyframes lpGlowText { 0%, 100% { text-shadow: 0 0 26px rgba(240,201,138,.35); } 50% { text-shadow: 0 0 44px rgba(240,201,138,.7); } }
              @keyframes lpSpin { to { transform: rotate(360deg); } }
              @keyframes lpShimmer { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
              .lp-select { appearance: none; -webkit-appearance: none; }
              .lp-select:hover, .lp-select:focus { border-color: rgba(75,233,255,.7) !important; }
              .lp-cta { transition: transform .2s ease, box-shadow .2s ease; }
              .lp-cta:hover { transform: translateY(-2px); box-shadow: 0 0 60px rgba(240,201,138,.55) !important; }
              @media (prefers-reduced-motion: reduce) {
                [style*="lpFadeUp"], [style*="lpPopNode"], [style*="lpDrawLine"],
                [style*="lpGapIn"], [style*="lpSwap"], [style*="lpFadeIn"] { animation: none !important; }
              }
            `}</style>

            {/*
              The design's own sticky header (SUPERPOWER · Life Pathway · Back) is
              deliberately not reproduced: the shared Layout already renders the
              brand mark and the section label ("Transform"), so repeating it here
              stacked two near-identical bars. Every other redesigned page
              (GrowthAreas, Connect, Observations) renders content-only for the
              same reason, and the Back button was dropped by request.
            */}
            <main
              style={{
                maxWidth: 1200,
                margin: '0 auto',
                padding: isMobile ? '36px 20px 72px' : '52px 40px 96px',
              }}
            >
              {/* ── Hero ─────────────────────────────────────────────────── */}
              <section style={{ textAlign: 'center', animation: 'lpFadeUp .7s ease both' }}>
                <div style={{ ...eyebrow, letterSpacing: '.36em' }}>
                  {[childName, `Age ${String(currentAge)}`, archetype ? `The ${archetype}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <p
                  style={{
                    margin: '18px auto 0',
                    maxWidth: 760,
                    fontSize: 15,
                    fontWeight: 700,
                    lineHeight: 1.5,
                    color: '#cfe9f2',
                  }}
                >
                  {COPY.intro}
                </p>
                <h1
                  style={{
                    margin: '16px auto 0',
                    maxWidth: 940,
                    ...orbitron(),
                    fontSize: 'clamp(26px,3.8vw,44px)',
                    lineHeight: 1.06,
                    letterSpacing: '-.01em',
                  }}
                >
                  {t(COPY.headlineA)}
                  <br />
                  <span style={{ color: GOLD, animation: 'lpGlowText 4s ease-in-out infinite' }}>
                    {t(COPY.headlineB)}
                  </span>
                </h1>
                <p
                  style={{
                    margin: '20px auto 0',
                    maxWidth: 640,
                    fontSize: 16,
                    fontWeight: 600,
                    lineHeight: 1.55,
                    color: '#a8c1d1',
                  }}
                >
                  A lifelong journey. We begin with the first ten years, age {currentAge} to{' '}
                  {journeyEndAge}.
                </p>
              </section>

              {/* ── Superpower + First 10 ────────────────────────────────── */}
              <section
                style={{
                  marginTop: isMobile ? 48 : 76,
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '1.15fr 1fr',
                  gap: 18,
                  animation: 'lpFadeUp .7s ease .1s both',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    borderRadius: 20,
                    padding: '24px 26px',
                    background: 'linear-gradient(150deg,rgba(52,40,18,.85),rgba(12,17,28,.9))',
                    border: '1px solid rgba(240,201,138,.4)',
                    overflow: 'hidden',
                    boxShadow: '0 0 60px rgba(240,201,138,.10) inset',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      right: -60,
                      top: -60,
                      width: 220,
                      height: 220,
                      borderRadius: '50%',
                      background:
                        'radial-gradient(circle,rgba(240,201,138,.22),rgba(240,201,138,0) 70%)',
                    }}
                  />
                  <div style={{ position: 'relative', ...eyebrow }}>{t(COPY.superpowerLabel)}</div>
                  <div
                    style={{
                      position: 'relative',
                      marginTop: 10,
                      ...orbitron(),
                      fontSize: 'clamp(22px,2.5vw,30px)',
                      lineHeight: 1.05,
                      color: '#fff6e2',
                    }}
                  >
                    {superpower.title}
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      marginTop: 10,
                      fontSize: 14.5,
                      fontWeight: 600,
                      lineHeight: 1.5,
                      color: '#e0cba8',
                      maxWidth: 460,
                    }}
                  >
                    {superpowerLead} {t(COPY.superpowerTail)}
                  </div>
                  {traits.length > 0 && (
                    <div
                      style={{
                        position: 'relative',
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                        marginTop: 18,
                      }}
                    >
                      {traits.map((trait) => (
                        <div
                          key={trait}
                          style={{
                            padding: '7px 14px',
                            borderRadius: 999,
                            border: '1px solid rgba(240,201,138,.45)',
                            fontWeight: 700,
                            fontSize: 12,
                            letterSpacing: '.12em',
                            textTransform: 'uppercase',
                            color: '#f5e6c4',
                          }}
                        >
                          {trait}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    borderRadius: 22,
                    padding: '26px 28px',
                    background: 'linear-gradient(150deg,rgba(20,31,50,.8),rgba(8,13,24,.8))',
                    border: '1px solid rgba(75,233,255,.22)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <div style={{ ...orbitron(32), lineHeight: 1, color: CYAN }}>
                    {COPY.firstTenTitle}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.45,
                      color: '#93aebe',
                    }}
                  >
                    years of a lifelong journey. Superpower stays with {voice.him} for life; age{' '}
                    {currentAge} to {journeyEndAge} is simply where we begin.
                  </div>
                </div>
              </section>

              {/* ── Chart ────────────────────────────────────────────────── */}
              <section
                style={{
                  marginTop: isMobile ? 40 : 56,
                  borderRadius: 24,
                  padding: isMobile ? '22px 18px 20px' : '28px 30px 24px',
                  background: 'linear-gradient(165deg,rgba(20,31,50,.7),rgba(8,13,24,.72))',
                  border: '1px solid rgba(75,233,255,.18)',
                  boxShadow: '0 30px 90px rgba(2,6,15,.7)',
                  animation: 'lpFadeUp .7s ease .2s both',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    gap: 20,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ ...orbitron(17), letterSpacing: '.02em', color: '#f2fdff' }}>
                      {COPY.chartTitle}
                    </div>
                    <div
                      style={{ marginTop: 6, fontSize: 13.5, fontWeight: 600, color: '#7f97a8' }}
                    >
                      {COPY.chartSub}
                    </div>

                    {areaOptions.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          marginTop: 16,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 10.5,
                            letterSpacing: '.2em',
                            textTransform: 'uppercase',
                            color: '#6f8a9c',
                          }}
                        >
                          {COPY.growthAreaLabel}
                        </div>
                        <div
                          style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
                        >
                          <select
                            className="lp-select"
                            aria-label={COPY.growthAreaLabel}
                            value={String(selectedIdx)}
                            onChange={(e) => {
                              setSelectedIdx(Number(e.target.value));
                              setMilestoneIdx(0);
                            }}
                            style={{
                              cursor: 'pointer',
                              padding: '10px 40px 10px 16px',
                              borderRadius: 999,
                              background: 'rgba(8,14,26,.9)',
                              border: '1px solid rgba(75,233,255,.34)',
                              fontFamily: 'Rajdhani, sans-serif',
                              fontWeight: 700,
                              fontSize: 14,
                              letterSpacing: '.04em',
                              color: '#eafdff',
                              outline: 'none',
                            }}
                          >
                            {areaOptions.map(({ area }, i) => (
                              <option
                                key={area.id}
                                value={String(i)}
                                style={{ background: '#08101c' }}
                              >
                                {area.name}
                              </option>
                            ))}
                          </select>
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={CYAN}
                            strokeWidth={2.4}
                            style={{
                              position: 'absolute',
                              right: 15,
                              width: 13,
                              height: 13,
                              pointerEvents: 'none',
                            }}
                          >
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 22,
                          height: 3,
                          borderRadius: 2,
                          background: `linear-gradient(90deg,${CYAN},${GOLD})`,
                        }}
                      />
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 11,
                          letterSpacing: '.14em',
                          textTransform: 'uppercase',
                          color: GOLD,
                        }}
                      >
                        {COPY.legendSuperpower}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 22, height: 2, background: '#3c505f' }} />
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 11,
                          letterSpacing: '.14em',
                          textTransform: 'uppercase',
                          color: '#6f8697',
                        }}
                      >
                        {COPY.legendRoutine}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Curve + nodes. Keyed on the area so the draw animation replays. */}
                <div
                  key={selectedArea?.id ?? 'core'}
                  style={{ position: 'relative', marginTop: 20, height: isMobile ? 240 : 330 }}
                >
                  <svg
                    viewBox="0 0 1000 320"
                    preserveAspectRatio="none"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  >
                    <defs>
                      <linearGradient id="lpLine" x1="0" y1="1" x2="1" y2="0">
                        <stop offset="0%" stopColor={`rgba(${hue},.7)`} />
                        <stop offset="45%" stopColor={`rgb(${hue})`} />
                        <stop offset="100%" stopColor="#ffd89a" />
                      </linearGradient>
                      <linearGradient id="lpGap" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={`rgba(${hue},0)`} />
                        <stop offset="45%" stopColor={`rgba(${hue},.13)`} />
                        <stop offset="100%" stopColor="rgba(240,201,138,.26)" />
                      </linearGradient>
                    </defs>
                    <path
                      d={gapPath(ys)}
                      fill="url(#lpGap)"
                      style={{ animation: 'lpGapIn 1.4s ease 1.6s both' }}
                    />
                    <path
                      d="M40 300 C160 300 260 302 380 304 C520 306 700 308 940 310"
                      fill="none"
                      stroke="#3c505f"
                      strokeWidth={2}
                      strokeDasharray="8 8"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={curve(ys)}
                      fill="none"
                      stroke="url(#lpLine)"
                      strokeWidth={3.4}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray={1600}
                      style={{
                        animation: 'lpDrawLine 2.6s cubic-bezier(.35,0,.25,1) .3s both',
                        filter: `drop-shadow(0 0 10px rgba(${hue},.45))`,
                      }}
                    />
                  </svg>

                  {NODE_LEFT_PCT.map((left, k) => {
                    const active = k === Math.min(milestoneIdx, milestones.length - 1);
                    return (
                      <div
                        key={`node-${String(k)}`}
                        style={{
                          position: 'absolute',
                          left: `${String(left)}%`,
                          top: `${(((ys[k + 1] ?? 300) / 320) * 100).toFixed(1)}%`,
                          transform: 'translate(-50%,-50%)',
                          animation: `lpPopNode .5s ease ${String(0.95 + k * 0.25)}s both`,
                        }}
                      >
                        <button
                          type="button"
                          aria-label={`Age ${String(ages[k] ?? '')}`}
                          onClick={() => setMilestoneIdx(k)}
                          style={{
                            display: 'block',
                            padding: 0,
                            cursor: 'pointer',
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            background: '#fff3d6',
                            boxShadow: active
                              ? '0 0 0 6px rgba(240,201,138,.20), 0 0 26px rgba(255,216,154,1)'
                              : '0 0 14px rgba(240,201,138,.7)',
                            border: '2px solid rgba(4,6,13,.9)',
                          }}
                        />
                      </div>
                    );
                  })}

                  <div
                    style={{
                      position: 'absolute',
                      left: '56%',
                      top: '72%',
                      transform: 'translate(-50%,-50%)',
                      textAlign: 'center',
                      pointerEvents: 'none',
                      animation: 'lpFadeIn 1s ease 2.4s both',
                    }}
                  >
                    <div
                      style={{
                        ...orbitron(13),
                        letterSpacing: '.22em',
                        textTransform: 'uppercase',
                        color: 'rgba(240,201,138,.75)',
                      }}
                    >
                      {COPY.gapTitle}
                    </div>
                    <div
                      style={{
                        marginTop: 5,
                        fontWeight: 600,
                        fontSize: 13,
                        color: 'rgba(200,222,234,.6)',
                      }}
                    >
                      {t(COPY.gapSub)}
                    </div>
                  </div>

                  {NODE_LEFT_PCT.map((left, k) => {
                    const active = k === Math.min(milestoneIdx, milestones.length - 1);
                    return (
                      <button
                        key={`label-${String(k)}`}
                        type="button"
                        onClick={() => setMilestoneIdx(k)}
                        style={{
                          position: 'absolute',
                          left: `${String(left)}%`,
                          bottom: -2,
                          transform: 'translateX(-50%)',
                          cursor: 'pointer',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          ...orbitron(12.5, 700),
                          color: active ? '#ffd89a' : '#5f7688',
                          transition: 'color .25s ease',
                        }}
                      >
                        {ages[k]}
                      </button>
                    );
                  })}
                </div>

                {/* Selected milestone */}
                <div
                  style={{
                    marginTop: 14,
                    borderTop: '1px solid rgba(75,233,255,.14)',
                    paddingTop: 22,
                  }}
                >
                  {isAreaLoading ? (
                    /*
                     * Deliberately no templated copy while a job is pending: a
                     * parent reading a milestone and having it silently rewrite
                     * itself seconds later cannot tell which version was real.
                     * The age heading stays because it is derived from the child's
                     * own age, not from the model, so it is already correct.
                     */
                    <div
                      key={`loading-${selectedArea?.id ?? 'core'}`}
                      style={{ animation: 'lpSwap .4s ease both' }}
                      aria-busy="true"
                      aria-live="polite"
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 14,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ ...orbitron(12), letterSpacing: '.22em', color: GOLD }}>
                          AGE {activeMilestone?.age}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            fontSize: 14,
                            fontWeight: 700,
                            letterSpacing: '.02em',
                            color: '#89d9ee',
                          }}
                        >
                          <span
                            style={{
                              width: 13,
                              height: 13,
                              borderRadius: '50%',
                              border: '2px solid rgba(75,233,255,.25)',
                              borderTopColor: CYAN,
                              animation: 'lpSpin .8s linear infinite',
                            }}
                          />
                          Personalising {selectedArea?.name ?? 'this area'} for{' '}
                          {childName || voice.him}…
                        </div>
                      </div>
                      <div style={{ ...twoCol, marginTop: 18 }}>
                        {[
                          {
                            label: COPY.msSuperpowerLabel,
                            accent: CYAN,
                            bg: 'linear-gradient(150deg,rgba(30,52,80,.55),rgba(8,13,24,.5))',
                            border: '1px solid rgba(75,233,255,.20)',
                            bars: [96, 88, 64, 0, 78],
                          },
                          {
                            label: COPY.msRoutineLabel,
                            accent: '#6f8697',
                            bg: 'rgba(9,12,19,.45)',
                            border: '1px solid rgba(120,145,165,.12)',
                            bars: [92, 70],
                          },
                        ].map((panel) => (
                          <div
                            key={panel.label}
                            style={{
                              borderRadius: 16,
                              padding: '20px 22px',
                              background: panel.bg,
                              border: panel.border,
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 11,
                                letterSpacing: '.2em',
                                textTransform: 'uppercase',
                                color: panel.accent,
                                opacity: 0.7,
                              }}
                            >
                              {panel.label}
                            </div>
                            <div style={{ marginTop: 14 }}>
                              {panel.bars.map((w, i) =>
                                w === 0 ? (
                                  <div
                                    key={`gap-${String(i)}`}
                                    style={{
                                      height: 1,
                                      margin: '14px 0',
                                      borderTop: '1px dashed rgba(75,233,255,.16)',
                                    }}
                                  />
                                ) : (
                                  <div
                                    key={`bar-${String(i)}`}
                                    style={{
                                      height: 11,
                                      width: `${String(w)}%`,
                                      marginBottom: 9,
                                      borderRadius: 6,
                                      background:
                                        'linear-gradient(90deg,rgba(75,233,255,.13),rgba(75,233,255,.05))',
                                      animation: `lpShimmer 1.5s ease-in-out ${String(i * 0.12)}s infinite`,
                                    }}
                                  />
                                ),
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {progressMessage && (
                        <div
                          style={{
                            marginTop: 16,
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: '#7f97a8',
                            animation: 'lpFadeIn .5s ease both',
                          }}
                        >
                          {progressMessage}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      key={`${selectedArea?.id ?? 'core'}-${String(milestoneIdx)}-${generated ? 'ai' : 'base'}`}
                      style={{ animation: 'lpSwap .4s ease both' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 14,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ ...orbitron(12), letterSpacing: '.22em', color: GOLD }}>
                          AGE {activeMilestone?.age}
                        </div>
                        <div style={{ ...orbitron(19, 700), color: '#f2fdff' }}>
                          {activeMilestone?.title}
                        </div>
                      </div>
                      <div style={{ ...twoCol, marginTop: 18 }}>
                        <div
                          style={{
                            borderRadius: 16,
                            padding: '20px 22px',
                            background:
                              'linear-gradient(150deg,rgba(30,52,80,.9),rgba(8,13,24,.7))',
                            border: '1px solid rgba(75,233,255,.4)',
                            boxShadow: '0 0 40px rgba(75,233,255,.10)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={CYAN}
                              strokeWidth={2}
                              style={{ width: 15, height: 15 }}
                            >
                              <path d="M13 2 5 13h6l-1 9 8-11h-6z" />
                            </svg>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 11,
                                letterSpacing: '.2em',
                                textTransform: 'uppercase',
                                color: CYAN,
                              }}
                            >
                              {COPY.msSuperpowerLabel}
                            </div>
                          </div>
                          <div
                            style={{
                              marginTop: 10,
                              fontSize: 15,
                              fontWeight: 600,
                              lineHeight: 1.5,
                              color: '#eafdff',
                            }}
                          >
                            {activeMilestone?.guided}
                          </div>
                          {activeMilestone?.power && (
                            <div
                              style={{
                                marginTop: 14,
                                paddingTop: 12,
                                borderTop: '1px dashed rgba(75,233,255,.22)',
                                fontSize: 13.5,
                                fontWeight: 700,
                                letterSpacing: '.02em',
                                color: '#89d9ee',
                              }}
                            >
                              {activeMilestone.power}
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            borderRadius: 16,
                            padding: '20px 22px',
                            background: 'rgba(9,12,19,.6)',
                            border: '1px solid rgba(120,145,165,.16)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#6f8697"
                              strokeWidth={2}
                              style={{ width: 15, height: 15 }}
                            >
                              <path d="M4 12h16" />
                            </svg>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 11,
                                letterSpacing: '.2em',
                                textTransform: 'uppercase',
                                color: '#6f8697',
                              }}
                            >
                              {COPY.msRoutineLabel}
                            </div>
                          </div>
                          <div
                            style={{
                              marginTop: 10,
                              fontSize: 15,
                              fontWeight: 600,
                              lineHeight: 1.5,
                              color: '#7f95a5',
                            }}
                          >
                            {activeMilestone?.drift}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* ── Superpower vs routine ────────────────────────────────── */}
              <section
                style={{
                  marginTop: isMobile ? 48 : 72,
                  animation: 'lpFadeUp .7s ease .3s both',
                }}
              >
                <div style={{ ...twoCol, marginTop: 30 }}>
                  <div
                    style={{
                      position: 'relative',
                      borderRadius: 22,
                      padding: '28px 30px',
                      background: 'linear-gradient(155deg,rgba(28,52,80,.9),rgba(40,32,16,.75))',
                      border: '1px solid rgba(240,201,138,.45)',
                      overflow: 'hidden',
                      boxShadow: '0 20px 70px rgba(75,233,255,.10)',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: -40,
                        bottom: -70,
                        width: 240,
                        height: 240,
                        borderRadius: '50%',
                        background:
                          'radial-gradient(circle,rgba(75,233,255,.18),rgba(75,233,255,0) 70%)',
                      }}
                    />
                    <div style={{ position: 'relative', ...orbitron(20), color: '#fff6e2' }}>
                      {COPY.compareSuperTitle}
                    </div>
                    <div
                      style={{
                        position: 'relative',
                        marginTop: 9,
                        fontSize: 14,
                        fontWeight: 700,
                        letterSpacing: '.02em',
                        lineHeight: 1.45,
                        color: GOLD,
                      }}
                    >
                      {t(COPY.compareSuperLead)}
                    </div>
                    <div
                      style={{
                        position: 'relative',
                        marginTop: 12,
                        fontSize: 14.5,
                        fontWeight: 600,
                        lineHeight: 1.5,
                        color: '#eddfc6',
                      }}
                    >
                      {t(COPY.compareSuperBody)}
                    </div>
                  </div>
                  <div
                    style={{
                      borderRadius: 22,
                      padding: '28px 30px',
                      background: 'rgba(9,12,19,.55)',
                      border: '1px solid rgba(120,145,165,.16)',
                    }}
                  >
                    <div style={{ ...orbitron(20, 700), color: '#8ba1b1' }}>
                      {COPY.compareRoutineTitle}
                    </div>
                    <div
                      style={{
                        marginTop: 9,
                        fontSize: 14,
                        fontWeight: 700,
                        letterSpacing: '.02em',
                        lineHeight: 1.45,
                        color: '#8ba1b1',
                      }}
                    >
                      {t(COPY.compareRoutineLead)}
                    </div>
                    <div
                      style={{
                        marginTop: 12,
                        fontSize: 14.5,
                        fontWeight: 600,
                        lineHeight: 1.5,
                        color: '#7c91a1',
                      }}
                    >
                      {t(COPY.compareRoutineBody)}
                    </div>
                  </div>
                </div>
              </section>

              {/* ── First 90 days ────────────────────────────────────────── */}
              <section
                style={{
                  marginTop: isMobile ? 48 : 76,
                  animation: 'lpFadeUp .7s ease .35s both',
                }}
              >
                <div>
                  <div style={{ ...orbitron(17), color: '#f2fdff' }}>{COPY.ninetyTitle}</div>
                  <div style={{ marginTop: 6, fontSize: 13.5, fontWeight: 600, color: '#7f97a8' }}>
                    Built for{' '}
                    {[childName, `age ${String(currentAge)}`, archetype ? `The ${archetype}` : null]
                      .filter(Boolean)
                      .join(', ')}{' '}
                    · one move per growth area, per month
                  </div>
                </div>

                <svg
                  viewBox="0 0 1000 52"
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    marginTop: 18,
                    fontFamily: 'Rajdhani, sans-serif',
                  }}
                >
                  <defs>
                    <linearGradient id="lpP90" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="rgba(75,233,255,.55)" />
                      <stop offset="100%" stopColor={GOLD} />
                    </linearGradient>
                  </defs>
                  <path
                    d="M40 38 L960 38"
                    fill="none"
                    stroke="url(#lpP90)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                  {TIMELINE.map((m) => (
                    <circle key={`dot-${String(m.x)}`} cx={m.x} cy={38} r={m.r} fill={m.fill} />
                  ))}
                  {TIMELINE.map((m) => (
                    <text
                      key={`txt-${String(m.x)}`}
                      x={m.x}
                      y={20}
                      textAnchor={m.anchor}
                      fill={m.color}
                      fontSize={16}
                      fontWeight={700}
                    >
                      {t(m.label)}
                    </text>
                  ))}
                </svg>

                <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
                  {MONTHS.map((m, i) => {
                    const on = i === monthIdx;
                    return (
                      <button
                        key={m.tab}
                        type="button"
                        onClick={() => setMonthIdx(i)}
                        style={{
                          cursor: 'pointer',
                          padding: '10px 20px',
                          borderRadius: 999,
                          border: `1px solid ${on ? 'rgba(240,201,138,.6)' : 'rgba(75,233,255,.2)'}`,
                          background: on ? 'rgba(240,201,138,.12)' : 'rgba(8,14,26,.7)',
                          fontFamily: 'Rajdhani, sans-serif',
                          fontWeight: 700,
                          fontSize: 11.5,
                          letterSpacing: '.14em',
                          textTransform: 'uppercase',
                          color: on ? '#f5e6c4' : '#7f97a8',
                          transition: 'all .25s ease',
                        }}
                      >
                        {m.tab}
                      </button>
                    );
                  })}
                </div>

                <div
                  key={`month-${String(monthIdx)}`}
                  style={{
                    marginTop: 18,
                    borderRadius: 20,
                    padding: isMobile ? '22px 20px' : '26px 28px',
                    background: 'linear-gradient(160deg,rgba(20,31,50,.75),rgba(8,13,24,.75))',
                    border: '1px solid rgba(240,201,138,.24)',
                    animation: 'lpSwap .4s ease both',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ ...orbitron(18, 700), color: '#eafdff' }}>
                      {MONTHS[monthIdx]?.title}
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 11,
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        color: '#6f8a9c',
                      }}
                    >
                      {MONTHS[monthIdx]?.days}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      maxWidth: 660,
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: 1.45,
                      color: '#7f97a8',
                    }}
                  >
                    {t((MONTHS[monthIdx]?.sub ?? '').replace('{quality}', superpower.quality))}
                  </div>
                  <div
                    style={{
                      marginTop: 22,
                      display: 'grid',
                      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                      gap: '14px 34px',
                    }}
                  >
                    {monthMoves.map(({ area, text, color }) => (
                      <div
                        key={area.id}
                        style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}
                      >
                        <div
                          style={{
                            width: 7,
                            height: 7,
                            marginTop: 7,
                            flexShrink: 0,
                            borderRadius: '50%',
                            background: color,
                          }}
                        />
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            lineHeight: 1.45,
                            color: '#c8dae5',
                          }}
                        >
                          <span style={{ color }}>{area.name}</span> · {text}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      marginTop: 24,
                      paddingTop: 16,
                      borderTop: '1px solid rgba(75,233,255,.14)',
                      fontSize: 14,
                      fontWeight: 700,
                      color: '#8fd8e8',
                    }}
                  >
                    {t(MONTHS[monthIdx]?.end ?? '')}
                  </div>
                </div>
              </section>

              {/* ── CTA ──────────────────────────────────────────────────── */}
              <section
                style={{
                  marginTop: isMobile ? 56 : 80,
                  textAlign: 'center',
                  animation: 'lpFadeUp .7s ease .45s both',
                }}
              >
                <h2
                  style={{
                    margin: '0 auto',
                    maxWidth: 760,
                    ...orbitron(),
                    fontSize: 'clamp(19px,2.2vw,26px)',
                    lineHeight: 1.25,
                  }}
                >
                  {t(COPY.ctaHeadlineA)}
                  <br />
                  <span style={{ color: GOLD }}>{t(COPY.ctaHeadlineB)}</span>
                </h2>
                <button
                  type="button"
                  className="lp-cta"
                  onClick={handleStartJourney}
                  style={{
                    cursor: 'pointer',
                    marginTop: 26,
                    padding: '15px 38px',
                    borderRadius: 999,
                    border: 'none',
                    background: `linear-gradient(135deg,${CYAN},${GOLD})`,
                    ...orbitron(13),
                    letterSpacing: '.16em',
                    textTransform: 'uppercase',
                    color: '#05131a',
                    boxShadow: '0 0 40px rgba(75,233,255,.4)',
                  }}
                >
                  Start {childName ? `${childName}'s` : 'the'} 90 days
                </button>
              </section>
            </main>

            {/* ── Concern modal ────────────────────────────────────────── */}
            <AnimatePresence>
              {showConcernModal && (
                <motion.div
                  {...MODAL_BACKDROP}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
                  style={{ background: 'rgba(4,6,13,.8)' }}
                  onClick={closeConcernModal}
                  role="presentation"
                >
                  <motion.div
                    {...MODAL_SCALE}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Share your concern"
                    className="relative w-full max-w-lg rounded-2xl p-8 pt-12"
                    style={{
                      background: 'linear-gradient(160deg,rgba(20,31,50,.96),rgba(8,13,24,.98))',
                      border: '1px solid rgba(240,201,138,.3)',
                      boxShadow: '0 30px 90px rgba(2,6,15,.8)',
                      fontFamily: 'Rajdhani, sans-serif',
                      color: '#e7f5f9',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={closeConcernModal}
                      className="absolute right-4 top-4 rounded-xl p-2 transition-colors"
                      style={{ color: '#7f97a8' }}
                      aria-label="Close dialog"
                    >
                      <X className="h-5 w-5" />
                    </button>
                    <AnimatePresence mode="wait">
                      {!concernSubmitted ? (
                        <motion.div
                          key="form"
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{
                            opacity: 0,
                            y: -12,
                            transition: { duration: 0.3, ease: 'easeIn' },
                          }}
                          transition={{ duration: 0.5, ease: 'easeOut' }}
                          className="space-y-5"
                        >
                          <div className="mb-2 flex items-center gap-3">
                            <div
                              className="flex h-11 w-11 items-center justify-center rounded-xl"
                              style={{
                                background: `linear-gradient(135deg,${CYAN},${GOLD})`,
                                boxShadow: '0 0 26px rgba(75,233,255,.35)',
                              }}
                            >
                              <Sparkles className="h-5 w-5" style={{ color: INK }} />
                            </div>
                            <div>
                              <h3 style={{ ...orbitron(16, 700), color: '#f2fdff' }}>
                                One last thing
                              </h3>
                              <p style={{ fontSize: 13.5, fontWeight: 600, color: '#7f97a8' }}>
                                Superpower wants to know
                              </p>
                            </div>
                          </div>
                          <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.55 }}>
                            Hey{' '}
                            <span style={{ fontWeight: 700, color: CYAN }}>
                              {user?.full_name?.split(' ')[0] ?? 'there'}
                            </span>
                            , is there anything you want Superpower to work on right now with{' '}
                            <span style={{ fontWeight: 700, color: GOLD }}>{childName}</span>?
                          </p>
                          <TextareaWithVoice
                            value={concernInput}
                            onChange={(e) => setConcernInput(e.target.value)}
                            placeholder={`e.g., I want to improve English speaking skills for ${childName || 'my child'}.`}
                            className="min-h-[120px] w-full resize-none rounded-xl p-4"
                            style={{
                              background: 'rgba(4,6,13,.7)',
                              border: '1px solid rgba(75,233,255,.24)',
                              color: '#e7f5f9',
                              fontFamily: 'Rajdhani, sans-serif',
                              fontWeight: 600,
                            }}
                          />
                          <div className="flex gap-3">
                            <Button
                              variant="outline"
                              onClick={handleProceedToDashboard}
                              className="h-11 flex-1 rounded-xl text-base"
                              style={{
                                // Explicit opaque fill rather than relying on `bg-transparent`
                                // to beat the outline variant's own `bg-background`: those are
                                // both single-class selectors, so which one wins depends on
                                // Tailwind's emit order rather than on anything stated here.
                                background: '#0a111e',
                                border: '1px solid rgba(75,233,255,.3)',
                                color: '#9db4c4',
                                fontFamily: 'Rajdhani, sans-serif',
                                fontWeight: 700,
                              }}
                            >
                              Skip for now
                            </Button>
                            <Button
                              onClick={() => {
                                void handleConcernSubmit();
                              }}
                              disabled={!concernInput.trim()}
                              className="h-11 flex-1 rounded-xl text-base disabled:opacity-40"
                              style={{
                                background: `linear-gradient(135deg,${CYAN},${GOLD})`,
                                color: '#05131a',
                                fontFamily: 'Orbitron, sans-serif',
                                fontWeight: 900,
                                letterSpacing: '.08em',
                                fontSize: 12,
                                textTransform: 'uppercase',
                              }}
                            >
                              Submit
                              <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="success"
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, ease: 'easeOut' }}
                          className="space-y-6 text-center"
                        >
                          <div
                            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
                            style={{ background: `linear-gradient(135deg,${CYAN},${GOLD})` }}
                          >
                            <span className="text-2xl">✅</span>
                          </div>
                          <div>
                            <h3 className="mb-2" style={{ ...orbitron(16, 700), color: '#f2fdff' }}>
                              Got it
                            </h3>
                            <p
                              style={{
                                fontSize: 15,
                                fontWeight: 600,
                                lineHeight: 1.55,
                                color: '#a8c1d1',
                              }}
                            >
                              We will work with{' '}
                              <span style={{ fontWeight: 700, color: GOLD }}>{childName}</span> on
                              the same.
                            </p>
                          </div>
                          <Button
                            onClick={handleProceedToDashboard}
                            className="h-11 w-full rounded-xl text-base"
                            style={{
                              background: `linear-gradient(135deg,${CYAN},${GOLD})`,
                              color: '#05131a',
                              fontFamily: 'Orbitron, sans-serif',
                              fontWeight: 900,
                              letterSpacing: '.08em',
                              fontSize: 12,
                              textTransform: 'uppercase',
                            }}
                          >
                            Go to Dashboard
                            <ChevronRight className="ml-2 h-4 w-4" />
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {showSplash && <StageSplash stage={4} onReady={startTimer} />}
      </AnimatePresence>
    </>
  );
}
