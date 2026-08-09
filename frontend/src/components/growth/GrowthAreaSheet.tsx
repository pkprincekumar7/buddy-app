import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AREA_GAMES,
  AREA_QUESTIONS,
  GAME_ROUNDS_PER_AREA,
  fillTemplate,
  pickedOptions,
  topArchetype,
} from '@/lib/growthAreaData';
import type {
  GameOption,
  GameRound,
  GrowthArea,
  GrowthRecommendation,
  Question,
} from '@/lib/growthAreaData';

/**
 * The whole per-area flow, as one overlay over the Growth Map:
 *
 *   questions → the parent's five free-text reflections
 *   handoff   → the "hand the screen over" beat
 *   rounds    → the child's six either/or choices
 *   result    → constellation + recommendations
 *
 * Nothing is written per step. The parent's answers persist once, when they hit
 * Finish (onSaveAnswers); the child's picks persist once, after round six
 * (onCompleteRounds) — which also kicks off recommendation generation in the
 * caller. The archetype and constellation render instantly off the picks alone
 * (no network needed); recsPhase/recommendations stream in afterwards as that
 * generation progresses. Closing the sheet mid-run discards the current step,
 * matching the source design — except mid-round, where it would strand the
 * child half-way through their six choices.
 */

type Phase = 'questions' | 'handoff' | 'rounds' | 'result';
export type RecsPhase = 'idle' | 'loading' | 'ready' | 'error';

const PANEL_MAX = 620;
const ORBITRON = 'Orbitron, sans-serif';

/** Star, shown on the handoff beat. */
const HANDOFF_STAR_PATH = 'M12 3l2.2 5.6L20 9.4l-4 4 1 6-5-2.9-5 2.9 1-6-4-4 5.8-.8z';

/** Constellation node positions (percent of the 560×132 result-panel area) and
 * the path connecting them, in the same order as the child's six picks. */
const CONSTELLATION_PATH = 'M40 84 L142 46 L244 66 L316 34 L418 60 L520 30';
const CONSTELLATION_STARS = [
  { left: 7.1, top: 64.6 },
  { left: 25.4, top: 35.4 },
  { left: 43.6, top: 50.8 },
  { left: 56.4, top: 26.2 },
  { left: 74.6, top: 46.2 },
  { left: 92.9, top: 23.1 },
];

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
  border: '1px solid rgba(75,233,255,.28)',
  background: 'transparent',
  color: '#84a0b2',
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
  background: 'linear-gradient(135deg,#4be9ff,#1ec4e8)',
  color: '#05131a',
  boxShadow: '0 0 24px rgba(75,233,255,.45)',
};

const CHOICE_TILE: React.CSSProperties = {
  cursor: 'pointer',
  borderRadius: 16,
  padding: '18px 16px',
  background: 'linear-gradient(160deg,rgba(30,45,72,.9),rgba(8,13,24,.9))',
  border: '1px solid rgba(75,233,255,.26)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  textAlign: 'center',
  transition: 'border-color .2s ease,box-shadow .2s ease',
};

// Marks the option that occupied this round on the previous run — shown on a
// Play Again replay (or a completed area opened straight into its result and
// then replayed) so it reads as "here's what was picked, change it if you
// like" rather than a blank round with no memory of the earlier answer.
const CHOICE_TILE_PICKED: React.CSSProperties = {
  ...CHOICE_TILE,
  border: '1px solid rgba(240,201,138,.85)',
  boxShadow: '0 0 0 1px rgba(240,201,138,.35),0 0 22px rgba(240,201,138,.25)',
};

interface GrowthAreaSheetProps {
  area: GrowthArea;
  childName: string;
  childGender: string;
  /** Previously saved answers for this area, used to prefill a redo. */
  initialAnswers?: Record<string, unknown>;
  /** Mount straight into the result view for an already-finished area, skipping
   *  the questions/handoff/rounds entirely. Requires initialPicks. */
  initialPhase?: Phase;
  /** The picks a completed area's result was generated from — only meaningful
   *  together with initialPhase="result"; ignored otherwise. */
  initialPicks?: string[];
  onClose: () => void;
  /** Resolve true to advance to the handoff; false keeps the parent on question five. */
  onSaveAnswers: (answers: Record<string, string>) => Promise<boolean>;
  /** Called once, with the six chosen option ids, after the last round (and again
   *  after any Play Again replay). The sheet moves to the result phase itself —
   *  this only needs to persist the picks and start recommendation generation. */
  onCompleteRounds: (pickedIds: string[]) => void;
  /** True while either of the caller's writes is in flight. */
  isSaving?: boolean;
  /** Status of the recommendation generation the caller kicked off. */
  recsPhase?: RecsPhase;
  recommendations?: GrowthRecommendation[];
}

