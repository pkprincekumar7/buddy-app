import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { children, type Child } from '@/api/children';
import { ApiError } from '@/api/errors';
import { isAbort } from '@/api/polling';
import { release, RELEASE_ERRORS, runObservationsGeneration } from '@/api/release';
import { jobProgressMessage } from '@/lib/jobProgress';
import { httpErrorMessage } from '@/lib/apiError';
import Spinner from '@/components/shared/Spinner';
import {
  OBSERVATION_ICONS,
  formatObservationSources,
  normalizeObservations,
  type ObservationItem,
} from '@/lib/observationsData';
import { fillTemplate } from '@/lib/growthAreaData';
import { useUnmountSignal } from '@/hooks/useUnmountSignal';
import RecentMoods from '@/components/observations/RecentMoods';

/**
 * Multiplies a design-time pixel value by `--obs-type-scale` — 1 on phones, 1.2
 * from the tablet breakpoint up (see the component's style block).
 *
 * Worth knowing before changing this: the design mockups carry NO media queries —
 * every size in them is a fixed pixel value at every width, with only the hero
 * moving via its own clamp(). Scaling type by viewport is therefore a deliberate
 * departure from them, chosen because the fixed scale left large displays feeling
 * sparse once the content column was widened. Do not "restore mockup fidelity"
 * here without checking that intent first.
 *
 * Phones stay at 1: these sizes were drawn against a 1120px desktop layout, and at
 * 375px the small uppercase labels with wide tracking are already near the
 * legibility floor.
 */
const scaled = (px: number) => `calc(${px}px * var(--obs-type-scale, 1))`;

/** Font sizes. */
const fs = scaled;

/**
 * Prose line-length caps, scaled by the same factor as the type: a readable
 * measure is a character count, not a pixel width, so a cap frozen at 560px while
 * the text grew 20% would quietly tighten every paragraph and add wrap lines.
 * Text blocks only — structural widths (the modal shell) stay fixed.
 */
const proseW = scaled;

/**
 * The observation protocol. Static, and deliberately so: its whole value is being
 * the same procedure for every child — baseline, then one variable at a time,
 * then hold steady — so that what a parent notices in month three is comparable
 * to month one. Generating it per child would make each parent's notes
 * incomparable to their own earlier notes, which is the one thing this page is
 * for. The copy is parent-facing instruction for a self-directed routine; nothing
 * here claims the app does the prompting.
 */
interface ObservationStep {
  when: string;
  title: string;
  body: string;
  dot: string;
}

interface ObservationSpan {
  label: string;
  tag: string;
  title: string;
  cadence: string;
  steps: ObservationStep[];
}

const SPANS: ObservationSpan[] = [
  {
    label: '1 month',
    tag: 'Get a baseline',
    title: 'Month one: write it down as it happens',
    cadence: 'Two short notes a week',
    steps: [
      {
        when: 'Week 1',
        title: 'Same questions, no changes',
        body: 'Answer as things are. Change nothing yet.',
        dot: 'rgb(var(--constellation-cyan-rgb))',
      },
      {
        when: 'Week 2',
        title: 'Note the setting',
        body: 'Where it happened and what came before.',
        dot: 'rgb(var(--constellation-cyan-rgb))',
      },
      {
        when: 'Week 3',
        title: 'Note the exceptions',
        body: 'The days it did not happen matter too.',
        dot: 'rgb(var(--constellation-gold-rgb))',
      },
      {
        when: 'Week 4',
        title: 'First look back',
        body: 'Your notes side by side, to see what repeated.',
        dot: 'rgb(var(--constellation-gold-rgb))',
      },
    ],
  },
  {
    label: '2 months',
    tag: 'Look for the pattern',
    title: 'Month two: test the pattern against another view',
    cadence: 'Weekly note, one school check-in',
    steps: [
      {
        when: 'Week 5',
        title: 'Bring in a second observer',
        body: 'A teacher or coach answers the same questions.',
        dot: 'rgb(var(--constellation-cyan-rgb))',
      },
      {
        when: 'Week 6',
        title: 'Try one small change',
        body: 'One only. Movement before homework, say.',
        dot: 'rgb(var(--constellation-cyan-rgb))',
      },
      {
        when: 'Week 7',
        title: 'Keep the change steady',
        body: 'Long enough to tell it from a good week.',
        dot: 'rgb(var(--constellation-gold-rgb))',
      },
      {
        when: 'Week 8',
        title: 'Compare the two views',
        body: 'Where both views agree is the sturdiest part.',
        dot: 'rgb(var(--constellation-gold-rgb))',
      },
    ],
  },
  {
    label: '3 months',
    tag: 'Decide the next step',
    title: 'Month three: see the whole picture',
    cadence: 'Fortnightly note, one summary',
    steps: [
      {
        when: 'Week 9',
        title: 'Hold the routine',
        body: 'No new changes. Keep conditions steady.',
        dot: 'rgb(var(--constellation-cyan-rgb))',
      },
      {
        when: 'Week 10',
        title: 'Note what {he} say{s}',
        body: '{His} own words about {his} day, kept verbatim.',
        dot: 'rgb(var(--constellation-cyan-rgb))',
      },
      {
        when: 'Week 11',
        title: 'Build the summary',
        body: 'A one page record of the ninety days.',
        dot: 'rgb(var(--constellation-gold-rgb))',
      },
      {
        when: 'Week 12',
        title: 'Choose what happens next',
        body: 'Keep watching, close the note, or share the page.',
        dot: 'rgb(var(--constellation-gold-rgb))',
      },
    ],
  },
];

