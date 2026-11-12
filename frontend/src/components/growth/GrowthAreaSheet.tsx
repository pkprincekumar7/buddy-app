import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { SPINNER } from '@/lib/animations';
import { daysAgo, rankedGames, type WorldSummary } from '@/api/kidWorlds';
import { fillTemplate } from '@/lib/growthAreaData';
import type {
  GrowthArea,
  GrowthRecommendation,
  Question,
  RecommendationSource,
} from '@/lib/growthAreaData';

/**
 * The per-area overlay over the Growth Map, as the prototype has it:
 *
 *   questions → "Guided Reflection": the parent's five free-text reflections
 *   insights  → "Growth insights": what the parent answered and what the child played
 *               in child view (the area's world), and the recommendations from both
 *
 * Two tabs switch between them. An area the parent has answered opens on its insights;
 * one they haven't, on its questions. The answers persist once, on Finish
 * (onSaveAnswers), which moves to the insights; the caller keeps the recommendations
 * current (onShowInsights) and passes them down.
 *
 * The questions are generated per child per area by the caller and arrive as props, with
 * the status of that generation: waiting, unusable (with a retry) or ready.
 */

type Phase = 'questions' | 'insights';
export type RecsPhase = 'idle' | 'loading' | 'ready' | 'error';
/** Generation state of the question set, as reported by the caller's hook. */
export type SetStatus = 'idle' | 'loading' | 'ready' | 'error';

const PANEL_MAX = 620;

const CLOSE_BTN: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 18,
  width: 28,
  height: 28,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  border: '1px solid rgb(var(--constellation-cyan-rgb) / .28)',
  background: 'transparent',
  color: 'rgb(var(--constellation-slate-dark-rgb))',
  transition: 'color .2s ease,border-color .2s ease',
};

const PIP: React.CSSProperties = {
  height: 3,
  flex: 1,
  borderRadius: 2,
  transition: 'background .3s ease',
};

const PILL: React.CSSProperties = {
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  borderRadius: 999,
  fontWeight: 700,
  fontSize: 12.5,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
};

const CTA: React.CSSProperties = {
  border: 'none',
  background:
    'linear-gradient(135deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-cyan-bright-rgb)))',
  color: 'rgb(var(--constellation-navy-rgb))',
  boxShadow: '0 0 24px rgb(var(--constellation-cyan-rgb) / .45)',
};

/** The small cyan caps over a block ("Parent app", "Latest child view result"). */
const EYEBROW: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 9.5,
  letterSpacing: '.28em',
  textTransform: 'uppercase',
  color: 'rgb(var(--constellation-cyan-bright-rgb))',
};

const CARD: React.CSSProperties = {
  borderRadius: 13,
  background:
    'linear-gradient(120deg,rgb(var(--constellation-navy-soft-rgb) / .55),rgb(var(--constellation-ink-navy-rgb) / .55))',
};

const FILLED = 'rgb(var(--constellation-gold-rgb) / .45)';
const UNFILLED = 'rgb(var(--constellation-cyan-rgb) / .16)';

/** A game score's colour: its band's gold / cyan / violet as the page's tokens. */
const BAND_RGB = {
  gold: 'var(--constellation-gold-rgb)',
  cyan: 'var(--constellation-cyan-rgb)',
  violet: 'var(--constellation-lavender-rgb)',
} as const;

/** Each recommendation's tag: its words, colour and border. */
const TAGS: Record<
  RecommendationSource,
  { label: (name: string) => string; color: string; border: string }
