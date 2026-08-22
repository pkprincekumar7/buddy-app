import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Sparkles, X } from 'lucide-react';

import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';
import { useAuth } from '@/lib/AuthContext';
import { useAmbientAudio } from '@/lib/AmbientAudioContext';
import { useIsMobile, useMediaQuery } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { api } from '@/api/client';
import { useLifePathwayData } from '@/hooks/useLifePathwayData';
import { useLifePathwayArea } from '@/hooks/useLifePathwayArea';
import { MODAL_BACKDROP, MODAL_SCALE } from '@/lib/animations';
import Spinner from '@/components/shared/Spinner';
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
 * Multiplies a design-time pixel value by `--lp-type-scale` — 1 on phones, 1.2
 * from the tablet breakpoint up (see the style block in the component).
 *
 * Used for font sizes AND for prose max-widths: a readable measure is a character
 * count, not a pixel width, so a cap frozen while the text grew 20% would quietly
 * tighten every paragraph and add wrap lines.
 *
 * Everything that sets a size must route through here, including the orbitron()
 * helper and the clamp()-sized headings — both originally passed raw values and so
 * silently opted out of the scale, leaving most of the page unchanged.
 *
 * The design mockups for this app carry NO media queries — fixed pixel type at
 * every width. Scaling by viewport is a deliberate departure, matching the
 * Observations and Connect pages. Do not "restore mockup fidelity" here without
 * checking that intent first.
 */
const lpScale = (px: number) => `calc(${px}px * var(--lp-type-scale, 1))`;

/** Font sizes. */
const lpfs = lpScale;

/** Prose line-length caps. */
const lpProseW = lpScale;

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

/**
 * Breaks the chart's gap caption after its pronoun clause — "everything {he}
 * never" / "got exposed to" — for narrow screens.
 *
 * On one line the caption measures 199px, which on a 320px phone leaves it
 * straddling the rising curve with nowhere to move; split, the widest line is
 * 117px, so it keeps its full 13px size and still clears the curve. Splitting
 * after the third word keeps the pronoun with its verb for every gender token.
 * Returns null when the copy is too short to split, so callers fall back to a
 * single line rather than rendering an empty second one.
 */
function splitGapCaption(text: string): [string, string] | null {
  const words = text.split(' ');
  if (words.length < 4) return null;
  return [words.slice(0, 3).join(' '), words.slice(3).join(' ')];
}

const GOLD = 'rgb(var(--constellation-gold-rgb))';
const CYAN = 'rgb(var(--constellation-cyan-rgb))';
const INK = 'rgb(var(--constellation-navy-deepest-rgb))';

/**
 * Geometry for the 90-day rail's Day 0/30/60/90 labels.
 *
 * The rail is an SVG with a 1000-unit-wide viewBox scaled to its container, so a
 * fixed unit size does NOT give a fixed rendered size — it renders at
 * `units × containerWidth / 1000`. A single value therefore reads well at exactly
 * one width and badly everywhere else: 16 units is ~17.9px in a 1120px box but
 * ~11.6px at 727px and ~5.4px at 335px.
 *
 * So the size is computed from the measured container instead, holding the rendered
 * size constant at every width. LABEL_TARGET_PX is what the parent actually sees.
 */
const LABEL_TARGET_PX = 15;

/**
 * Larger target once the rail is wide enough to carry it on ONE line.
 *
 * The gate is arithmetic, not taste: one line needs units ≤ LABEL_ONE_LINE_MAX_UNITS
 * (20), and units = target × 1000 / rail, so an 18px target only stays on one line
 * from a 900px rail up (18000/900 = 20). Applying it below that would flip wide-ish
 * desktops back to two-line labels, which reads worse than the extra pixel.
 */
const LABEL_TARGET_PX_WIDE = 18;
const LABEL_WIDE_RAIL_MIN = 900;