/**
 * Product affordances, each mapping to a real feature. Static, but voiced —
 * `{his}`/`{him}` resolve against the child's gender at render time, since these
 * live at module scope where it is not known yet.
 */
const NEXT_STEPS = [
  {
    title: 'Share it with {his} teacher',
    body: 'Makes a school conversation shorter and more specific.',
  },
  {
    title: 'Use it to shape {his} routine',
    body: 'The settings that work for {him} are already in your notes.',
  },
  { title: 'Or simply keep watching', body: 'Many patterns settle on their own as children grow.' },
];

function CheckIcon({ opacity }: { opacity: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgb(var(--constellation-ink-rgb))"
      strokeWidth={3.2}
      style={{ width: 12, height: 12, opacity }}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgb(var(--constellation-slate-dim-rgb))"
      strokeWidth={1.9}
      style={{ width: 15, height: 15, flexShrink: 0, marginTop: 2 }}
    >
      <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgb(var(--constellation-cyan-rgb))"
      strokeWidth={2.2}
      style={{ width: 28, height: 28 }}
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

const SECTION_LABEL: CSSProperties = {
  fontWeight: 700,
  fontSize: fs(14),
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'rgb(var(--constellation-cyan-pale-rgb))',
};

const CARD_SHELL: CSSProperties = {
  borderRadius: 18,
  padding: '20px 21px',
  background: 'rgb(var(--constellation-card-rgb) / .6)',
  border: '1px solid rgb(var(--constellation-cyan-rgb) / .12)',
};

/** Placeholder cards shown while the set generates — same footprint as the real ones. */
function ObservationSkeleton() {
  return (
    <div style={{ ...CARD_SHELL, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 38,
            height: 38,
            flexShrink: 0,
            borderRadius: '50%',
            background: 'rgb(var(--constellation-cyan-rgb) / .07)',
            animation: 'obsShimmer 1.4s ease-in-out infinite',
          }}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div
            style={{
              height: 13,
              width: '62%',
              borderRadius: 5,
              background: 'rgb(var(--constellation-cyan-rgb) / .09)',
              animation: 'obsShimmer 1.4s ease-in-out infinite',
            }}
          />
          <div
            style={{
              height: 9,
              width: '36%',
              borderRadius: 5,
              background: 'rgb(var(--constellation-cyan-rgb) / .06)',
              animation: 'obsShimmer 1.4s ease-in-out .2s infinite',
            }}
          />
        </div>
      </div>
      {[88, 70].map((w, i) => (
        <div
          key={w}
          style={{
            height: 10,
            width: `${w}%`,
            borderRadius: 5,
            background: 'rgb(var(--constellation-cyan-rgb) / .06)',
            animation: `obsShimmer 1.4s ease-in-out ${0.1 * (i + 1)}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

export default function Observations() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [childData, setChildData] = useState<Child | null>(null);
  const [observations, setObservations] = useState<ObservationItem[]>([]);
  const [tracked, setTracked] = useState<string[]>([]);
  const [span, setSpan] = useState(0);
  const [started, setStarted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Release generates the patterns from its own copies of the onboarding answers and
  // the growth areas, and validates them on the server (build plan 7.7).
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  // The first read failing is not a failed generation: its retry re-reads, so it
  // never replaces the stored set (or costs a model call).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Stops polling when the page goes away.
  const abortRef = useUnmountSignal();

  const childName = childData?.name ?? '';
  const childAge = childData?.age == null ? '' : String(childData.age);
  const childGender = childData?.gender ?? '';

  useEffect(() => {
    if (!isGenerating) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [isGenerating, startedAt]);

  /** Shows a stored set: ticks only for ids still on screen, and the saved span. */
  const show = useCallback((doc: { items: unknown; watching: string[]; span: string | null }) => {
    const items = normalizeObservations(doc.items);
    setObservations(items);
    const valid = new Set(items.map((o) => o.id));
    setTracked(doc.watching.filter((id) => valid.has(id)));
    const storedSpan = SPANS.findIndex((s) => s.label === doc.span);
    if (storedSpan >= 0) setSpan(storedSpan);
  }, []);

  /**
   * Generates the patterns (or joins the generation already running) and shows them.
   * A new set clears what was watched: a tick against older cards means nothing.
   */
  const generate = useCallback(async () => {
    if (!childId) return;
    setGenError(null);
    setIsGenerating(true);
    setStartedAt(Date.now());
    setElapsedMs(0);
    try {
      const outcome = await runObservationsGeneration(childId, {
        signal: abortRef.current.signal,
      });
      const doc = await release.get(childId);
      if (outcome === 'completed' && doc.items.length > 0) show(doc);
      else setGenError('Nothing in that set could be shown. Please try again.');
    } catch (err) {
      if (isAbort(err)) return;
      // Nothing to ground patterns in yet: the empty state says so.
      if (err instanceof ApiError && err.code === 'needs_evidence') return;
      console.error('[Observations] Generation failed:', err);
      setGenError(
        httpErrorMessage(err as Error, {
          codeMessages: RELEASE_ERRORS,
          fallback: 'Could not start generating observations. Please try again.',
        }),
      );
    } finally {
      setIsGenerating(false);
    }
  }, [abortRef, childId, show]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [child, doc] = await Promise.all([children.get(childId), release.get(childId)]);
        if (cancelled) return;
        setChildData(child);
        if (doc.items.length > 0) show(doc);
        // None yet, or one still running (another device, a reload mid-run): start or
        // join it. A failed one waits for the parent's "Try again".
        if (doc.status === 'not_started' || doc.status === 'generating') void generate();
        else if (doc.status === 'failed' && doc.items.length === 0)
          setGenError('Something went wrong on our side. Your answers are safe.');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'circle_locked') {
          // Transform isn't done yet: back to the journey.
          void navigate(`/PersonalityJourney/${childId}`, { replace: true });
          return;
        }
        if (err instanceof ApiError && err.code === 'child_not_found') {
          void navigate('/Home', { replace: true });
          return;
        }
        console.error('[Observations] Load failed:', err);
        setLoadError('We could not load this page. Please try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate, show, generate, reloadKey]);

  const reload = useCallback(() => {
    setLoadError(null);
    setIsLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const toggleTracked = (id: string) => {
    setTracked((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const activeSpan = SPANS[span] ?? SPANS[0]!;
  const chosen = useMemo(
    () => observations.filter((o) => tracked.includes(o.id)),
    [observations, tracked],
  );

  const handleStartTracking = useCallback(async () => {
    if (!childId || tracked.length === 0) return;
    setIsSaving(true);
    try {
      // What's watched and for how long; release dates it, and the first one makes
      // Release done (which unlocks Connect).
      await release.watch(childId, tracked, activeSpan.label);
      setStarted(true);
    } catch (err) {
      console.error('[Observations] Failed to save watch list:', err);
      toast.error(
        httpErrorMessage(err as Error, {
          codeMessages: RELEASE_ERRORS,
          fallback: 'Could not save your watch list. Please try again.',
        }),
      );
    } finally {
      setIsSaving(false);
    }
  }, [childId, tracked, activeSpan.label]);

  const generationFailed = genError !== null;
  const progressMessage = jobProgressMessage(elapsedMs, 'observations');

  const trackedLabel =
    observations.length === 0
      ? ''
      : tracked.length === 0
        ? 'Nothing selected yet'
        : `${tracked.length} of ${observations.length} being watched`;
  const startTitle =
    tracked.length === 0
      ? 'Pick at least one observation to watch'
      : `Watch these for ${activeSpan.label}`;
  const startLine =
    tracked.length === 0
      ? 'Tick the ones that match what you see at home.'
      : 'Same few questions, on this rhythm. Every answer dated. Change the list whenever you like.';
  // NOTE: the three-day interval is fixed copy, not a computed date — there is no
  // check-in scheduler behind it yet. It reads as a promise to the parent, so it
  // needs to become a real next-due date when the check-in store lands.
  const startedLine = `${chosen.length} observation${chosen.length === 1 ? ' is' : 's are'} now being watched for ${activeSpan.label}. Your first check-in arrives in three days.`;

  /** A failure card with its retry: a whole-page state, or a banner above stored items. */
  const failureCard = (title: string, message: string, onRetry: () => void) => (
    <div style={{ ...CARD_SHELL, marginTop: 16, textAlign: 'center', padding: '30px 24px' }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: fs(16),
          color: 'rgb(var(--constellation-cyan-pale-rgb))',
        }}
      >
        {title}
      </div>
      <div
        style={{
          margin: '8px auto 0',
          maxWidth: proseW(440),
          fontSize: fs(14),
          fontWeight: 600,
          lineHeight: 1.5,
          color: 'rgb(var(--constellation-slate-light-rgb))',
        }}
      >
        {message}
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          cursor: 'pointer',
          marginTop: 18,
          padding: '11px 26px',
          borderRadius: 999,
          border: '1px solid rgb(var(--constellation-cyan-rgb) / .45)',
          background: 'rgb(var(--constellation-navy-dusk-rgb) / .8)',
          fontWeight: 700,
          fontSize: fs(12.5),
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: 'rgb(var(--constellation-cyan-soft-rgb))',
        }}
        className="font-rajdhani"
      >
        Try again
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'rgb(var(--constellation-navy-deepest-rgb))' }}
      >
        <Spinner
          style={{
            borderColor: 'rgb(var(--constellation-cyan-bright-rgb) / 0.6)',
            borderTopColor: 'transparent',
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="obs-root font-rajdhani"
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at 82% -5%,rgb(var(--constellation-cyan-rgb) / .12),rgb(var(--constellation-navy-deepest-rgb) / 0) 50%),radial-gradient(ellipse at 8% 60%,rgb(var(--constellation-gold-rgb) / .07),rgb(var(--constellation-navy-deepest-rgb) / 0) 45%),rgb(var(--constellation-navy-deepest-rgb))',
        color: 'rgb(var(--constellation-text-frost-rgb))',
      }}
    >
      <style>{`
        /* Three knobs for the whole page: type, content column, card floor.
           The design mockups carry no media queries at all — fixed pixel type at
           every width, only the hero moving via its own clamp(), and the column
           capped at 1120px, which strands ~800px of empty gutter on a 1920 display.
           Scaling all three is a deliberate departure from that, decided after
           seeing the fixed version on a large screen.

           --obs-max and --obs-card-min must move TOGETHER: raising the column alone
           would only add COLUMNS, since auto-fill packs as many minmax floors as
           fit — cards would stay 330px and six of them would reflow into one row.
           Raising the floor with it holds the 3-across shape and spends the extra
           width on the cards themselves. */
        .obs-root { --obs-type-scale: 1; --obs-max: 1120px; --obs-card-min: 330px; }
        /* Type: a flat +20% from the tablet breakpoint up, matching Connect. This
           replaced a 1.08/1.14/1.20 ladder — the ladder kept type in step with the
           column as it widened, but it also meant a 1200px laptop got noticeably
           less lift than a 1900px monitor, which read as inconsistent between the
           two pages. Phones stay at 1: these sizes were drawn against a 1120px
           desktop layout and the smallest labels are already at 10.5px.
           Layout still steps separately at 1440/1800 — see above for why those two
           must move together. */
        @media (min-width: 768px)  { .obs-root { --obs-type-scale: 1.2; } }
        @media (min-width: 1440px) { .obs-root { --obs-max: 1320px; --obs-card-min: 390px; } }
        @media (min-width: 1800px) { .obs-root { --obs-max: 1560px; --obs-card-min: 460px; } }

        /* Copy beside the CTA, which needs to stack before it runs out of room.
           'auto' sizes the button to its content and never yields, so on a narrow
           screen the text column collapsed to ~120px while the button pushed 65px
           straight out through the card's right border. Two columns need roughly
           215px of button + 22px gap + 260px of readable copy, i.e. ~500px of card
           interior — which is a ~640px viewport once page and card padding are
           taken off. Stacking at 700px leaves that a little headroom. */
        .obs-cta { display: grid; grid-template-columns: 1fr auto; gap: 22px; align-items: center; }
        @media (max-width: 700px) {
          .obs-cta { grid-template-columns: 1fr; }
          .obs-cta > button { width: 100%; }
        }
        @keyframes obsFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes obsSwap { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes obsShimmer { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
      `}</style>

      <main
        style={{ maxWidth: 'var(--obs-max, 1120px)', margin: '0 auto', padding: '48px 40px 90px' }}
      >
        {/* Hero */}
        <section style={{ textAlign: 'center', animation: 'obsFadeUp .7s ease both' }}>
          <div
            style={{
              fontWeight: 700,
              letterSpacing: '.4em',
              fontSize: fs(11),
              textTransform: 'uppercase',
              color: 'rgb(var(--constellation-gold-rgb))',
            }}
          >
            {childName || 'Your child'}
            {childAge && ` · Age ${childAge}`} · Observations
          </div>
          <h1
            className="font-orbitron"
            style={{
              margin: '16px auto 0',
              maxWidth: proseW(780),
              fontWeight: 900,
              fontSize: 'calc(clamp(28px,4vw,44px) * var(--obs-type-scale, 1))',
              lineHeight: 1.12,
            }}
          >
            What we have noticed so far
          </h1>
          <p
            style={{
              margin: '16px auto 0',
              maxWidth: proseW(560),
              fontSize: fs(17),
              fontWeight: 600,
              lineHeight: 1.55,
              color: 'rgb(var(--constellation-slate-pale-rgb))',
            }}
          >
            Patterns that came up more than once. Pick the ones to keep an eye on.
          </p>
        </section>

        {/* Observations grid */}
        <section style={{ marginTop: 40, animation: 'obsFadeUp .7s ease .14s both' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div className="font-orbitron" style={SECTION_LABEL}>
              Observations
            </div>
            <div
              style={{
                fontWeight: 700,
                fontSize: fs(11),
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: 'rgb(var(--constellation-slate-rgb))',
              }}
            >
              {isGenerating ? progressMessage : trackedLabel}
            </div>
          </div>

          {isGenerating ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fill,minmax(min(var(--obs-card-min, 330px), 100%),1fr))',
                gap: 14,
                marginTop: 16,
              }}
            >
              {[0, 1, 2].map((i) => (
                <ObservationSkeleton key={i} />
              ))}
            </div>
          ) : loadError ? (
            failureCard('We could not load this page', loadError, reload)
          ) : generationFailed && observations.length === 0 ? (
            failureCard(
              'We could not group your answers just now',
              genError ?? 'Something went wrong on our side. Your answers are safe.',
              () => void generate(),
            )
          ) : observations.length === 0 ? (
            <div
              style={{ ...CARD_SHELL, marginTop: 16, textAlign: 'center', padding: '34px 24px' }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: fs(16),
                  color: 'rgb(var(--constellation-cyan-pale-rgb))',
                }}
              >
                Nothing to group yet
              </div>
              <div
                style={{
                  margin: '8px auto 0',
                  maxWidth: proseW(460),
                  fontSize: fs(14),
                  fontWeight: 600,
                  lineHeight: 1.5,
                  color: 'rgb(var(--constellation-slate-light-rgb))',
                }}
              >
                This page reads back what you have already told us. Answer a Grow area or finish the
                onboarding questions, and the patterns in your answers will appear here.
              </div>
              <button
                type="button"
                onClick={() => void navigate(`/GrowthAreas/${childId ?? ''}`)}
                style={{
                  cursor: 'pointer',
                  marginTop: 18,
                  padding: '11px 26px',
                  borderRadius: 999,
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .45)',
                  background: 'rgb(var(--constellation-navy-dusk-rgb) / .8)',
                  fontWeight: 700,
                  fontSize: fs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--constellation-cyan-soft-rgb))',
                }}
                className="font-rajdhani"
              >
                Go to Grow
              </button>
            </div>
          ) : (
            <>
              {/* A failed regeneration keeps the stored set on screen; the error sits above it. */}
              {generationFailed &&
                failureCard(
                  'We could not group your answers just now',
                  genError ?? 'Something went wrong on our side. Your answers are safe.',
                  () => void generate(),
                )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fill,minmax(min(var(--obs-card-min, 330px), 100%),1fr))',
                  gap: 14,
                  marginTop: 16,
                }}
              >
                {observations.map((obs) => {
                  const on = tracked.includes(obs.id);
                  const provenance = formatObservationSources(obs.sources, childName);
                  return (
                    <div
                      key={obs.id}
                      style={{
                        ...CARD_SHELL,
                        background: on
                          ? 'linear-gradient(150deg,rgb(var(--constellation-navy-soft2-rgb) / .85),rgb(var(--constellation-ink-navy-rgb) / .8))'
                          : 'rgb(var(--constellation-card-rgb) / .6)',
                        border: `1px solid ${on ? 'rgb(var(--constellation-cyan-rgb) / .45)' : 'rgb(var(--constellation-cyan-rgb) / .12)'}`,
                        transition: 'all .22s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 14,
                        }}
                      >
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}
                        >
                          <div
                            style={{
                              width: 38,
                              height: 38,
                              flexShrink: 0,
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background:
                                'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
                              border: '1.5px solid rgb(var(--constellation-gold-rgb) / .5)',
                            }}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="rgb(var(--constellation-gold-rgb))"
                              strokeWidth={1.8}
                              style={{ width: 18, height: 18 }}
                            >
                              <path d={OBSERVATION_ICONS[obs.icon]} />
                            </svg>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: fs(16),
                                color: 'rgb(var(--constellation-cyan-pale-rgb))',
                              }}
                            >
                              {obs.title}
                            </div>
                            <div
                              style={{
                                marginTop: 2,
                                fontWeight: 700,
                                fontSize: fs(10.5),
                                letterSpacing: '.16em',
                                textTransform: 'uppercase',
                                color: 'rgb(var(--constellation-slate-rgb))',
                              }}
                            >
                              {provenance}
                            </div>
                          </div>
                        </div>
                        <div
                          role="checkbox"
                          aria-checked={on}
                          aria-label={on ? `Stop watching ${obs.title}` : `Watch ${obs.title}`}
                          tabIndex={0}
                          onClick={() => toggleTracked(obs.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') toggleTracked(obs.id);
                          }}
                          style={{
                            cursor: 'pointer',
                            flexShrink: 0,
                            width: 22,
                            height: 22,
                            borderRadius: 7,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: `1.5px solid ${on ? 'rgb(var(--constellation-cyan-rgb))' : 'rgb(var(--constellation-ring-faint-rgb) / .4)'}`,
                            background: on ? 'rgb(var(--constellation-cyan-rgb))' : 'transparent',
                            transition: 'all .2s ease',
                          }}
                        >
                          <CheckIcon opacity={on ? 1 : 0} />
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: fs(14.5),
                          fontWeight: 600,
                          lineHeight: 1.5,
                          color: 'rgb(var(--constellation-caption-rgb))',
                        }}
                      >
                        {obs.summary}
                      </div>

                      {/* The parent's own words, presented as the evidence for the
                        pattern above — never model-authored prose. */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {obs.notes.map((note) => (
                          <div
                            key={note}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '14px 1fr',
                              gap: 10,
                              alignItems: 'start',
                            }}
                          >
                            <div
                              style={{
                                width: 5,
                                height: 5,
                                marginTop: 8,
                                marginLeft: 4,
                                borderRadius: '50%',
                                background: 'rgb(var(--constellation-cyan-rgb))',
                              }}
                            />
                            <div
                              style={{
                                fontSize: fs(13.5),
                                fontWeight: 600,
                                lineHeight: 1.45,
                                color: 'rgb(var(--constellation-slate-light-rgb))',
                              }}
                            >
                              {note}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* Watch it over time */}
        <section style={{ marginTop: 52, animation: 'obsFadeUp .7s ease .2s both' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="font-orbitron" style={SECTION_LABEL}>
              A way to watch it over time
            </div>
            <p
              style={{
                margin: '12px auto 0',
                maxWidth: proseW(520),
                fontSize: fs(15.5),
                fontWeight: 600,
                lineHeight: 1.5,
                color: 'rgb(var(--constellation-slate-light-rgb))',
              }}
            >
              Choose how long to watch. Superpower asks the same few questions on a rhythm.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 10,
              marginTop: 22,
              flexWrap: 'wrap',
            }}
          >
            {SPANS.map((s, index) => {
              const selected = span === index;
              return (
                <div
                  key={s.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSpan(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSpan(index);
                  }}
                  style={{
                    cursor: 'pointer',
                    minWidth: 150,
                    textAlign: 'center',
                    borderRadius: 15,
                    padding: '14px 22px',
                    background: selected
                      ? 'linear-gradient(150deg,rgb(var(--constellation-navy-soft2-rgb) / .9),rgb(var(--constellation-ink-navy-rgb) / .85))'
                      : 'rgb(var(--constellation-card-rgb) / .6)',
                    border: `1px solid ${selected ? 'rgb(var(--constellation-gold-rgb) / .55)' : 'rgb(var(--constellation-cyan-rgb) / .14)'}`,
                    transition: 'all .2s ease',
                  }}
                >
                  <div
                    className="font-orbitron"
                    style={{
                      fontWeight: 700,
                      fontSize: fs(17),
                      color: selected
                        ? 'rgb(var(--constellation-cyan-palest-rgb))'
                        : 'rgb(var(--constellation-slate-pale-rgb))',
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontWeight: 600,
                      fontSize: fs(12.5),
                      color: 'rgb(var(--constellation-slate-mid-rgb))',
                    }}
                  >
                    {s.tag}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 22 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSpan.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                style={{
                  borderRadius: 22,
                  padding: '26px 28px',
                  background:
                    'linear-gradient(165deg,rgb(var(--constellation-panel-b-rgb) / .9),rgb(var(--constellation-navy-panel2-rgb) / .9))',
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .18)',
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
                    className="font-orbitron"
                    style={{
                      fontWeight: 900,
                      fontSize: fs(20),
                      color: 'rgb(var(--constellation-cyan-palest-rgb))',
                    }}
                  >
                    {activeSpan.title}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: fs(10.5),
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        color: 'rgb(var(--constellation-slate-rgb))',
                      }}
                    >
                      Check-in rhythm
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontWeight: 700,
                        fontSize: fs(15),
                        color: 'rgb(var(--constellation-gold-rgb))',
                      }}
                    >
                      {activeSpan.cadence}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit,minmax(min(210px, 100%),1fr))',
                    gap: 14,
                    marginTop: 24,
                  }}
                >
                  {activeSpan.steps.map((step) => (
                    <div
                      key={step.when}
                      style={{
                        position: 'relative',
                        borderRadius: 15,
                        padding: '17px 18px',
                        background: 'rgba(6,10,18,.7)',
                        border: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: step.dot,
                            boxShadow: `0 0 10px ${step.dot}`,
                          }}
                        />
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: fs(10.5),
                            letterSpacing: '.18em',
                            textTransform: 'uppercase',
                            color: 'rgb(var(--constellation-slate-mid-rgb))',
                          }}
                        >
                          {step.when}
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          fontWeight: 700,
                          fontSize: fs(15),
                          color: 'rgb(var(--constellation-cyan-pale-rgb))',
                        }}
                      >
                        {fillTemplate(step.title, childName, childGender)}
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: fs(13.5),
                          fontWeight: 600,
                          lineHeight: 1.45,
                          color: 'rgb(var(--constellation-slate-light-rgb))',
                        }}
                      >
                        {fillTemplate(step.body, childName, childGender)}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        {/* Start tracking */}
        {observations.length > 0 && (
          <section style={{ marginTop: 44, animation: 'obsFadeUp .7s ease .26s both' }}>
            <div
              style={{
                borderRadius: 22,
                padding: '26px 28px',
                background: 'linear-gradient(165deg,rgba(10,16,28,.92),rgba(5,8,15,.92))',
                border: '1px solid rgb(var(--constellation-gold-rgb) / .28)',
              }}
            >
              <div className="obs-cta">
                <div>
                  <div
                    className="font-orbitron"
                    style={{
                      fontWeight: 700,
                      fontSize: fs(18),
                      color: 'rgb(var(--constellation-cyan-palest-rgb))',
                    }}
                  >
                    {startTitle}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: fs(15),
                      fontWeight: 600,
                      lineHeight: 1.5,
                      color: 'rgb(var(--constellation-slate-pale-rgb))',
                      maxWidth: proseW(620),
                    }}
                  >
                    {startLine}
                  </div>
                  {chosen.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                      {chosen.map((obs) => (
                        <div
                          key={obs.id}
                          style={{
                            padding: '7px 14px',
                            borderRadius: 999,
                            background: 'rgb(var(--constellation-cyan-rgb) / .08)',
                            border: '1px solid rgb(var(--constellation-cyan-rgb) / .28)',
                            fontWeight: 700,
                            fontSize: fs(12),
                            color: 'rgb(var(--constellation-cyan-soft-rgb))',
                          }}
                        >
                          {obs.title}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleStartTracking()}
                  disabled={tracked.length === 0 || isSaving}
                  style={{
                    cursor: tracked.length === 0 || isSaving ? 'default' : 'pointer',
                    // A pill that breaks across two lines stops reading as a button.
                    whiteSpace: 'nowrap',
                    padding: '15px 34px',
                    borderRadius: 999,
                    border: 'none',
                    background:
                      'linear-gradient(135deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-gold-rgb)))',
                    fontWeight: 700,
                    fontSize: fs(13),
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    color: '#04121a',
                    boxShadow: '0 0 30px rgb(var(--constellation-cyan-rgb) / .3)',
                    opacity: tracked.length === 0 || isSaving ? 0.4 : 1,
                    pointerEvents: tracked.length === 0 || isSaving ? 'none' : 'auto',
                    transition: 'all .2s ease',
                  }}
                >
                  {isSaving ? 'Saving…' : 'Start tracking'}
                </button>
              </div>
            </div>
          </section>
        )}

        <RecentMoods childId={childId} childName={childName} />

        {/* What you can do with this */}
        <section style={{ marginTop: 44, animation: 'obsFadeUp .7s ease .32s both' }}>
          <div className="font-orbitron" style={SECTION_LABEL}>
            What you can do with this
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px, 100%),1fr))',
              gap: 14,
              marginTop: 16,
            }}
          >
            {NEXT_STEPS.map((next) => (
              <div
                key={next.title}
                style={{
                  borderRadius: 16,
                  padding: '19px 20px',
                  background: 'rgb(var(--constellation-card-rgb) / .6)',
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .12)',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: fs(15.5),
                    color: 'rgb(var(--constellation-cyan-pale-rgb))',
                  }}
                >
                  {fillTemplate(next.title, childName, childGender)}
                </div>
                <div
                  style={{
                    marginTop: 7,
                    fontSize: fs(14),
                    fontWeight: 600,
                    lineHeight: 1.5,
                    color: 'rgb(var(--constellation-slate-light-rgb))',
                  }}
                >
                  {fillTemplate(next.body, childName, childGender)}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              maxWidth: proseW(760),
            }}
          >
            <ShieldIcon />
            <div
              style={{
                fontSize: fs(13),
                fontWeight: 600,
                lineHeight: 1.5,
                color: 'rgb(var(--constellation-slate-rgb))',
              }}
            >
              Notes stay in your account and are never shared unless you share them. Superpower
              records what you notice. It draws no conclusions and labels nothing.
            </div>
          </div>
        </section>
      </main>

      {/* Tracking started modal */}
      <AnimatePresence>
        {started && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            role="presentation"
            onClick={() => setStarted(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 26,
              background:
                'radial-gradient(ellipse at 50% 40%,rgb(var(--constellation-overlay-rgb) / .72),rgb(var(--constellation-void-rgb) / .94) 72%)',
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-label="Tracking started"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 520,
                borderRadius: 22,
                padding: '30px 30px 26px',
                textAlign: 'center',
                background:
                  'linear-gradient(165deg,rgb(var(--constellation-panel-b-rgb) / .97),rgb(var(--constellation-navy-panel2-rgb) / .97))',
                border: '1px solid rgb(var(--constellation-cyan-rgb) / .32)',
                boxShadow: '0 30px 90px rgb(var(--constellation-void-deep-rgb) / .8)',
              }}
            >
              <div
                style={{
                  width: 66,
                  height: 66,
                  margin: '0 auto',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgb(var(--constellation-cyan-rgb) / .12)',
                  border: '1.5px solid rgb(var(--constellation-cyan-rgb) / .5)',
                  boxShadow: '0 0 30px rgb(var(--constellation-cyan-rgb) / .22)',
                }}
              >
                <ClockIcon />
              </div>
              <div
                className="font-orbitron"
                style={{
                  marginTop: 18,
                  fontWeight: 700,
                  fontSize: fs(19),
                  color: 'rgb(var(--constellation-cyan-pale-rgb))',
                }}
              >
                Tracking started
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: fs(15),
                  fontWeight: 600,
                  lineHeight: 1.5,
                  color: 'rgb(var(--constellation-slate-pale-rgb))',
                }}
              >
                {startedLine}
              </div>
              <button
                type="button"
                onClick={() => setStarted(false)}
                style={{
                  cursor: 'pointer',
                  marginTop: 22,
                  padding: '12px 30px',
                  borderRadius: 999,
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .45)',
                  background: 'rgb(var(--constellation-navy-dusk-rgb) / .8)',
                  fontWeight: 700,
                  fontSize: fs(12.5),
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--constellation-cyan-soft-rgb))',
                }}
                className="font-rajdhani"
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
