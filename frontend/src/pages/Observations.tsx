import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { useJob, jobProgressMessage } from '@/hooks/useJob';
import Spinner from '@/components/shared/Spinner';
import { NO_QUESTIONNAIRE, buildObservationsPrompt, questionnaireMarkdown } from '@/lib/prompts';
import {
  OBSERVATION_ICONS,
  SELECTABLE_ICON_KEYS,
  formatObservationSources,
  normalizeObservations,
  observationsLlmSchema,
  selectObservations,
  type ObservationItem,
  type ObservationSourceKey,
} from '@/lib/observationsData';
import {
  AREA_QUESTIONS,
  areaById,
  fillTemplate,
  normalizeGeneratedQuestions,
  normalizeGeneratedRounds,
  resolveRounds,
} from '@/lib/growthAreaData';
import type { ChildRecord, CompletedArea, EnqueueJobPayload } from '@/types/api';

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

/**
 * Flattens the parent's answered Grow reflections into prompt context. The
 * questions matter as much as the answers: "Yes, most days" is uninterpretable
 * without the question it answered, and the observation prompt is required to
 * quote the parent rather than paraphrase, so it needs both sides.
 *
 * Falls back to the hardcoded set for areas answered before generated questions
 * existed — the same resolution order GrowthAreas uses for `askedQuestions`.
 */