/**
 * Above this unit size the one-line form collides and the label must break at its
 * "·". Measured, not estimated: at a 560px rail the smallest gap between adjacent
 * one-line labels is 19px at 20 units, 4px at 22, and negative from 24 up.
 *
 * Both this and LABEL_MAX_UNITS are scale-invariant, so they work as plain unit
 * thresholds at any rail width — a label's width and the 307-unit spacing between
 * slots both scale with the viewBox, so their ratio never changes.
 */
const LABEL_ONE_LINE_MAX_UNITS = 20;

/**
 * Hard ceiling on the unit size, set by geometry rather than taste.
 *
 * The four labels sit at fixed x positions (40, 347, 653, 960) with start/middle/
 * middle/end anchors, so the last one grows leftward into its neighbour. Measured
 * at a 335px rail, the smallest gap between adjacent labels is 6px at 34 units,
 * 1px at 36, and NEGATIVE from 38 up — "Day 60 · his own idea" and
 * "Day 90 · second nature" start overlapping.
 *
 * This is what caps a phone at ~11.4px rather than LABEL_TARGET_PX: four labels of
 * this length simply do not fit a 335px rail any larger, even split across two
 * lines. Getting to 15px there would mean dropping the Day 30/60 labels on narrow
 * screens (their dots would remain) or shortening the copy — a design decision,
 * not something to force here.
 */
const LABEL_MAX_UNITS = 34;