> = {
  both: {
    label: (name) => `You + ${name}`,
    color: 'rgb(var(--constellation-gold-rgb))',
    border: 'rgb(var(--constellation-gold-rgb) / .5)',
  },
  kid: {
    label: (name) => `${name}’s games`,
    color: 'rgb(var(--constellation-sky-rgb))',
    border: 'rgb(var(--constellation-cyan-rgb) / .4)',
  },
  you: {
    label: () => 'Your answers',
    color: 'rgb(var(--constellation-lilac-rgb))',
    border: 'rgb(var(--constellation-lilac-rgb) / .45)',
  },
  step: {
    label: () => 'Next step',
    color: 'rgb(var(--constellation-mint-rgb))',
    border: 'rgb(var(--constellation-mint-rgb) / .45)',
  },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Stands in for a question set that is still being written, or could not be.
 *
 * The failure path offers a retry rather than hardcoded questions, on purpose: the
 * value of the set is that it was written for this child from their profile.
 */
function SetGate({
  status,
  progress,
  onRetry,
  waiting,
}: {
  status: SetStatus;
  progress: string;
  onRetry: () => void;
  waiting: string;
}) {
  const failed = status === 'error';
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: 'easeOut' }}
      style={{ marginTop: 30, marginBottom: 14, textAlign: 'center', minHeight: 150 }}
      aria-live="polite"
    >
      {failed ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgb(var(--constellation-gold-rgb))"
          strokeWidth="1.7"
          style={{ width: 30, height: 30, margin: '0 auto' }}
        >
          <path d="M12 8v5M12 16.5v.01M12 3l9 17H3z" />
        </svg>
      ) : (
        <motion.div
          {...SPINNER}
          style={{
            width: 34,
            height: 34,
            margin: '0 auto',
            borderRadius: '50%',
            border: '2px solid rgb(var(--constellation-cyan-rgb) / .28)',
            borderTopColor: 'rgb(var(--constellation-cyan-rgb))',
          }}
        />
      )}
      <div
        className="font-orbitron"
        style={{
          marginTop: 16,
          fontWeight: 500,
          fontSize: 15.5,
          lineHeight: 1.45,
          color: 'rgb(var(--constellation-cyan-pale-rgb))',
        }}
      >
        {failed ? 'We couldn’t write these questions just now.' : waiting}
      </div>
      <div
        style={{
          marginTop: 9,
          fontSize: 13.5,
          fontWeight: 600,
          color: 'rgb(var(--constellation-slate-dark-rgb))',
          maxWidth: 400,
          marginLeft: 'auto',
          marginRight: 'auto',
          minHeight: 20,
        }}
      >
        {failed ? 'Nothing has been lost — give it another go.' : progress}
      </div>
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          style={{ ...PILL, ...CTA, display: 'inline-flex', marginTop: 20, padding: '11px 28px' }}
        >
          Try again
        </button>
      )}
    </motion.div>
  );
}

/** One of the two tabs under the header. */
function Tab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className="flex items-center whitespace-nowrap font-bold uppercase"
      style={{
        gap: 8,
        padding: '8px 16px',
        borderRadius: 999,
        fontSize: 12,
        letterSpacing: '.14em',
        background: on ? 'rgb(var(--constellation-cyan-rgb) / .16)' : 'transparent',
        border: `1px solid ${on ? 'rgb(var(--constellation-cyan-rgb) / .7)' : 'rgb(var(--constellation-cyan-rgb) / .22)'}`,
        color: on
          ? 'rgb(var(--constellation-cyan-pale-rgb))'
          : 'rgb(var(--constellation-slate-dark-rgb))',
        transition: 'all .2s ease',
      }}
    >
      {children}
    </button>
  );
}