export default function GrowthAreaSheet({
  area,
  childName,
  childGender,
  initialAnswers,
  initialPhase = 'questions',
  initialPicks,
  onClose,
  onSaveAnswers,
  onCompleteRounds,
  isSaving = false,
  recsPhase = 'idle',
  recommendations = [],
}: GrowthAreaSheetProps) {
  const questions: Question[] = useMemo(() => AREA_QUESTIONS[area.id] ?? [], [area.id]);
  const rounds: GameRound[] = useMemo(() => AREA_GAMES[area.id] ?? [], [area.id]);

  if (import.meta.env.DEV && rounds.length !== GAME_ROUNDS_PER_AREA) {
    // The handoff copy promises "Six quick choices"; shout in dev if the data
    // ever stops matching that promise.
    console.warn(
      `[GrowthAreaSheet] ${area.id} has ${rounds.length} rounds but the handoff copy says ${GAME_ROUNDS_PER_AREA}.`,
    );
  }

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [qIdx, setQIdx] = useState(0);
  const [rIdx, setRIdx] = useState(0);
  const [picks, setPicks] = useState<string[]>(
    initialPhase === 'result' ? (initialPicks ?? []) : [],
  );
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    // Keep only keys belonging to the current question set — a document written
    // before the redesign holds ids that no longer exist.
    const known = new Set(questions.map((q) => q.id));
    const seed: Record<string, string> = {};
    for (const [k, v] of Object.entries(initialAnswers ?? {})) {
      if (known.has(k) && typeof v === 'string') seed[k] = v;
    }
    return seed;
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const currentQuestion = questions[qIdx];
  const currentRound = rounds[rIdx];
  const isLastQuestion = qIdx >= questions.length - 1;

  // Escape closes, matching the ✕ affordance — but not once the child is
  // answering, where a stray key press would throw away their run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'rounds') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  // Move focus into the field on open and on each question change.
  useEffect(() => {
    if (phase === 'questions') textareaRef.current?.focus();
  }, [qIdx, phase]);

  const goNext = useCallback(async () => {
    if (isSaving) return;
    if (!isLastQuestion) {
      setQIdx((i) => i + 1);
      return;
    }
    // Only advance once the single write has landed — a failed save leaves the
    // parent on question five with their text intact.
    const saved = await onSaveAnswers(answers);
    if (saved) setPhase('handoff');
  }, [isLastQuestion, onSaveAnswers, answers, isSaving]);

  const choose = useCallback(
    (option: GameOption) => {
      if (isSaving) return;
      // Assign by index rather than appending — on a fresh run this builds the
      // array up exactly like append did (rIdx always equals the current
      // length), but on a Play Again replay it overwrites the previous run's
      // pick at this round in place, leaving rounds not yet reached still
      // showing their old value (so they stay pre-highlighted until visited).
      const next = [...picks];
      next[rIdx] = option.id;
      setPicks(next);
      if (rIdx >= rounds.length - 1) {
        // The archetype and constellation are derived from `next` alone, so the
        // result view renders immediately — recommendations catch up via props.
        setPhase('result');
        onCompleteRounds(next);
      } else {
        setRIdx((i) => i + 1);
      }
    },
    [picks, rIdx, rounds.length, onCompleteRounds, isSaving],
  );

  const playAgain = useCallback(() => {
    setRIdx(0);
    // Deliberately keep `picks` as-is — each round now pre-highlights what was
    // chosen last time (see the tile rendering below), matching how the parent
    // questions prefill on a redo. `choose` overwrites in place as rounds are
    // revisited, so this is just the starting point, not a lock-in.
    setPhase('rounds');
  }, []);

  const archetype = useMemo(
    () => topArchetype(area.id, picks)?.archetype ?? null,
    [area.id, picks],
  );
  const pickedStars = useMemo(
    () => pickedOptions(area.id, picks).map((o) => o.star),
    [area.id, picks],
  );

  const dismissable = phase !== 'rounds';

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${area.name} — guided reflection`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        padding: 22,
        background: 'radial-gradient(ellipse at 50% 40%,rgba(8,14,26,.72),rgba(2,3,9,.93) 70%)',
        backdropFilter: 'blur(7px)',
      }}
      onClick={(e) => {
        // Backdrop dismiss, except mid-round where it would discard the child's run.
        if (e.target === e.currentTarget && dismissable) onClose();
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
          background: 'linear-gradient(165deg,rgba(20,31,50,.96),rgba(8,13,24,.98))',
          border: '1px solid rgba(240,201,138,.42)',
          boxShadow: '0 26px 70px rgba(0,0,0,.6),0 0 44px rgba(75,233,255,.12)',
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

        {/* Area header — persists across the first three phases; the result
            phase replaces it with the constellation label instead. */}
        {phase !== 'result' && (
          <div className="flex items-center gap-3">
            <div
              className="flex flex-shrink-0 items-center justify-center rounded-full"
              style={{
                width: 38,
                height: 38,
                background: 'linear-gradient(150deg,#1c2b46,#0a1220)',
                border: '1.5px solid rgba(240,201,138,.75)',
                boxShadow: '0 0 22px rgba(75,233,255,.22)',
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
                className="font-bold uppercase"
                style={{ letterSpacing: '.34em', fontSize: 9.5, color: '#1ec4e8' }}
              >
                Guided Reflection
              </div>
              <div
                style={{
                  fontFamily: ORBITRON,
                  fontWeight: 700,
                  fontSize: 17,
                  color: '#f2fdff',
                  marginTop: 3,
                }}
              >
                {area.name}
              </div>
            </div>
          </div>
        )}

        {/* ── Phase: the parent's five reflections ────────────────────────── */}
        {phase === 'questions' && currentQuestion && (
          <>
            <div className="flex items-center" style={{ gap: 7, marginTop: 20 }}>
              {questions.map((q, i) => (
                <div
                  key={q.id}
                  style={{
                    ...PIP,
                    background:
                      i === qIdx
                        ? 'linear-gradient(90deg,#4be9ff,#1ec4e8)'
                        : i < qIdx
                          ? 'rgba(240,201,138,.7)'
                          : 'rgba(75,233,255,.16)',
                  }}
                />
              ))}
              <div
                className="whitespace-nowrap font-bold"
                style={{ fontSize: 11, letterSpacing: '.16em', color: '#84a0b2', marginLeft: 6 }}
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
                  className="flex-shrink-0"
                  style={{
                    fontFamily: ORBITRON,
                    fontWeight: 700,
                    fontSize: 26,
                    lineHeight: 1,
                    color: 'rgba(240,201,138,.55)',
                  }}
                >
                  {String(qIdx + 1).padStart(2, '0')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: ORBITRON,
                      fontWeight: 500,
                      fontSize: 17,
                      lineHeight: 1.45,
                      color: '#eafdff',
                    }}
                  >
                    {fillTemplate(currentQuestion.question, childName, childGender)}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13.5, fontWeight: 600, color: '#84a0b2' }}>
                    {fillTemplate(currentQuestion.hint, childName, childGender)}
                  </div>
                  <textarea
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
                      background: 'rgba(5,9,18,.85)',
                      border: '1px solid rgba(75,233,255,.24)',
                      outline: 'none',
                      fontWeight: 600,
                      fontSize: 15,
                      lineHeight: 1.5,
                      color: '#eafdff',
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
                  background: 'rgba(8,14,26,.85)',
                  border: '1px solid rgba(75,233,255,.28)',
                  color: '#9db4c4',
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

        {/* ── Phase: hand the device to the child ─────────────────────────── */}
        {phase === 'handoff' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            style={{ marginTop: 26, textAlign: 'center' }}
          >
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 64,
                height: 64,
                margin: '0 auto',
                background: 'linear-gradient(150deg,#1c2b46,#0a1220)',
                border: '1.5px solid rgba(240,201,138,.75)',
                boxShadow: '0 0 30px rgba(75,233,255,.28)',
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f0c98a"
                strokeWidth="1.7"
                style={{ width: 28, height: 28 }}
              >
                <path d={HANDOFF_STAR_PATH} />
              </svg>
            </div>
            <div
              style={{
                marginTop: 16,
                fontFamily: ORBITRON,
                fontWeight: 700,
                fontSize: 18,
                color: '#f2fdff',
              }}
            >
              {fillTemplate('Thank you. Now {name}’s turn.', childName, childGender)}
            </div>
            <div
              style={{
                marginTop: 9,
                fontSize: 14.5,
                fontWeight: 600,
                color: '#9db4c4',
                maxWidth: 400,
                marginLeft: 'auto',
                marginRight: 'auto',
              }}
            >
              {fillTemplate(
                // Spelled out, as the design has it — the round count is fixed by
                // AREA_GAMES, asserted below so the copy can't drift from the data.
                `Hand the screen to {name}. Six quick choices, then {his} ${area.name} constellation appears.`,
                childName,
                childGender,
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setRIdx(0);
                setPicks([]);
                setPhase('rounds');
              }}
              style={{
                ...PILL,
                ...CTA,
                display: 'inline-flex',
                marginTop: 20,
                padding: '12px 30px',
                fontSize: 13,
              }}
            >
              I’m ready
            </button>
          </motion.div>
        )}

        {/* ── Phase: the child's six either/or rounds ─────────────────────── */}
        {phase === 'rounds' && currentRound && (
          <motion.div
            key={rIdx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: 'easeOut' }}
            style={{ marginTop: 22 }}
          >
            <div className="flex items-baseline justify-between">
              <div
                style={{ fontFamily: ORBITRON, fontWeight: 500, fontSize: 16, color: '#eafdff' }}
              >
                Which would you rather do?
              </div>
              <div
                className="whitespace-nowrap font-bold"
                style={{ fontSize: 11, letterSpacing: '.16em', color: '#84a0b2' }}
              >
                Round {rIdx + 1} of {rounds.length}
              </div>
            </div>

            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}
            >
              {[currentRound.a, currentRound.b].map((option, side) => {
                const wasPickedLastTime = picks[rIdx] === option.id;
                return (
                  <motion.button
                    key={option.id}
                    type="button"
                    onClick={() => choose(option)}
                    disabled={isSaving}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.98 }}
                    style={wasPickedLastTime ? CHOICE_TILE_PICKED : CHOICE_TILE}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={side === 0 ? '#4be9ff' : '#f0c98a'}
                      strokeWidth="1.7"
                      style={{ width: 30, height: 30 }}
                    >
                      <path d={option.icon} />
                    </svg>
                    <div
                      style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.4, color: '#eafdff' }}
                    >
                      {option.text}
                    </div>
                    {wasPickedLastTime && (
                      <div
                        className="whitespace-nowrap font-bold uppercase"
                        style={{
                          fontSize: 9.5,
                          letterSpacing: '.12em',
                          color: 'rgba(240,201,138,.9)',
                        }}
                      >
                        Picked last time
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── Phase: constellation + recommendations ──────────────────────── */}
        {phase === 'result' && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            style={{ marginTop: 4, textAlign: 'center' }}
          >
            <div
              className="font-bold uppercase"
              style={{ letterSpacing: '.3em', fontSize: 9.5, color: '#1ec4e8' }}
            >
              {fillTemplate('{name}’s ' + area.name + ' Constellation', childName, childGender)}
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: ORBITRON,
                fontWeight: 700,
                fontSize: 22,
                color: '#f2fdff',
              }}
            >
              {archetype?.title ?? ''}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 14.5,
                fontWeight: 600,
                color: '#9db4c4',
                maxWidth: 430,
                margin: '8px auto 0',
              }}
            >
              {archetype ? fillTemplate(archetype.line, childName, childGender) : ''}
            </div>

            <div style={{ position: 'relative', height: 132, marginTop: 6 }}>
              <svg
                viewBox="0 0 560 130"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                <path
                  d={CONSTELLATION_PATH}
                  fill="none"
                  stroke="rgba(240,201,138,.35)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {CONSTELLATION_STARS.map((pos, i) => (
                <div
                  key={i}
                  className="absolute flex flex-col items-center"
                  style={{
                    left: `${pos.left}%`,
                    top: `${pos.top}%`,
                    transform: 'translate(-50%,-50%)',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: '50%',
                      background: '#f5e6c4',
                      boxShadow: '0 0 14px rgba(240,201,138,.9)',
                    }}
                  />
                  <div
                    className="whitespace-nowrap font-bold"
                    style={{ fontSize: 11, letterSpacing: '.06em', color: '#cfe9f2' }}
                  >
                    {pickedStars[i] ?? ''}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 4,
                textAlign: 'left',
                borderTop: '1px solid rgba(240,201,138,.22)',
                paddingTop: 18,
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 14 }}>
                <div
                  className="font-bold uppercase"
                  style={{
                    fontFamily: ORBITRON,
                    fontSize: 13.5,
                    letterSpacing: '.14em',
                    color: '#f0c98a',
                  }}
                >
                  Recommendations
                </div>
                <div
                  className="font-semibold uppercase"
                  style={{ fontSize: 10.5, letterSpacing: '.14em', color: '#6f8a9c' }}
                >
                  {fillTemplate(
                    'From your five answers and {name}’s six choices',
                    childName,
                    childGender,
                  )}
                </div>
              </div>

              <div className="flex flex-col" style={{ gap: 9, marginTop: 14 }}>
                {recsPhase === 'loading' && (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <div className="relative h-10 w-10">
                      <div className="absolute inset-0 rounded-full border-[3px] border-[rgba(240,201,138,.2)]" />
                      <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-[#f0c98a]" />
                    </div>
                    <div
                      className="text-center"
                      style={{ fontSize: 12.5, fontWeight: 600, color: '#9db4c4' }}
                    >
                      {fillTemplate('Building {his} 3-month plan…', childName, childGender)}
                    </div>
                  </div>
                )}

                {recsPhase === 'error' && (
                  <div
                    className="text-center"
                    style={{ fontSize: 13, fontWeight: 600, color: '#9db4c4', padding: '12px 0' }}
                  >
                    Could not generate recommendations. Play again to retry.
                  </div>
                )}

                {recsPhase === 'ready' &&
                  (recommendations.length > 0 ? (
                    recommendations.map((rec, i) => (
                      <div
                        key={i}
                        className="grid items-start"
                        style={{
                          gridTemplateColumns: '26px 1fr',
                          gap: 12,
                          borderRadius: 13,
                          padding: '12px 14px',
                          background:
                            'linear-gradient(120deg,rgba(30,45,72,.55),rgba(8,13,24,.55))',
                          border: '1px solid rgba(240,201,138,.18)',
                        }}
                      >
                        <div
                          className="flex flex-col items-center"
                          style={{ gap: 6, paddingTop: 2 }}
                        >
                          <div
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: '#f5e6c4',
                              boxShadow: '0 0 10px rgba(240,201,138,.9)',
                            }}
                          />
                          <div
                            style={{
                              fontFamily: ORBITRON,
                              fontWeight: 700,
                              fontSize: 10,
                              color: 'rgba(240,201,138,.6)',
                            }}
                          >
                            {String(i + 1).padStart(2, '0')}
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 14.5,
                              lineHeight: 1.35,
                              color: '#eafdff',
                            }}
                          >
                            {rec.title}
                          </div>
                          {rec.detail && (
                            <div
                              style={{
                                marginTop: 3,
                                fontWeight: 600,
                                fontSize: 13,
                                lineHeight: 1.45,
                                color: '#93aebe',
                              }}
                            >
                              {rec.detail}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div
                      className="text-center"
                      style={{ fontSize: 13, fontWeight: 600, color: '#9db4c4', padding: '12px 0' }}
                    >
                      No recommendations generated for this area yet.
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex items-center justify-center" style={{ gap: 12, marginTop: 18 }}>
              <button
                type="button"
                onClick={playAgain}
                style={{
                  ...PILL,
                  padding: '10px 22px',
                  background: 'rgba(8,14,26,.85)',
                  border: '1px solid rgba(255,201,120,.35)',
                  color: '#ffc978',
                }}
              >
                Play again
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{ ...PILL, ...CTA, padding: '11px 26px' }}
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