export default function LifePathway() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  // Two rows in the 90-day section run out of horizontal room well before the
  // 768px mobile breakpoint, so they key off their own measured threshold: the
  // month tabs measure 482px at full scale and stop fitting one line under
  // ~522px (482 + main's 2×20px padding), and the timeline labels need to break
  // in two around the same point. Using the real threshold rather than
  // `isMobile` leaves a 600px tablet the full-size treatment it has room for;
  // the few px of slack absorb font-loading and sub-pixel variance.
  const isNarrow = useMediaQuery('(max-width: 535px)');

  const { childData, profile, isLoading, completedAreas, savedConcern, setSavedConcern } =
    useLifePathwayData(childId);
  const [showSplash, startTimer] = useStageSplash(0);
  const { setSuppressed: setAmbientSuppressed } = useAmbientAudio();

  // Measured width of the 90-day rail, so its labels can hold a constant rendered
  // size (see LABEL_TARGET_PX). A media query cannot do this: the rail's width
  // depends on main's max-width AND its breakpoint-dependent padding, so the same
  // viewport yields different rail widths and the same unit size renders at
  // different pixel sizes either side of a padding change.
  const railRef = useRef<SVGSVGElement>(null);
  const [railWidth, setRailWidth] = useState(0);
  // Deps are the two gates that decide whether the rail is mounted at all. With an
  // empty dep list this ran once while isLoading still showed the spinner, found a
  // null ref, bailed and never retried — leaving the labels on their fallback size
  // forever. These gates are what make the ref become non-null.
  useEffect(() => {
    const el = railRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setRailWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLoading, showSplash]);

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

  /** Two-line form of the chart's gap caption; null on wide screens (see splitGapCaption). */
  const gapCaptionLines = isNarrow ? splitGapCaption(t(COPY.gapSub)) : null;

  /**
   * Day 0/30/60/90 label geometry, derived from the measured rail width so the
   * labels render at LABEL_TARGET_PX regardless of viewport.
   *
   * Everything downstream is expressed as a multiple of `units` rather than a fixed
   * number, so the rail, the dots and the viewBox height all follow the type
   * instead of being re-tuned by hand each time the size changes. The ratios are
   * the ones the original hand-picked geometry used (y=32, dy=38, rail=96,
   * height=106 against 32 units).
   */
  const railLabel = useMemo(() => {
    const target = railWidth >= LABEL_WIDE_RAIL_MIN ? LABEL_TARGET_PX_WIDE : LABEL_TARGET_PX;
    const units =
      railWidth > 0 ? Math.min(LABEL_MAX_UNITS, Math.round((target * 1000) / railWidth)) : 16;
    const split = units > LABEL_ONE_LINE_MAX_UNITS;
    return {
      units,
      split,
      // First baseline; the one-line form sits a little lower in its shorter box.
      y: Math.round(units * (split ? 1 : 1.25)),
      // Second-line offset, only used when split.
      dy: Math.round(units * 1.19),
      railY: Math.round(units * (split ? 3 : 2.375)),
      viewBoxHeight: Math.round(units * (split ? 3.31 : 3.25)),
    };
  }, [railWidth]);

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
    areas: completedAreas,
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
    fontSize: lpfs(10.5),
    textTransform: 'uppercase',
    color: GOLD,
  };
  // size is optional: the three headings that size themselves with clamp() would
  // otherwise have to pass a throwaway 0 and rely on a later `fontSize` key
  // overriding it — which works only while the keys stay in that order.
  // Sizes go through lpfs() here rather than at each call site: this helper carries
  // most of the page's headings, and passing a raw number would silently opt them
  // out of --lp-type-scale — which is exactly what happened the first time.
  const orbitron = (size?: number, weight: 700 | 900 = 900): React.CSSProperties => ({
    fontFamily: 'Orbitron, sans-serif',
    fontWeight: weight,
    ...(size === undefined ? {} : { fontSize: lpfs(size) }),
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
            <Spinner className="h-12 w-12 border-4" />
          </div>
        ) : (
          <div
            key={showSplash ? 'splash' : 'content'}
            style={{
              minHeight: '100vh',
              background:
                'radial-gradient(ellipse at 70% -10%,rgb(var(--constellation-gold-rgb) / .13),rgb(var(--constellation-navy-deepest-rgb) / 0) 52%),radial-gradient(ellipse at 12% 30%,rgb(var(--constellation-cyan-bright-rgb) / .14),rgb(var(--constellation-navy-deepest-rgb) / 0) 50%),radial-gradient(ellipse at 20% 95%,rgba(160,120,255,.10),rgb(var(--constellation-navy-deepest-rgb) / 0) 45%),rgb(var(--constellation-navy-deepest-rgb))',
              fontFamily: 'Rajdhani, sans-serif',
              color: '#e7f5f9',
            }}
            className="lp-root"
          >
            <style>{`
              /* Content column widens on large displays; type takes a flat +20%
                 from the tablet breakpoint up. Unlike Connect there is no fixed
                 track to grow alongside the container — every section here is
                 fractional (1fr 1fr, 1.15fr 1fr), so the components absorb the
                 extra width on their own.
                 Phones stay at scale 1: the smallest labels are already near the
                 legibility floor, and isMobile separately drops the padding. */
              .lp-root { --lp-max: 1200px; --lp-type-scale: 1; }
              @media (min-width: 768px)  { .lp-root { --lp-type-scale: 1.2; } }
              @media (min-width: 1440px) { .lp-root { --lp-max: 1400px; } }
              @media (min-width: 1800px) { .lp-root { --lp-max: 1640px; } }
              @keyframes lpFadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
              @keyframes lpFadeIn { from { opacity: 0; } to { opacity: 1; } }
              @keyframes lpDrawLine { from { stroke-dashoffset: 1600; } to { stroke-dashoffset: 0; } }
              @keyframes lpGapIn { from { opacity: 0; } to { opacity: 1; } }
              @keyframes lpPopNode { 0% { opacity: 0; transform: scale(.3); } 60% { transform: scale(1.25); } 100% { opacity: 1; transform: scale(1); } }
              @keyframes lpSwap { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
              @keyframes lpGlowText { 0%, 100% { text-shadow: 0 0 26px rgb(var(--constellation-gold-rgb) / .35); } 50% { text-shadow: 0 0 44px rgb(var(--constellation-gold-rgb) / .7); } }
              @keyframes lpSpin { to { transform: rotate(360deg); } }
              @keyframes lpShimmer { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
              .lp-select { appearance: none; -webkit-appearance: none; }
              .lp-select:hover, .lp-select:focus { border-color: rgb(var(--constellation-cyan-rgb) / .7) !important; }
              .lp-cta { transition: transform .2s ease, box-shadow .2s ease; }
              .lp-cta:hover { transform: translateY(-2px); box-shadow: 0 0 60px rgb(var(--constellation-gold-rgb) / .55) !important; }
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
                maxWidth: 'var(--lp-max, 1200px)',
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
                    maxWidth: lpProseW(760),
                    fontSize: lpfs(15),
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
                    maxWidth: lpProseW(940),
                    ...orbitron(),
                    fontSize: 'calc(clamp(26px,3.8vw,44px) * var(--lp-type-scale, 1))',
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
                    maxWidth: lpProseW(640),
                    fontSize: lpfs(16),
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
                    border: '1px solid rgb(var(--constellation-gold-rgb) / .4)',
                    overflow: 'hidden',
                    boxShadow: '0 0 60px rgb(var(--constellation-gold-rgb) / .10) inset',
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
                        'radial-gradient(circle,rgb(var(--constellation-gold-rgb) / .22),rgb(var(--constellation-gold-rgb) / 0) 70%)',
                    }}
                  />
                  <div style={{ position: 'relative', ...eyebrow }}>{t(COPY.superpowerLabel)}</div>
                  <div
                    style={{
                      position: 'relative',
                      marginTop: 10,
                      ...orbitron(),
                      fontSize: 'calc(clamp(22px,2.5vw,30px) * var(--lp-type-scale, 1))',
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
                      fontSize: lpfs(14.5),
                      fontWeight: 600,
                      lineHeight: 1.5,
                      color: '#e0cba8',
                      maxWidth: lpProseW(460),
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
                            border: '1px solid rgb(var(--constellation-gold-rgb) / .45)',
                            fontWeight: 700,
                            fontSize: lpfs(12),
                            letterSpacing: '.12em',
                            textTransform: 'uppercase',
                            color: 'rgb(var(--constellation-gold-pale-rgb))',
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
                    border: '1px solid rgb(var(--constellation-cyan-rgb) / .22)',
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
                      fontSize: lpfs(14),
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
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .18)',
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
                    <div
                      style={{
                        ...orbitron(17),
                        letterSpacing: '.02em',
                        color: 'rgb(var(--constellation-cyan-paler-rgb))',
                      }}
                    >
                      {COPY.chartTitle}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: lpfs(13.5),
                        fontWeight: 600,
                        color: '#7f97a8',
                      }}
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
                            fontSize: lpfs(10.5),
                            letterSpacing: '.2em',
                            textTransform: 'uppercase',
                            color: 'rgb(var(--constellation-slate-rgb))',
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
                              border: '1px solid rgb(var(--constellation-cyan-rgb) / .34)',
                              fontFamily: 'Rajdhani, sans-serif',
                              fontWeight: 700,
                              fontSize: lpfs(14),
                              letterSpacing: '.04em',
                              color: 'rgb(var(--constellation-cyan-pale-rgb))',
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
                          fontSize: lpfs(11),
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
                          fontSize: lpfs(11),
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
                        <stop offset="100%" stopColor="rgb(var(--constellation-gold-rgb) / .26)" />
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
                              ? '0 0 0 6px rgb(var(--constellation-gold-rgb) / .20), 0 0 26px rgba(255,216,154,1)'
                              : '0 0 14px rgb(var(--constellation-gold-rgb) / .7)',
                            border: '2px solid rgb(var(--constellation-navy-deepest-rgb) / .9)',
                          }}
                        />
                      </div>
                    );
                  })}

                  <div
                    style={{
                      position: 'absolute',
                      // An absolutely positioned box with `left` but no width is
                      // shrink-to-fit *capped at (container − left)* — only 44%
                      // of the chart here. That is roomy on desktop (~460px) but
                      // leaves 106px on a 320px phone, which wrapped this caption
                      // into three cramped lines straddling the curve. Declaring
                      // the width opts out of that cap so the copy keeps its
                      // natural single line (204px at full size); maxWidth still
                      // keeps it inside the chart. The centring transform means
                      // this does not move the caption on desktop.
                      width: 'max-content',
                      maxWidth: '100%',
                      // Nudged right on narrow screens, where the curve climbs
                      // through the caption's left edge. Only affordable because
                      // the two-line split above shrinks the box to ~117px — the
                      // gap wedge itself ends at 94% of the chart, so the caption
                      // has to stay left of that.
                      left: isNarrow ? '66%' : '56%',
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
                        color: 'rgb(var(--constellation-gold-rgb) / .75)',
                      }}
                    >
                      {COPY.gapTitle}
                    </div>
                    <div
                      style={{
                        marginTop: 5,
                        fontWeight: 600,
                        fontSize: lpfs(13),
                        // Only meaningful once the caption is two lines, and left
                        // unset otherwise so the single-line box keeps its
                        // inherited 19.5px line box on wider screens.
                        ...(gapCaptionLines === null ? {} : { lineHeight: 1.35 }),
                        color: 'rgba(200,222,234,.6)',
                      }}
                    >
                      {gapCaptionLines === null ? (
                        t(COPY.gapSub)
                      ) : (
                        <>
                          {gapCaptionLines[0]}
                          <br />
                          {gapCaptionLines[1]}
                        </>
                      )}
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
                    borderTop: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
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
                            fontSize: lpfs(14),
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
                              border: '2px solid rgb(var(--constellation-cyan-rgb) / .25)',
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
                            border: '1px solid rgb(var(--constellation-cyan-rgb) / .20)',
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
                                fontSize: lpfs(11),
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
                                      borderTop:
                                        '1px dashed rgb(var(--constellation-cyan-rgb) / .16)',
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
                                        'linear-gradient(90deg,rgb(var(--constellation-cyan-rgb) / .13),rgb(var(--constellation-cyan-rgb) / .05))',
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
                            fontSize: lpfs(13.5),
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
                        <div
                          style={{
                            ...orbitron(19, 700),
                            color: 'rgb(var(--constellation-cyan-paler-rgb))',
                          }}
                        >
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
                            border: '1px solid rgb(var(--constellation-cyan-rgb) / .4)',
                            boxShadow: '0 0 40px rgb(var(--constellation-cyan-rgb) / .10)',
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
                                fontSize: lpfs(11),
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
                              fontSize: lpfs(15),
                              fontWeight: 600,
                              lineHeight: 1.5,
                              color: 'rgb(var(--constellation-cyan-pale-rgb))',
                            }}
                          >
                            {activeMilestone?.guided}
                          </div>
                          {activeMilestone?.power && (
                            <div
                              style={{
                                marginTop: 14,
                                paddingTop: 12,
                                borderTop: '1px dashed rgb(var(--constellation-cyan-rgb) / .22)',
                                fontSize: lpfs(13.5),
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
                                fontSize: lpfs(11),
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
                              fontSize: lpfs(15),
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
                      border: '1px solid rgb(var(--constellation-gold-rgb) / .45)',
                      overflow: 'hidden',
                      boxShadow: '0 20px 70px rgb(var(--constellation-cyan-rgb) / .10)',
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
                          'radial-gradient(circle,rgb(var(--constellation-cyan-rgb) / .18),rgb(var(--constellation-cyan-rgb) / 0) 70%)',
                      }}
                    />
                    <div style={{ position: 'relative', ...orbitron(20), color: '#fff6e2' }}>
                      {COPY.compareSuperTitle}
                    </div>
                    <div
                      style={{
                        position: 'relative',
                        marginTop: 9,
                        fontSize: lpfs(14),
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
                        fontSize: lpfs(14.5),
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
                    <div
                      style={{
                        ...orbitron(20, 700),
                        color: 'rgb(var(--constellation-slate-light-rgb))',
                      }}
                    >
                      {COPY.compareRoutineTitle}
                    </div>
                    <div
                      style={{
                        marginTop: 9,
                        fontSize: lpfs(14),
                        fontWeight: 700,
                        letterSpacing: '.02em',
                        lineHeight: 1.45,
                        color: 'rgb(var(--constellation-slate-light-rgb))',
                      }}
                    >
                      {t(COPY.compareRoutineLead)}
                    </div>
                    <div
                      style={{
                        marginTop: 12,
                        fontSize: lpfs(14.5),
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
                  <div
                    style={{ ...orbitron(17), color: 'rgb(var(--constellation-cyan-paler-rgb))' }}
                  >
                    {COPY.ninetyTitle}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: lpfs(13.5),
                      fontWeight: 600,
                      color: '#7f97a8',
                    }}
                  >
                    Built for{' '}
                    {[childName, `age ${String(currentAge)}`, archetype ? `The ${archetype}` : null]
                      .filter(Boolean)
                      .join(', ')}{' '}
                    · one move per growth area, per month
                  </div>
                </div>

                {/*
                  Sized by its viewBox, so text inside scales with the container
                  rather than holding a CSS px size — see LABEL_TARGET_PX for why
                  the label size is computed from the measured width instead of
                  being a fixed number per breakpoint. The whole box (baselines,
                  rail, dots, height) follows from that one size.
                */}
                <svg
                  ref={railRef}
                  viewBox={`0 0 1000 ${String(railLabel.viewBoxHeight)}`}
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
                      <stop offset="0%" stopColor="rgb(var(--constellation-cyan-rgb) / .55)" />
                      <stop offset="100%" stopColor={GOLD} />
                    </linearGradient>
                  </defs>
                  <path
                    d={`M40 ${String(railLabel.railY)} L960 ${String(railLabel.railY)}`}
                    fill="none"
                    stroke="url(#lpP90)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                  {TIMELINE.map((m) => (
                    <circle
                      key={`dot-${String(m.x)}`}
                      cx={m.x}
                      cy={railLabel.railY}
                      r={m.r}
                      fill={m.fill}
                    />
                  ))}
                  {TIMELINE.map((m) => {
                    const label = t(m.label);
                    // Split on the first separator only, so a label that ever
                    // carries two keeps the remainder instead of dropping it.
                    const sep = railLabel.split ? label.indexOf(' · ') : -1;
                    const head = sep === -1 ? label : label.slice(0, sep);
                    const tail = sep === -1 ? null : label.slice(sep + 3);
                    return (
                      <text
                        key={`txt-${String(m.x)}`}
                        x={m.x}
                        y={railLabel.y}
                        textAnchor={m.anchor}
                        fill={m.color}
                        fontSize={railLabel.units}
                        fontWeight={700}
                      >
                        {tail === null ? (
                          head
                        ) : (
                          <>
                            <tspan x={m.x}>{head}</tspan>
                            <tspan x={m.x} dy={railLabel.dy}>
                              {tail}
                            </tspan>
                          </>
                        )}
                      </text>
                    );
                  })}
                </svg>

                {/*
                  Narrow phones get a compact pill so all three month tabs stay on
                  one line. Tightening the font, letter-spacing, side padding and
                  gap takes the row from 482px to 307px, which clears the 320px a
                  360px-wide Android leaves inside `main`'s padding. Under ~347px
                  (iPhone SE 1st gen) it wraps again — flexWrap keeps that tidy
                  rather than overflowing the page.
                */}
                <div
                  style={{
                    display: 'flex',
                    gap: isNarrow ? 6 : lpScale(10),
                    marginTop: 24,
                    flexWrap: 'wrap',
                  }}
                >
                  {MONTHS.map((m, i) => {
                    const on = i === monthIdx;
                    return (
                      <button
                        key={m.tab}
                        type="button"
                        onClick={() => setMonthIdx(i)}
                        style={{
                          cursor: 'pointer',
                          // Padding scales with the type so the pill grows with its
                          // label rather than the text crowding a fixed box. The
                          // compact phone form is left alone — it exists to keep all
                          // three tabs on one line at 320px (see comment above).
                          padding: isNarrow ? '6px 8px' : `${lpScale(10)} ${lpScale(20)}`,
                          borderRadius: 999,
                          border: `1px solid ${on ? 'rgb(var(--constellation-gold-rgb) / .6)' : 'rgb(var(--constellation-cyan-rgb) / .2)'}`,
                          background: on
                            ? 'rgb(var(--constellation-gold-rgb) / .12)'
                            : 'rgba(8,14,26,.7)',
                          fontFamily: 'Rajdhani, sans-serif',
                          fontWeight: 700,
                          // Was a bare ternary, which the page-wide conversion to
                          // lpfs() did not match — so these tabs were the last text
                          // on the page still opted out of --lp-type-scale.
                          fontSize: lpfs(isNarrow ? 9.5 : 11.5),
                          letterSpacing: isNarrow ? '.06em' : '.14em',
                          textTransform: 'uppercase',
                          whiteSpace: 'nowrap',
                          color: on ? 'rgb(var(--constellation-gold-pale-rgb))' : '#7f97a8',
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
                    border: '1px solid rgb(var(--constellation-gold-rgb) / .24)',
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
                    <div
                      style={{
                        ...orbitron(18, 700),
                        color: 'rgb(var(--constellation-cyan-pale-rgb))',
                      }}
                    >
                      {MONTHS[monthIdx]?.title}
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: lpfs(11),
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        color: 'rgb(var(--constellation-slate-rgb))',
                      }}
                    >
                      {MONTHS[monthIdx]?.days}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      maxWidth: lpProseW(660),
                      fontSize: lpfs(14),
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
                            fontSize: lpfs(14),
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
                      borderTop: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
                      fontSize: lpfs(14),
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
                    maxWidth: lpProseW(760),
                    ...orbitron(),
                    fontSize: 'calc(clamp(19px,2.2vw,26px) * var(--lp-type-scale, 1))',
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
                    color: 'rgb(var(--constellation-navy-rgb))',
                    boxShadow: '0 0 40px rgb(var(--constellation-cyan-rgb) / .4)',
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
                  style={{ background: 'rgb(var(--constellation-navy-deepest-rgb) / .8)' }}
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
                      border: '1px solid rgb(var(--constellation-gold-rgb) / .3)',
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
                                boxShadow: '0 0 26px rgb(var(--constellation-cyan-rgb) / .35)',
                              }}
                            >
                              <Sparkles className="h-5 w-5" style={{ color: INK }} />
                            </div>
                            <div>
                              <h3
                                style={{
                                  ...orbitron(16, 700),
                                  color: 'rgb(var(--constellation-cyan-paler-rgb))',
                                }}
                              >
                                One last thing
                              </h3>
                              <p
                                style={{ fontSize: lpfs(13.5), fontWeight: 600, color: '#7f97a8' }}
                              >
                                Superpower wants to know
                              </p>
                            </div>
                          </div>
                          <p style={{ fontSize: lpfs(15), fontWeight: 600, lineHeight: 1.55 }}>
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
                              background: 'rgb(var(--constellation-navy-deepest-rgb) / .7)',
                              border: '1px solid rgb(var(--constellation-cyan-rgb) / .24)',
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
                                border: '1px solid rgb(var(--constellation-cyan-rgb) / .3)',
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
                                color: 'rgb(var(--constellation-navy-rgb))',
                                fontFamily: 'Orbitron, sans-serif',
                                fontWeight: 900,
                                letterSpacing: '.08em',
                                fontSize: lpfs(12),
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
                            <h3
                              className="mb-2"
                              style={{
                                ...orbitron(16, 700),
                                color: 'rgb(var(--constellation-cyan-paler-rgb))',
                              }}
                            >
                              Got it
                            </h3>
                            <p
                              style={{
                                fontSize: lpfs(15),
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
                              color: 'rgb(var(--constellation-navy-rgb))',
                              fontFamily: 'Orbitron, sans-serif',
                              fontWeight: 900,
                              letterSpacing: '.08em',
                              fontSize: lpfs(12),
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