/** "Parent app" / "Child view": where the insights come from, gold-edged once there. */
function SourceCard({ label, text, filled }: { label: string; text: string; filled: boolean }) {
  return (
    <div
      style={{
        borderRadius: 13,
        padding: '10px 14px',
        border: `1px solid ${filled ? FILLED : UNFILLED}`,
        background: 'rgb(var(--constellation-ink-navy-rgb) / .55)',
      }}
    >
      <div style={EYEBROW}>{label}</div>
      <div
        style={{
          marginTop: 4,
          fontWeight: 700,
          fontSize: 14,
          color: 'rgb(var(--constellation-cyan-pale-rgb))',
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** The latest run: its total in a ring, its strongest and weakest game, and each game. */
function WorldResult({ world }: { world: WorldSummary }) {
  const order = rankedGames(world.rows.map((r) => r.score));
  const best = world.rows[order[0] ?? 0];
  const weakest = world.rows[order[order.length - 1] ?? 0];
  const up = world.change !== null && world.change > 0;
  const change =
    world.change === null ? '' : ` · ${world.change >= 0 ? '+' : ''}${world.change} vs last try`;
  const deg = `${Math.round(world.total * 3.6)}deg`;

  return (
    <>
      <div className="flex flex-wrap items-center" style={{ gap: 18 }}>
        <div className="relative flex-shrink-0" style={{ width: 92, height: 92 }}>
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(rgb(var(--constellation-cyan-rgb)) 0deg,rgb(var(--constellation-gold-rgb)) ${deg},rgb(var(--constellation-cyan-rgb) / .12) ${deg})`,
            }}
          />
          <div
            className="absolute flex flex-col items-center justify-center rounded-full"
            style={{ inset: 8, background: 'rgb(var(--constellation-badge-b-rgb))' }}
          >
            <div
              className="font-orbitron"
              style={{
                fontWeight: 700,
                fontSize: 26,
                lineHeight: 1,
                color: 'rgb(var(--constellation-cyan-paler-rgb))',
              }}
            >
              {world.total}
            </div>
            <div
              style={{
                marginTop: 2,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: '.18em',
                color: 'rgb(var(--constellation-slate-dark-rgb))',
              }}
            >
              / 100
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ ...EYEBROW, letterSpacing: '.3em' }}>Latest child view result</div>
          <div
            className="font-orbitron"
            style={{
              marginTop: 6,
              fontWeight: 700,
              fontSize: 17,
              color: 'rgb(var(--constellation-cyan-paler-rgb))',
            }}
          >
            Strongest: {best?.skill}. Room to grow: {weakest?.skill}.
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 13.5,
              fontWeight: 600,
              color: up
                ? 'rgb(var(--constellation-mint-rgb))'
                : 'rgb(var(--constellation-slate-dark-rgb))',
            }}
          >
            Played {daysAgo(world.at)} · {plural(world.tries, 'try', 'tries')}
            {change}
          </div>
        </div>
      </div>

      <div className="flex flex-col" style={{ marginTop: 16, gap: 9 }}>
        {world.rows.map((row) => {
          const rgb = BAND_RGB[row.band?.color ?? 'cyan'];
          return (
            <div
              key={row.title}
              style={{
                ...CARD,
                padding: '11px 14px',
                border: '1px solid rgb(var(--constellation-cyan-rgb) / .16)',
              }}
            >
              <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
                <div className="flex min-w-0 flex-col" style={{ gap: 2 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14.5,
                      lineHeight: 1.25,
                      color: 'rgb(var(--constellation-cyan-pale-rgb))',
                    }}
                  >
                    {row.skill}
                  </div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 12.5,
                      lineHeight: 1.25,
                      color: 'rgb(var(--constellation-slate-dark-rgb))',
                    }}
                  >
                    {row.title}
                  </div>
                </div>
                <div
                  className="font-orbitron"
                  style={{ fontWeight: 700, fontSize: 15, color: `rgb(${rgb})` }}
                >
                  {row.score}
                </div>
              </div>
              <div
                aria-hidden="true"
                style={{
                  marginTop: 9,
                  height: 5,
                  borderRadius: 3,
                  overflow: 'hidden',
                  background: 'rgb(var(--constellation-cyan-rgb) / .12)',
                }}
              >
                <div
                  style={{
                    width: `${row.score}%`,
                    height: '100%',
                    borderRadius: 3,
                    background: `linear-gradient(90deg,rgb(var(--constellation-cyan-bright-rgb)),rgb(${rgb}))`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** One numbered recommendation, with its tag. */
function Recommendation({
  rec,
  index,
  childName,
}: {
  rec: GrowthRecommendation;
  index: number;
  childName: string;
}) {
  const tag = rec.source ? TAGS[rec.source] : null;
  return (
    <div
      className="grid items-start transition-[border-color,transform] duration-200 hover:translate-x-0.5 hover:[border-color:rgb(var(--constellation-gold-rgb)_/_.5)]"
      style={{
        ...CARD,
        gridTemplateColumns: '26px 1fr',
        gap: 12,
        padding: '12px 14px',
        border: '1px solid rgb(var(--constellation-gold-rgb) / .18)',
      }}
    >
      <div className="flex flex-col items-center" style={{ gap: 6, paddingTop: 2 }}>
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'rgb(var(--constellation-gold-pale-rgb))',
            boxShadow: '0 0 10px rgb(var(--constellation-gold-rgb) / .9)',
          }}
        />
        <div
          className="font-orbitron"
          style={{
            fontWeight: 700,
            fontSize: 10,
            color: 'rgb(var(--constellation-gold-rgb) / .6)',
          }}
        >
          {String(index + 1).padStart(2, '0')}
        </div>
      </div>
      <div>
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <span
            style={{
              fontWeight: 700,
              fontSize: 14.5,
              lineHeight: 1.35,
              color: 'rgb(var(--constellation-cyan-pale-rgb))',
            }}
          >
            {rec.title}
          </span>
          {tag && (
            <span
              className="whitespace-nowrap font-bold uppercase"
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid ${tag.border}`,
                fontSize: 10,
                letterSpacing: '.14em',
                color: tag.color,
              }}
            >
              {tag.label(childName)}
            </span>
          )}
        </div>
        {rec.detail && (
          <div
            style={{
              marginTop: 3,
              fontWeight: 600,
              fontSize: 13,
              lineHeight: 1.45,
              color: 'rgb(var(--constellation-slate-cool-rgb))',
            }}
          >
            {rec.detail}
          </div>
        )}
      </div>
    </div>
  );
}