function buildGrowthAreaContext(
  areas: CompletedArea[],
  childName: string,
  childGender: string,
): string {
  const blocks: string[] = [];
  for (const area of areas) {
    const areaId = typeof area.area_id === 'string' ? area.area_id : '';
    if (!areaId) continue;
    const answers = area.answers ?? {};
    if (Object.keys(answers).length === 0) continue;

    const questions =
      normalizeGeneratedQuestions(area.parent_questions, areaId) ?? AREA_QUESTIONS[areaId] ?? [];
    const pairs = questions
      .filter((q) => answers[q.id])
      .map(
        (q) =>
          `Q: ${fillTemplate(q.question, childName, childGender)}\nA: ${String(answers[q.id])}`,
      );
    // An area whose stored answers key off a question set we no longer have is
    // still the parent's own words — keep them, unlabelled, rather than dropping
    // real evidence because the prompt for it is gone.
    const orphaned =
      pairs.length === 0
        ? Object.values(answers)
            .map((v) => String(v).trim())
            .filter(Boolean)
            .map((v) => `A: ${v}`)
        : [];
    const lines = [...pairs, ...orphaned];
    if (lines.length === 0) continue;

    const areaName =
      (typeof area.area_name === 'string' && area.area_name ? area.area_name : null) ??
      areaById(areaId)?.name ??
      areaId;
    blocks.push(`— ${areaName} —\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/**
 * The child's own contribution: their forced-choice picks from the Grow rounds.
 *
 * Recorded as "chose X over Y" because in a two-option round the rejected side
 * carries half the meaning — "chose building over storytelling" says something
 * "chose building" does not. The prompt is separately instructed never to render
 * these as the child's words, since the child tapped copy we wrote.
 *
 * Picks read from the durable `child_activity.selections` first; the backend
 * clears the transient `child_activity_selections` on completion, so the durable
 * copy is the one that survives for a finished area.
 */
function buildChildActivityContext(
  areas: CompletedArea[],
  childName: string,
  childGender: string,
): { text: string; choiceLines: string[] } {
  const blocks: string[] = [];
  const allLines: string[] = [];
  for (const area of areas) {
    const areaId = typeof area.area_id === 'string' ? area.area_id : '';
    if (!areaId) continue;

    const durable = (area.child_activity as { selections?: unknown } | undefined)?.selections;
    const picks = (
      Array.isArray(durable) ? durable : (area.child_activity_selections ?? [])
    ).filter((id): id is string => typeof id === 'string');
    if (picks.length === 0) continue;

    // resolveRounds picks whichever generation of ids the saved picks belong to,
    // so areas played against the hardcoded rounds still resolve correctly.
    const rounds = resolveRounds(
      areaId,
      normalizeGeneratedRounds(area.child_rounds, areaId),
      picks,
    );
    const lines: string[] = [];
    for (const round of rounds) {
      const chose = picks.includes(round.a.id)
        ? round.a
        : picks.includes(round.b.id)
          ? round.b
          : null;
      if (!chose) continue;
      const over = chose.id === round.a.id ? round.b : round.a;
      // Typographic quotes here so the string the provider echoes back already
      // matches what tidyNote would normalise it to.
      lines.push(
        `Chose “${fillTemplate(chose.text, childName, childGender)}” over ` +
          `“${fillTemplate(over.text, childName, childGender)}”`,
      );
    }
    if (lines.length === 0) continue;
    allLines.push(...lines);

    const areaName =
      (typeof area.area_name === 'string' && area.area_name ? area.area_name : null) ??
      areaById(areaId)?.name ??
      areaId;
    blocks.push(`— ${areaName} —\n${lines.join('\n')}`);
  }
  return { text: blocks.join('\n\n'), choiceLines: allLines };
}

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
  const [childData, setChildData] = useState<ChildRecord | null>(null);
  const [observations, setObservations] = useState<ObservationItem[]>([]);
  const [hasEvidence, setHasEvidence] = useState(false);
  const [tracked, setTracked] = useState<string[]>([]);
  const [span, setSpan] = useState(0);
  const [started, setStarted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /**
   * Generation failures that useJob cannot represent. Two of them exist and both
   * used to strand the page on skeletons forever:
   *   - enqueue throws (network): useJob sets status back to null, so isLoading,
   *     isFailed and isComplete are ALL false and no branch renders an error.
   *   - the job completes but every candidate fails validation: isComplete is
   *     true with observations still empty, which is exactly the condition
   *     isGenerating uses to keep showing skeletons.
   */
  const [genError, setGenError] = useState<string | null>(null);

  const childName = typeof childData?.name === 'string' ? childData.name : '';
  const childAge = childData?.age != null ? String(childData.age) : '';
  const childGender = typeof childData?.gender === 'string' ? childData.gender : '';

  /**
   * The prompt inputs, held in a ref so enqueueing does not depend on render
   * order. Everything here is the parent's own writing — there is no other
   * source of observations today, which is why the page cannot yet claim any
   * pattern recurred (see the source keys in `@/lib/observationsData`).
   */
  const evidenceRef = useRef<{
    questionnaireMd: string;
    growthAreaContext: string;
    childActivityContext: string;
    /** The exact choice lines in the prompt — the whitelist for child notes. */
    childChoiceLines: string[];
    parentConcern: string;
    /** Blocks the prompt will contain, in the order it presents them. */
    availableSources: ObservationSourceKey[];
  } | null>(null);

  const enqueueObservations = useCallback(
    async (enqueue: (payload: EnqueueJobPayload) => Promise<void>) => {
      const evidence = evidenceRef.current;
      if (!childId || !evidence) return;
      setGenError(null);
      await enqueue({
        type: 'generate_observations',
        child_id: childId,
        payload: {
          prompt: buildObservationsPrompt({
            childName: childName || 'the child',
            childAge: childAge || null,
            childGender: childGender || null,
            questionnaireMd: evidence.questionnaireMd,
            growthAreaContext: evidence.growthAreaContext,
            childActivityContext: evidence.childActivityContext,
            parentConcern: evidence.parentConcern,
            iconKeys: SELECTABLE_ICON_KEYS,
          }),
          response_json_schema: observationsLlmSchema(),
        },
        write_back: {
          collection: 'observations',
          filter: {},
          field: 'pending_observations',
        },
      });
    },
    [childId, childName, childAge, childGender],
  );

  /**
   * Promotes the worker's staged output to the canonical field once validated.
   * The watch list is reset here on purpose: a tick the parent made against an
   * older set of cards does not carry a defensible meaning against a new one.
   */
  const finalizeObservations = useCallback(async () => {
    if (!childId) return;
    try {
      const record = await api.observations.get(childId);
      const candidates = normalizeObservations(record?.pending_observations, {
        allowedChoiceNotes: evidenceRef.current?.childChoiceLines ?? [],
      });
      if (candidates.length === 0) {
        setGenError('Nothing in that set could be shown. Please try again.');
        return;
      }
      const { items, unrepresentedSources, dropped } = selectObservations(
        candidates,
        evidenceRef.current?.availableSources ?? [],
      );
      // Neither of these is worth failing the page over, but both are worth
      // knowing about: a silent cap reads as "covered everything" when it did not.
      if (dropped > 0) {
        console.info(
          `[Observations] ${dropped} valid observation(s) cut by the ${items.length}-card display cap.`,
        );
      }
      if (unrepresentedSources.length > 0) {
        console.warn(
          `[Observations] Provider returned no observation citing: ${unrepresentedSources.join(', ')}. ` +
            'Selection can reorder candidates but cannot invent one.',
        );
      }
      setObservations(items);
      setTracked([]);
      // Clearing `watching` is what resets the parent's ticks alongside a fresh
      // set; the PATCH is field-wise now, so it has to be sent explicitly rather
      // than falling out of rewriting the whole field.
      await api.observations.patch(childId, { source: 'llm', items, watching: [] });
    } catch (err) {
      console.error('[Observations] Failed to finalize observations:', err);
      setGenError('Observations could not be saved. Please try again.');
    }
  }, [childId]);

  const job = useJob({
    activeJobs: childData?.active_jobs,
    jobType: 'generate_observations',
    onCompleted: finalizeObservations,
  });
  const { enqueue: jobEnqueue, retry: jobRetry } = job;

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
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          void navigate('/Home', { replace: true });
          return;
        }
        setChildData(child);

        // Neither of these is fatal: an observation set built on the
        // questionnaire alone is still honest, it just cites fewer sources.
        const [goals, completed, stored] = await Promise.all([
          api.goals.get(childId).catch(() => null),
          api.completedGrowthAreas.list(childId).catch(() => null),
          api.observations.get(childId).catch(() => null),
        ]);
        if (cancelled) return;

        const name = typeof child.name === 'string' ? child.name : '';
        const gender = typeof child.gender === 'string' ? child.gender : '';
        const questionnaireRaw = questionnaireMarkdown(child);
        const questionnaireMd = questionnaireRaw === NO_QUESTIONNAIRE ? '' : questionnaireRaw;
        const areas = completed?.areas ?? [];
        const growthAreaContext = buildGrowthAreaContext(areas, name, gender);
        const childActivity = buildChildActivityContext(areas, name, gender);
        const childActivityContext = childActivity.text;
        const parentConcern =
          typeof goals?.parent_concern === 'string' ? goals.parent_concern.trim() : '';

        // Order matters — selectObservations reserves slots in this order, and it
        // must match the order buildObservationsPrompt emits the blocks.
        const availableSources: ObservationSourceKey[] = [];
        if (questionnaireMd) availableSources.push('onboarding');
        if (growthAreaContext) availableSources.push('grow');
        if (childActivityContext) availableSources.push('child');
        if (parentConcern) availableSources.push('concern');

        evidenceRef.current = {
          questionnaireMd,
          growthAreaContext,
          childActivityContext,
          childChoiceLines: childActivity.choiceLines,
          parentConcern,
          availableSources,
        };
        setHasEvidence(availableSources.length > 0);

        const storedItems = normalizeObservations(stored?.items);
        if (storedItems.length > 0) {
          setObservations(storedItems);
          // Ticks are filtered against the ids that survived validation, so a
          // stale id in `watching` cannot select a card that is not on screen.
          const valid = new Set(storedItems.map((o) => o.id));
          setTracked(
            (Array.isArray(stored?.watching) ? stored.watching : []).filter((id) => valid.has(id)),
          );
          const storedSpan = SPANS.findIndex((s) => s.label === stored?.span);
          if (storedSpan >= 0) setSpan(storedSpan);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  // Kick off generation once, and only once there is something to ground it in.
  // A job already in flight (from another device, or a reload mid-run) is picked
  // up by useJob from active_jobs instead — enqueueing again would just burn a
  // second slot on identical input.
  const didEnqueueRef = useRef(false);
  useEffect(() => {
    if (isLoading || didEnqueueRef.current) return;
    if (observations.length > 0 || !hasEvidence) return;
    if (childData?.active_jobs?.generate_observations) return;
    didEnqueueRef.current = true;
    // useJob rethrows so callers can react; without this catch a failed enqueue is
    // an unhandled rejection AND the page falls through to the "nothing to group"
    // empty state, which is wrong — there is evidence, starting the job failed.
    void enqueueObservations(jobEnqueue).catch(() => {
      setGenError('Could not start generating observations. Please try again.');
    });
  }, [isLoading, observations.length, hasEvidence, childData, enqueueObservations, jobEnqueue]);

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
      // Only the three fields the parent actually changed. When this lived as one
      // field on the child document the whole thing had to be rewritten, which
      // meant carrying the generated items along on every tick.
      await api.observations.patch(childId, {
        watching: tracked,
        span: activeSpan.label,
        started_at: new Date().toISOString(),
      });
      setStarted(true);
    } catch (err) {
      console.error('[Observations] Failed to save watch list:', err);
      toast.error('Could not save your watch list. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [childId, tracked, activeSpan.label]);

  // job.isComplete fires before finalizeObservations' write lands, which would
  // otherwise flash the grid from skeletons to the empty state for a beat. The
  // genError term is what lets that window close when finalize fails instead of
  // holding the skeletons up indefinitely.
  const generationFailed = job.isFailed || genError !== null;
  const isGenerating =
    !generationFailed && (job.isLoading || (job.isComplete && observations.length === 0));
  const progressMessage = jobProgressMessage(job.elapsedMs, 'generate_observations');

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
          ) : generationFailed ? (
            <div
              style={{ ...CARD_SHELL, marginTop: 16, textAlign: 'center', padding: '30px 24px' }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: fs(16),
                  color: 'rgb(var(--constellation-cyan-pale-rgb))',
                }}
              >
                We could not group your answers just now
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
                {genError ??
                  job.error ??
                  'Something went wrong on our side. Your answers are safe.'}
              </div>
              <button
                type="button"
                onClick={() =>
                  void enqueueObservations(jobRetry).catch(() => {
                    setGenError('Could not start generating observations. Please try again.');
                  })
                }
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            flexShrink: 0,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
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
                      color: selected ? 'rgb(var(--constellation-cyan-palest-rgb))' : 'rgb(var(--constellation-slate-pale-rgb))',
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{ marginTop: 3, fontWeight: 600, fontSize: fs(12.5), color: 'rgb(var(--constellation-slate-mid-rgb))' }}
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
                  background: 'linear-gradient(165deg,rgb(var(--constellation-panel-b-rgb) / .9),rgb(var(--constellation-navy-panel2-rgb) / .9))',
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
                background: 'linear-gradient(165deg,rgb(var(--constellation-panel-b-rgb) / .97),rgb(var(--constellation-navy-panel2-rgb) / .97))',
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