interface GrowthAreaSheetProps {
  area: GrowthArea;
  childName: string;
  childGender: string;
  /** The parent's five reflections for this area — data, generation status,
   *  progress note, and retry, grouped since they're one stage's state. */
  parentQuestions: {
    data: Question[] | null;
    status: SetStatus;
    /** Elapsed-time note shown while the reflections generate; '' when there is none. */
    progress?: string;
    onRetry: () => void;
  };
  /** Previously saved answers for this area, used to prefill a redo. */
  initialAnswers?: Record<string, unknown>;
  /** Open on the insights (an answered area) rather than the questions. */
  initialPhase?: Phase;
  /** How many of the area's reflections the parent has saved. */
  answered: number;
  /** The child's latest run of this area's world in child view; null until played. */
  world: WorldSummary | null;
  onClose: () => void;
  /** Resolve true to move to the insights; false keeps the parent on question five. */
  onSaveAnswers: (answers: Record<string, string>) => Promise<boolean>;
  /** Called when the insights are shown from a tab, so the caller can bring the
   *  recommendations up to date. */
  onShowInsights: () => void;
  /** Leaves the sheet for the Life Pathway (Transform) page. */
  onExploreTransform: () => void;
  /** True while the caller's save is in flight. */
  isSaving?: boolean;
  /** Status of the recommendation generation the caller runs. */
  recsPhase?: RecsPhase;
  recommendations?: GrowthRecommendation[];
  onRetryRecommendations: () => void;
}

export default function GrowthAreaSheet({
  area,
  childName,
  childGender,
  parentQuestions,
  initialAnswers,
  initialPhase = 'questions',
  answered,
  world,
  onClose,
  onSaveAnswers,
  onShowInsights,
  onExploreTransform,
  isSaving = false,
  recsPhase = 'idle',
  recommendations = [],
  onRetryRecommendations,
}: GrowthAreaSheetProps) {
  const {
    data: generatedQuestions,
    status: questionsStatus,
    progress: questionsProgress = '',
    onRetry: onRetryQuestions,
  } = parentQuestions;
  const questions: Question[] = generatedQuestions ?? [];

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const who = childName || 'Your child';
  const fill = (text: string) => fillTemplate(text, childName, childGender);

  // Prefill a redo from previously saved answers, keeping only keys belonging to the
  // current question set. An effect, because the questions may arrive after opening;
  // merging means a late set never discards what the parent has typed.
  useEffect(() => {
    if (!generatedQuestions?.length) return;
    const known = new Set(generatedQuestions.map((q) => q.id));
    setAnswers((prev) => {
      const seed: Record<string, string> = {};
      for (const [k, v] of Object.entries(initialAnswers ?? {})) {
        if (known.has(k) && typeof v === 'string' && prev[k] === undefined) seed[k] = v;
      }
      return Object.keys(seed).length > 0 ? { ...prev, ...seed } : prev;
    });
  }, [generatedQuestions, initialAnswers]);

  const currentQuestion = questions[qIdx];
  const isLastQuestion = qIdx >= questions.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus the field on open and on each question change, including when the
  // generated questions land and the field first exists.
  useEffect(() => {
    if (phase === 'questions' && questionsStatus === 'ready') textareaRef.current?.focus();
  }, [qIdx, phase, questionsStatus]);

  const showInsights = useCallback(() => {
    setPhase('insights');
    onShowInsights();
  }, [onShowInsights]);

  const goNext = useCallback(async () => {
    if (isSaving) return;
    if (!isLastQuestion) {
      setQIdx((i) => i + 1);
      return;
    }
    // Only move on once the write has landed: a failed save leaves the parent on
    // question five with their text intact.
    if (await onSaveAnswers(answers)) setPhase('insights');
  }, [isLastQuestion, onSaveAnswers, answers, isSaving]);

  const hasInput = answered > 0 || world !== null;
  const recsFrom =
    answered > 0 && world
      ? `From your answers and ${who}’s games`
      : answered > 0
        ? 'From your answers'
        : `From ${who}’s games`;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${area.name} — ${phase === 'insights' ? 'growth insights' : 'guided reflection'}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        padding: 22,
        background:
          'radial-gradient(ellipse at 50% 40%,rgb(var(--constellation-overlay-rgb) / .72),rgb(var(--constellation-void-rgb) / .93) 70%)',
        backdropFilter: 'blur(7px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full"
        style={{
          maxWidth: PANEL_MAX,
          maxHeight: '100%',
          overflow: 'auto',
          borderRadius: 20,
          padding: '26px 30px 24px',
          background:
            'linear-gradient(165deg,rgb(var(--constellation-navy-panel3-rgb) / .96),rgb(var(--constellation-ink-navy-rgb) / .98))',
          border: '1px solid rgb(var(--constellation-gold-rgb) / .42)',
          boxShadow: '0 26px 70px rgba(0,0,0,.6),0 0 44px rgb(var(--constellation-cyan-rgb) / .12)',
        }}
      >
        <button type="button" aria-label="Close" onClick={onClose} style={CLOSE_BTN}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            style={{ width: 13, height: 13 }}
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="flex items-center gap-3">
          <div
            className="flex flex-shrink-0 items-center justify-center rounded-full"
            style={{
              width: 38,
              height: 38,
              background:
                'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
              border: '1.5px solid rgb(var(--constellation-gold-rgb) / .75)',
              boxShadow: '0 0 22px rgb(var(--constellation-cyan-rgb) / .22)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke={area.iconColor}
              strokeWidth="1.8"
              style={{ width: 19, height: 19 }}
            >
              <path d={area.iconPath} />
            </svg>
          </div>
          <div>
            <div
              className="whitespace-nowrap font-bold uppercase"
              style={{
                letterSpacing: '.34em',
                fontSize: 9.5,
                lineHeight: 1.3,
                color: 'rgb(var(--constellation-cyan-bright-rgb))',
              }}
            >
              {phase === 'insights' ? 'Growth insights' : 'Guided Reflection'}
            </div>
            <div
              className="font-orbitron"
              style={{
                fontWeight: 700,
                fontSize: 17,
                color: 'rgb(var(--constellation-cyan-paler-rgb))',
                marginTop: 3,
              }}
            >
              {area.name}
            </div>
          </div>
        </div>

        <div role="tablist" className="flex flex-wrap" style={{ marginTop: 18, gap: 8 }}>
          <Tab
            on={phase === 'questions'}
            onClick={() => {
              setQIdx(0);
              setPhase('questions');
            }}
          >
            Reflection
          </Tab>
          <Tab on={phase === 'insights'} onClick={showInsights}>
            Recommendations
            {world && (
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'rgb(var(--constellation-gold-rgb))',
                  boxShadow: '0 0 8px rgb(var(--constellation-gold-rgb) / .9)',
                }}
              />
            )}
          </Tab>
        </div>

        {/* ── Growth insights ─────────────────────────────────────────────── */}
        {phase === 'insights' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            style={{ marginTop: 20 }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <SourceCard
                label="Parent app"
                text={
                  answered > 0
                    ? `${answered} of ${questions.length || 5} reflections answered`
                    : 'No reflections yet'
                }
                filled={answered > 0}
              />
              <SourceCard
                label="Child view"
                text={
                  world
                    ? `${plural(world.tries, 'game round', 'game rounds')}, last ${daysAgo(world.at)}`
                    : 'Games not played yet'
                }
                filled={world !== null}
              />
            </div>

            {world ? (
              <WorldResult world={world} />
            ) : (
              <div
                style={{
                  padding: '18px 20px',
                  borderRadius: 16,
                  border: '1px dashed rgb(var(--constellation-cyan-rgb) / .3)',
                  textAlign: 'center',
                }}
              >
                <div
                  className="font-orbitron"
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'rgb(var(--constellation-cyan-paler-rgb))',
                  }}
                >
                  {answered > 0 ? `${who}’s side is missing` : 'Nothing to go on yet'}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 14.5,
                    fontWeight: 600,
                    lineHeight: 1.45,
                    color: 'rgb(var(--constellation-slate-soft-rgb))',
                  }}
                >
                  {answered > 0
                    ? `${who} hasn’t played the ${area.name} games in child view yet. For now, these recommendations use your answers only.`
                    : `Answer the reflection questions here and ask ${who} to play the ${area.name} games in child view. Recommendations will appear once either is done.`}
                </div>
              </div>
            )}

            {hasInput && (
              <div
                style={{
                  marginTop: 18,
                  borderTop: '1px solid rgb(var(--constellation-gold-rgb) / .22)',
                  paddingTop: 18,
                }}
              >
                <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 14 }}>
                  <div
                    className="font-orbitron font-bold uppercase"
                    style={{
                      fontSize: 13.5,
                      letterSpacing: '.14em',
                      color: 'rgb(var(--constellation-gold-rgb))',
                    }}
                  >
                    Recommendations
                  </div>
                  <div
                    className="font-semibold uppercase"
                    style={{
                      fontSize: 10.5,
                      letterSpacing: '.14em',
                      color: 'rgb(var(--constellation-slate-rgb))',
                    }}
                  >
                    {recsFrom}
                  </div>
                </div>

                <div className="flex flex-col" style={{ gap: 9, marginTop: 14 }} aria-live="polite">
                  {(recsPhase === 'loading' || recsPhase === 'idle') && (
                    <div className="flex flex-col items-center gap-3 py-6">
                      <motion.div
                        {...SPINNER}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          border: '2px solid rgb(var(--constellation-gold-rgb) / .2)',
                          borderTopColor: 'rgb(var(--constellation-gold-rgb))',
                        }}
                      />
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: 'rgb(var(--constellation-slate-soft-rgb))',
                        }}
                      >
                        {fill('Writing recommendations for {name}…')}
                      </div>
                    </div>
                  )}

                  {recsPhase === 'error' && (
                    <div
                      className="flex flex-col items-center"
                      style={{ gap: 12, padding: '8px 0' }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'rgb(var(--constellation-slate-soft-rgb))',
                        }}
                      >
                        We couldn’t write the recommendations just now.
                      </div>
                      <button
                        type="button"
                        onClick={onRetryRecommendations}
                        style={{ ...PILL, ...CTA, padding: '10px 24px' }}
                      >
                        Try again
                      </button>
                    </div>
                  )}

                  {recsPhase === 'ready' &&
                    recommendations.map((rec, i) => (
                      <Recommendation key={i} rec={rec} index={i} childName={who} />
                    ))}
                </div>
              </div>
            )}

            <div
              className="flex flex-wrap items-center justify-center"
              style={{ gap: 12, marginTop: 18 }}
            >
              <button
                type="button"
                onClick={onClose}
                style={{ ...PILL, ...CTA, padding: '11px 26px' }}
              >
                Done
              </button>
              <button
                type="button"
                onClick={onExploreTransform}
                style={{
                  ...PILL,
                  padding: '11px 22px',
                  background: 'rgb(var(--constellation-navy-deep-rgb) / .9)',
                  border: '1px solid rgb(var(--constellation-gold-rgb) / .5)',
                  color: 'rgb(var(--constellation-gold-pale-rgb))',
                }}
              >
                Explore Transform
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  style={{ width: 14, height: 14 }}
                >
                  <path d="M5 12h13M12 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Guided Reflection: the parent's five reflections ─────────────── */}
        {phase === 'questions' && questionsStatus !== 'ready' && (
          <SetGate
            status={questionsStatus}
            progress={questionsProgress}
            onRetry={onRetryQuestions}
            waiting={fill('Writing questions about {name}…')}
          />
        )}

        {phase === 'questions' && questionsStatus === 'ready' && currentQuestion && (
          <>
            <div className="flex items-center" style={{ gap: 7, marginTop: 20 }}>
              {questions.map((q, i) => (
                <div
                  key={q.id}
                  style={{
                    ...PIP,
                    background:
                      i === qIdx
                        ? 'linear-gradient(90deg,rgb(var(--constellation-cyan-rgb)),rgb(var(--constellation-cyan-bright-rgb)))'
                        : i < qIdx
                          ? 'rgb(var(--constellation-gold-rgb) / .7)'
                          : 'rgb(var(--constellation-cyan-rgb) / .16)',
                  }}
                />
              ))}
              <div
                className="whitespace-nowrap font-bold"
                style={{
                  fontSize: 11,
                  letterSpacing: '.16em',
                  color: 'rgb(var(--constellation-slate-dark-rgb))',
                  marginLeft: 6,
                }}
              >
                {qIdx + 1} / {questions.length}
              </div>
            </div>

            <div style={{ marginTop: 22, minHeight: 150 }}>
              <motion.div
                key={qIdx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, ease: 'easeOut' }}
                className="flex"
                style={{ gap: 14 }}
              >
                <div
                  className="flex-shrink-0 font-orbitron"
                  style={{
                    fontWeight: 700,
                    fontSize: 26,
                    lineHeight: 1,
                    color: 'rgb(var(--constellation-gold-rgb) / .55)',
                  }}
                >
                  {String(qIdx + 1).padStart(2, '0')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="font-orbitron"
                    style={{
                      fontWeight: 500,
                      fontSize: 17,
                      lineHeight: 1.45,
                      color: 'rgb(var(--constellation-cyan-pale-rgb))',
                    }}
                  >
                    {fill(currentQuestion.question)}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-dark-rgb))',
                    }}
                  >
                    {fill(currentQuestion.hint)}
                  </div>
                  <TextareaWithVoice
                    ref={textareaRef}
                    value={answers[currentQuestion.id] ?? ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [currentQuestion.id]: e.target.value }))
                    }
                    placeholder="Type your thoughts…"
                    rows={3}
                    style={{
                      marginTop: 14,
                      width: '100%',
                      resize: 'none',
                      borderRadius: 12,
                      padding: '12px 14px',
                      paddingRight: 44,
                      background: 'rgb(var(--constellation-surface-rgb) / .85)',
                      border: '1px solid rgb(var(--constellation-cyan-rgb) / .24)',
                      outline: 'none',
                      fontWeight: 600,
                      fontSize: 15,
                      lineHeight: 1.5,
                      color: 'rgb(var(--constellation-cyan-pale-rgb))',
                    }}
                  />
                </div>
              </motion.div>
            </div>

            <div className="flex items-center justify-between" style={{ gap: 12, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setQIdx((i) => Math.max(0, i - 1))}
                style={{
                  ...PILL,
                  padding: '10px 20px',
                  background: 'rgb(var(--constellation-overlay-rgb) / .85)',
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .28)',
                  color: 'rgb(var(--constellation-slate-soft-rgb))',
                  opacity: qIdx === 0 ? 0.35 : 1,
                  pointerEvents: qIdx === 0 ? 'none' : 'auto',
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  style={{ width: 13, height: 13 }}
                >
                  <path d="M14 6l-6 6 6 6" />
                </svg>
                Back
              </button>
              <button
                type="button"
                onClick={() => void goNext()}
                disabled={isSaving}
                style={{
                  ...PILL,
                  ...CTA,
                  gap: 9,
                  padding: '11px 26px',
                  opacity: isSaving ? 0.6 : 1,
                  cursor: isSaving ? 'default' : 'pointer',
                }}
              >
                {isSaving ? 'Saving…' : isLastQuestion ? 'Finish' : 'Next'}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  style={{ width: 13, height: 13 }}
                >
                  <path d="M10 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
