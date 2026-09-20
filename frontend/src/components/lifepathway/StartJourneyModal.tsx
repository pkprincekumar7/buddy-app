import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fillTemplate } from '@/lib/growthAreaData';
import {
  readInterest,
  getPlan,
  buildPlanMonths,
  mergeTrackSteps,
  TRACK,
} from '@/lib/startJourneyPlans';
import type { Plan } from '@/lib/startJourneyPlans';
import { useNinetyDayPlan, type PersonalityProfile } from '@/hooks/useNinetyDayPlan';
import type { ChildRecord } from '@/types/api';
import DashboardStep from './DashboardStep';
import TrackStep from './TrackStep';
import {
  GOLD,
  GOLD_PALE,
  CYAN,
  INK,
  BODY,
  FROST,
  FIELD_STYLE,
  FIELD_LABEL_STYLE,
  PRIMARY_BTN,
} from './theme';
import { TextField } from './fields';

/**
 * The "start the 90-day plan" flow — Ask (child's interest) → Plan → Payment →
 * Done → Dashboard → Tracker. "Payment" is still a simulated delay (real
 * billing is deferred to future backend work), but the plan itself (Dashboard)
 * and the event tracker (Tracker) are LLM-generated and persisted via
 * useNinetyDayPlan/GET+PATCH /user/ninety-day-plan, falling back to the
 * static content in `@/lib/startJourneyPlans` while a job is pending or if it
 * fails, so the flow never dead-ends. Reopening the modal for a child who
 * already has a plan resumes straight into the Dashboard instead of
 * restarting Ask/Plan/Payment/Done.
 */

type Step = 0 | 1 | 2 | 3 | 4 | 5;

interface StartJourneyModalProps {
  open: boolean;
  onClose: () => void;
  childName: string;
  childGender: string | null;
  childId: string | undefined;
  childData: ChildRecord | null;
  profile: PersonalityProfile | null;
}

const INTEREST_CHIPS = [
  'Building things',
  'Drawing',
  'Football',
  'Animals',
  'Space',
  'Music',
  'Reading',
  'Cooking',
  'Gaming',
];

const COUNTRIES = [
  { value: 'IN', label: 'India' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'SG', label: 'Singapore' },
];

/** Inner inputs of the unified "Card information" box — transparent, no
 * border of their own; the box around them supplies background/border. */
const CARD_ROW_INPUT: React.CSSProperties = {
  minWidth: 0,
  flex: 1,
  boxSizing: 'border-box',
  padding: '12px 14px',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: FROST,
  fontWeight: 700,
  fontSize: 15.5,
  letterSpacing: '.05em',
};

function formatCardNumber(raw: string): string {
  return raw
    .replace(/\D/g, '')
    .slice(0, 16)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits;
}

export default function StartJourneyModal({
  open,
  onClose,
  childName,
  childGender,
  childId,
  childData,
  profile,
}: StartJourneyModalProps) {
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [expressMethod, setExpressMethod] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [nameOnCard, setNameOnCard] = useState('');
  const [country, setCountry] = useState('IN');
  const [zip, setZip] = useState('');
  // Drives the Done step's loading bar — true once the real plan is ready
  // (or the max-wait gives up), never on a fixed timer. See the effect below.
  const [barComplete, setBarComplete] = useState(false);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = (text: string) => fillTemplate(text, childName, childGender);

  const progress = useNinetyDayPlan({ childId, childData, profile });

  // Every open resets the payment-form fields (never persisted, and
  // shouldn't be), and decides the opening step exactly once per open: a
  // child with a saved plan resumes straight into the Dashboard instead of
  // restarting Ask/Plan/Payment/Done. Gated on loadingDoc so this doesn't run
  // before useNinetyDayPlan's own fetch has had a chance to say whether a
  // plan already exists.
  const didInitStepRef = useRef(false);
  useEffect(() => {
    if (!open) {
      didInitStepRef.current = false;
      return;
    }
    if (progress.loadingDoc || didInitStepRef.current) return;
    didInitStepRef.current = true;
    if (busyTimer.current) clearTimeout(busyTimer.current);
    setBusy(false);
    setExpressMethod(null);
    setEmail('');
    setCardNumber('');
    setExpiry('');
    setCvc('');
    setNameOnCard('');
    setCountry('IN');
    setZip('');
    setStep(progress.hasPlan ? 4 : 0);
  }, [open, progress.loadingDoc, progress.hasPlan]);

  useEffect(
    () => () => {
      if (busyTimer.current) clearTimeout(busyTimer.current);
    },
    [],
  );

  // The Done step's loading bar (below) is driven by barComplete, not a
  // fixed-duration animation — it holds at ~85% for as long as the real
  // generate_ninety_day_plan job (enqueued in finishPayment) is still
  // running, and only snaps to 100% once that's actually true. Advancing to
  // the Dashboard waits for that same signal, with a short pause afterwards
  // so the bar is visibly at 100% before the screen changes rather than
  // cutting away mid-fill. The 12s max-wait is a give-up, not a success —
  // it still completes the bar first so the transition never looks abrupt —
  // and the Dashboard falls back to the static plan below either way.
  useEffect(() => {
    if (!open || step !== 3) {
      setBarComplete(false);
      return;
    }
    if (barComplete) {
      const advance = setTimeout(() => setStep(4), 500);
      return () => clearTimeout(advance);
    }
    if (!progress.isGeneratingPlan) {
      setBarComplete(true);
      return;
    }
    const maxWait = setTimeout(() => setBarComplete(true), 12000);
    return () => clearTimeout(maxWait);
  }, [open, step, progress.isGeneratingPlan, barComplete]);

  const interest = useMemo(() => readInterest(progress.ask), [progress.ask]);

  // Fires generate_event_tracker once the parent locks in a Day-90 target —
  // guarded on hasTrackSteps/isGeneratingTrackSteps so it's a no-op on resume
  // (already generated) and can't double-fire while a job is in flight.
  useEffect(() => {
    if (!progress.evSet || progress.hasTrackSteps || progress.isGeneratingTrackSteps) return;
    progress.generateTrackSteps(progress.evName, progress.evDate, interest.label);
  }, [progress, interest.label]);
  const plan = useMemo(
    () => (progress.doc?.plan as Plan | null | undefined) ?? getPlan(interest),
    [progress.doc?.plan, interest],
  );
  const months = useMemo(() => buildPlanMonths(plan), [plan]);
  const trackSteps = useMemo(
    () => mergeTrackSteps(progress.doc?.track_steps?.steps, TRACK),
    [progress.doc?.track_steps],
  );

  const toggleInterestChip = (label: string) => {
    const prev = progress.ask;
    const next = prev.includes(label)
      ? prev
          .split(label)
          .join('')
          .replace(/,\s*,/g, ', ')
          .replace(/^[,\s]+|[,\s]+$/g, '')
      : prev.trim()
        ? `${prev.replace(/[,\s]+$/, '')}, ${label}`
        : label;
    progress.setAsk(next);
  };

  const askEcho = progress.ask.trim();
  const askOk = askEcho.length > 0;
  const askHint = askOk
    ? 'That’s enough to build month one.'
    : t('Tap what fits, or write it in {his} own words.');
  const askCount = askOk ? 'Ready' : '';

  const renewDate = new Date();
  renewDate.setDate(renewDate.getDate() + 30);
  const renewLabel = renewDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const finishPayment = (method: string | null) => {
    if (busy) return;
    setBusy(true);
    setExpressMethod(method);
    // Fired at the moment checkout is submitted, not before — a parent who
    // abandons at Ask/Plan/Payment should never end up with a plan sitting in
    // the DB (reopening the modal resumes straight to the Dashboard whenever
    // hasPlan is true, so generating any earlier would let an abandoned
    // session skip payment entirely on the next open). Done's real-wait UI
    // is what actually covers the LLM's latency, not a head start earned by
    // hiding the job behind Plan/Payment.
    if (!progress.hasPlan) progress.generatePlan(askEcho);
    busyTimer.current = setTimeout(() => {
      setBusy(false);
      setStep(3);
    }, 1100);
  };

  const lastFour = cardNumber.replace(/\D/g, '').slice(-4);
  const paymentMethodLabel = expressMethod ?? (lastFour ? `Card •••• ${lastFour}` : 'Card');

  const stepLabel =
    step === 0
      ? t('Step 1 of 3 · About {name}')
      : step === 1
        ? 'Step 2 of 3 · Your plan'
        : step === 2
          ? 'Step 3 of 3 · Secure checkout'
          : 'Subscription active';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] w-[calc(100vw-2rem)] grid-cols-1 overflow-y-auto rounded-3xl border-0 p-0 font-rajdhani sm:rounded-3xl"
        style={{
          maxWidth: step === 4 || step === 5 ? 'min(96vw, 1180px)' : 'min(94vw, 920px)',
          background:
            'linear-gradient(165deg,rgb(var(--constellation-navy-panel3-rgb) / .98),rgb(var(--constellation-ink-navy-rgb) / .98))',
          border: '1px solid rgb(var(--constellation-cyan-rgb) / .24)',
          boxShadow: '0 40px 120px rgb(var(--constellation-void-deep-rgb) / .6)',
        }}
      >
        <div
          className="flex items-center gap-3 px-6 py-4 pr-14"
          style={{ borderBottom: '1px solid rgb(var(--constellation-cyan-rgb) / .14)' }}
        >
          <div
            className="h-[22px] w-[22px] rounded-full"
            style={{
              background:
                'radial-gradient(circle at 35% 30%,rgb(var(--constellation-cyan-pale-rgb)),rgb(var(--constellation-cyan-rgb)) 45%,rgb(var(--constellation-cyan-deep-rgb)) 100%)',
              boxShadow: '0 0 12px rgb(var(--constellation-cyan-rgb) / .6)',
            }}
          />
          <DialogTitle
            className="font-orbitron"
            style={{
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: '.2em',
              textTransform: 'uppercase',
              color: BODY,
            }}
          >
            {stepLabel}
          </DialogTitle>
        </div>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="ask"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="px-8 py-8"
            >
              <div
                className="font-orbitron"
                style={{
                  fontWeight: 700,
                  fontSize: 10.5,
                  letterSpacing: '.2em',
                  textTransform: 'uppercase',
                  color: GOLD,
                }}
              >
                One question before we begin
              </div>
              <h3
                className="font-orbitron"
                style={{
                  margin: '12px 0 0',
                  fontWeight: 900,
                  fontSize: 23,
                  lineHeight: 1.25,
                  color: 'rgb(var(--constellation-cyan-pale-rgb))',
                }}
              >
                {t('What does {name} say')}
                <br />
                <span style={{ color: GOLD }}>{t('{he} {is} interested in?')}</span>
              </h3>
              <p
                style={{
                  marginTop: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.5,
                  color: BODY,
                }}
              >
                {t(
                  'In {his} words, not yours. Month one is built around what {he} already leans towards, so this is the one thing we need to know.',
                )}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {INTEREST_CHIPS.map((label) => {
                  const on = progress.ask.includes(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleInterestChip(label)}
                      style={{
                        cursor: 'pointer',
                        padding: '9px 16px',
                        borderRadius: 999,
                        border: `1px solid ${on ? 'rgb(var(--constellation-gold-rgb) / .6)' : 'rgb(var(--constellation-cyan-rgb) / .18)'}`,
                        background: on
                          ? 'rgb(var(--constellation-gold-rgb) / .13)'
                          : 'rgb(var(--constellation-ink-navy-rgb) / .7)',
                        fontWeight: 700,
                        fontSize: 12.5,
                        color: on ? GOLD_PALE : 'rgb(var(--constellation-slate-light-rgb))',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div
                className="mt-5 rounded-2xl"
                style={{
                  background: 'rgb(var(--constellation-navy-deepest-rgb) / .85)',
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .24)',
                }}
              >
                <label htmlFor="journey-ask" className="sr-only">
                  {t('What {he} is interested in, in {his} own words')}
                </label>
                <textarea
                  id="journey-ask"
                  value={progress.ask}
                  onChange={(e) => progress.setAsk(e.target.value)}
                  rows={4}
                  placeholder={t(
                    '{He} says {he} likes taking things apart to see how they work — mostly old remotes and the phone charger.',
                  )}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '16px 18px',
                    background: 'transparent',
                    border: 'none',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    fontWeight: 600,
                    fontSize: 16,
                    lineHeight: 1.5,
                    color: FROST,
                    outline: 'none',
                  }}
                />
                <div
                  className="flex items-center justify-between gap-3"
                  style={{ padding: '0 18px 14px' }}
                >
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-mute-rgb))',
                    }}
                  >
                    {askHint}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 11.5,
                      color: askOk
                        ? 'hsl(var(--success-bright))'
                        : 'rgb(var(--constellation-slate-deep-rgb))',
                    }}
                  >
                    {askCount}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Button
                  onClick={() => setStep(1)}
                  disabled={!askOk}
                  className="h-12 rounded-full px-8 text-xs disabled:opacity-40"
                  style={PRIMARY_BTN}
                >
                  Continue
                </Button>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'rgb(var(--constellation-slate-mute-rgb))',
                  }}
                >
                  {t('You can change this later from {his} profile.')}
                </span>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="plan"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="grid gap-0 sm:grid-cols-[1.05fr_.95fr]"
            >
              <div className="px-8 py-8">
                <h3
                  className="font-orbitron"
                  style={{
                    margin: 0,
                    fontWeight: 900,
                    fontSize: 23,
                    lineHeight: 1.2,
                    color: 'rgb(var(--constellation-cyan-pale-rgb))',
                  }}
                >
                  {t("{name}'s first month")}
                  <br />
                  <span style={{ color: GOLD }}>is on us.</span>
                </h3>
                {askEcho && (
                  <div
                    className="mt-4 rounded-xl px-4 py-3"
                    style={{
                      background: 'rgb(var(--constellation-cyan-rgb) / .07)',
                      borderLeft: '2px solid rgb(var(--constellation-cyan-rgb) / .5)',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 10,
                        letterSpacing: '.18em',
                        textTransform: 'uppercase',
                        color: BODY,
                      }}
                    >
                      {t('In {his} words')}
                    </div>
                    <div
                      style={{
                        marginTop: 7,
                        fontSize: 14,
                        fontWeight: 600,
                        lineHeight: 1.45,
                        color: 'rgb(var(--constellation-caption-rgb))',
                      }}
                    >
                      {askEcho}
                    </div>
                  </div>
                )}
                <p
                  style={{
                    marginTop: 12,
                    fontSize: 15,
                    fontWeight: 600,
                    lineHeight: 1.5,
                    color: 'rgb(var(--constellation-slate-cool-rgb))',
                  }}
                >
                  Nothing is charged today. Your subscription starts after 30 days and you can
                  cancel before then in one tap.
                </p>
                <div className="mt-6 flex flex-col gap-3">
                  {[
                    t('A monthly plan built from {name}’s profile, across all six growth areas.'),
                    'Weekly check-ins that take about two minutes.',
                    t("{name}'s finished work logged, so progress compounds over time."),
                    'One child per subscription. Add a sibling any time for $5.',
                  ].map((line) => (
                    <div key={line} className="flex items-start gap-3">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={CYAN}
                        strokeWidth="2.6"
                        style={{ width: 15, height: 15, marginTop: 3, flexShrink: 0 }}
                      >
                        <path d="M4 12.5l5 5L20 6.5" />
                      </svg>
                      <div
                        style={{
                          fontSize: 14.5,
                          fontWeight: 600,
                          lineHeight: 1.45,
                          color: 'rgb(var(--constellation-caption-rgb))',
                        }}
                      >
                        {line}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="px-8 py-8"
                style={{
                  background: 'rgb(var(--constellation-ink-navy-rgb) / .7)',
                  borderLeft: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
                }}
              >
                <div
                  className="rounded-2xl p-5"
                  style={{
                    background:
                      'linear-gradient(150deg,rgb(var(--constellation-gold-rgb) / .14),rgb(var(--constellation-ink-navy-rgb) / .6))',
                    border: '1px solid rgb(var(--constellation-gold-rgb) / .3)',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 10.5,
                      letterSpacing: '.2em',
                      textTransform: 'uppercase',
                      color: GOLD,
                    }}
                  >
                    Superpower Pathway
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <div
                      className="font-orbitron"
                      style={{
                        fontWeight: 900,
                        fontSize: 36,
                        lineHeight: 1,
                        color: 'rgb(var(--constellation-cyan-pale-rgb))',
                      }}
                    >
                      $0
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: 'rgb(var(--constellation-slate-pale-rgb))',
                      }}
                    >
                      for month one
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-cool-rgb))',
                    }}
                  >
                    then $5 / month, per child
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-3">
                  <div
                    className="flex justify-between"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-light-rgb))',
                    }}
                  >
                    <span>Today</span>
                    <span style={{ color: FROST, fontWeight: 700 }}>$0.00</span>
                  </div>
                  <div
                    className="flex justify-between"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-light-rgb))',
                    }}
                  >
                    <span>On {renewLabel}</span>
                    <span style={{ color: FROST, fontWeight: 700 }}>$5.00</span>
                  </div>
                  <div
                    style={{ height: 1, background: 'rgb(var(--constellation-cyan-rgb) / .14)' }}
                  />
                  <div
                    className="flex justify-between font-orbitron"
                    style={{ fontSize: 13, fontWeight: 900, letterSpacing: '.06em', color: GOLD }}
                  >
                    <span>DUE NOW</span>
                    <span>$0.00</span>
                  </div>
                </div>

                <Button
                  onClick={() => setStep(2)}
                  className="mt-6 h-12 w-full rounded-full text-xs"
                  style={PRIMARY_BTN}
                >
                  Continue
                </Button>
                <div
                  className="mt-3 text-center"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'rgb(var(--constellation-slate-mute-rgb))',
                  }}
                >
                  We remind you two days before the first charge.
                </div>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="payment"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="grid gap-0 sm:grid-cols-2"
            >
              <div className="px-8 py-8">
                <div className="flex flex-wrap items-center justify-between gap-3.5">
                  <h3
                    className="font-orbitron"
                    style={{
                      margin: 0,
                      fontWeight: 900,
                      fontSize: 19,
                      color: 'rgb(var(--constellation-cyan-pale-rgb))',
                    }}
                  >
                    Pay with
                  </h3>
                  <div
                    className="flex items-center gap-1.5"
                    style={{
                      fontWeight: 700,
                      fontSize: 10.5,
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                      color: 'hsl(var(--success-bright))',
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      style={{ width: 11, height: 11 }}
                    >
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V8a4 4 0 018 0v3" />
                    </svg>
                    $0 today
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => finishPayment('Apple Pay')}
                    className="flex items-center justify-center gap-1.5"
                    style={{
                      cursor: busy ? 'default' : 'pointer',
                      height: 46,
                      borderRadius: 10,
                      background: 'rgb(var(--constellation-cyan-pale-rgb))',
                      color: INK,
                      fontWeight: 700,
                      fontSize: 15,
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 15, height: 15 }}>
                      <path d="M16.4 12.8c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.5-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.4 0-2.6.8-3.3 2-1.4 2.5-.4 6.1 1 8.1.7 1 1.5 2.1 2.5 2 1-.1 1.4-.6 2.6-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-2 .7-1.1 1-2.2 1-2.3-.1 0-2-.8-2-3.1zM14.3 6.3c.5-.7.9-1.6.8-2.6-.8 0-1.8.6-2.4 1.3-.5.6-1 1.6-.8 2.5.9.1 1.9-.5 2.4-1.2z" />
                    </svg>
                    Pay
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => finishPayment('Link')}
                    style={{
                      cursor: busy ? 'default' : 'pointer',
                      height: 46,
                      borderRadius: 10,
                      background: 'hsl(var(--success-bright))',
                      color: INK,
                      fontWeight: 800,
                      fontSize: 14,
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    Link
                  </button>
                </div>

                <div className="my-4 flex items-center gap-3">
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: 'rgb(var(--constellation-cyan-rgb) / .14)',
                    }}
                  />
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 10,
                      letterSpacing: '.2em',
                      textTransform: 'uppercase',
                      color: 'rgb(var(--constellation-slate-mute-rgb))',
                    }}
                  >
                    or pay with card
                  </div>
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: 'rgb(var(--constellation-cyan-rgb) / .14)',
                    }}
                  />
                </div>

                <div className="flex flex-col gap-3.5">
                  <TextField
                    id="journey-pay-email"
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="priya@example.com"
                  />

                  <div>
                    <span style={FIELD_LABEL_STYLE}>Card information</span>
                    <div
                      className="mt-1.5 overflow-hidden rounded-[10px]"
                      style={{
                        background: 'rgb(var(--constellation-navy-deepest-rgb) / .85)',
                        border: '1px solid rgb(var(--constellation-cyan-rgb) / .2)',
                      }}
                    >
                      <div
                        className="flex items-center px-3.5"
                        style={{
                          borderBottom: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
                        }}
                      >
                        <label htmlFor="journey-pay-card" className="min-w-0 flex-1">
                          <span className="sr-only">Card number</span>
                          <input
                            id="journey-pay-card"
                            inputMode="numeric"
                            value={cardNumber}
                            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                            placeholder="1234 1234 1234 1234"
                            style={{ ...CARD_ROW_INPUT, padding: '12px 0' }}
                          />
                        </label>
                        <div className="flex flex-shrink-0 gap-1">
                          {/* Card-network marks — fixed third-party brand colors, not app theme tokens. */}
                          <div
                            className="flex items-center justify-center rounded-[3px] font-rajdhani"
                            style={{
                              width: 26,
                              height: 17,
                              background: '#1a1f71',
                              fontWeight: 800,
                              fontSize: 8,
                              color: '#fff',
                              letterSpacing: '.04em',
                            }}
                          >
                            VISA
                          </div>
                          <div
                            className="relative rounded-[3px]"
                            style={{ width: 26, height: 17, background: '#eb001b' }}
                          >
                            <div
                              className="absolute rounded-[3px]"
                              style={{
                                left: 9,
                                top: 0,
                                width: 17,
                                height: 17,
                                background: '#f79e1b',
                                opacity: 0.85,
                              }}
                            />
                          </div>
                          <div
                            className="flex items-center justify-center rounded-[3px] font-rajdhani"
                            style={{
                              width: 26,
                              height: 17,
                              background: '#016fd0',
                              fontWeight: 800,
                              fontSize: 7,
                              color: '#fff',
                            }}
                          >
                            AMEX
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2">
                        <label htmlFor="journey-pay-expiry">
                          <span className="sr-only">Expiry</span>
                          <input
                            id="journey-pay-expiry"
                            inputMode="numeric"
                            value={expiry}
                            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                            placeholder="MM / YY"
                            style={{
                              ...CARD_ROW_INPUT,
                              borderRight: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
                            }}
                          />
                        </label>
                        <label htmlFor="journey-pay-cvc">
                          <span className="sr-only">CVC</span>
                          <input
                            id="journey-pay-cvc"
                            inputMode="numeric"
                            value={cvc}
                            onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            placeholder="CVC"
                            style={CARD_ROW_INPUT}
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <TextField
                    id="journey-pay-name"
                    label="Name on card"
                    value={nameOnCard}
                    onChange={setNameOnCard}
                    placeholder="Priya Sharma"
                  />

                  <div className="grid gap-3" style={{ gridTemplateColumns: '1.1fr .9fr' }}>
                    <label htmlFor="journey-pay-country">
                      <span style={FIELD_LABEL_STYLE}>Country</span>
                      <select
                        id="journey-pay-country"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        style={{ ...FIELD_STYLE, appearance: 'none' }}
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TextField
                      id="journey-pay-zip"
                      label="Postal code"
                      value={zip}
                      onChange={setZip}
                      placeholder="560001"
                    />
                  </div>
                </div>
              </div>

              <div
                className="flex flex-col px-8 py-8"
                style={{
                  background: 'rgb(var(--constellation-ink-navy-rgb) / .7)',
                  borderLeft: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 10.5,
                    letterSpacing: '.2em',
                    textTransform: 'uppercase',
                    color: 'rgb(var(--constellation-slate-warm-rgb))',
                  }}
                >
                  Subscribing to
                </div>
                <div
                  className="mt-2 font-orbitron"
                  style={{
                    fontWeight: 900,
                    fontSize: 17,
                    color: 'rgb(var(--constellation-cyan-pale-rgb))',
                  }}
                >
                  Superpower Pathway
                </div>
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: 'rgb(var(--constellation-slate-warm-rgb))',
                  }}
                >
                  {t('Monthly · one child · {name}')}
                </div>

                <div className="mt-5 flex flex-col gap-2.5">
                  <div
                    className="flex justify-between"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-light-rgb))',
                    }}
                  >
                    <span>Superpower Pathway</span>
                    <span style={{ color: 'rgb(var(--constellation-caption-rgb))' }}>$5.00</span>
                  </div>
                  <div
                    className="flex justify-between"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-light-rgb))',
                    }}
                  >
                    <span>First month free</span>
                    <span style={{ color: 'hsl(var(--success-bright))' }}>−$5.00</span>
                  </div>
                  <div
                    style={{ height: 1, background: 'rgb(var(--constellation-cyan-rgb) / .14)' }}
                  />
                  <div
                    className="flex justify-between font-orbitron"
                    style={{ fontSize: 13, fontWeight: 900, letterSpacing: '.06em', color: GOLD }}
                  >
                    <span>TOTAL DUE TODAY</span>
                    <span>$0.00</span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-mute-rgb))',
                    }}
                  >
                    On {renewLabel} and monthly after, $5.00 will be charged to this card.
                  </div>
                </div>

                <Button
                  onClick={() => finishPayment(null)}
                  disabled={busy}
                  className="mt-6 h-12 w-full rounded-full text-xs disabled:opacity-70"
                  style={PRIMARY_BTN}
                >
                  {busy ? 'Confirming…' : 'Start free month'}
                  {!busy && <ChevronRight className="ml-1 h-4 w-4" />}
                </Button>

                <div
                  style={{
                    marginTop: 14,
                    fontSize: 12.5,
                    fontWeight: 600,
                    lineHeight: 1.5,
                    color: 'rgb(var(--constellation-slate-mute-rgb))',
                  }}
                >
                  {`By subscribing you allow Superpower to charge this card for future payments in line with their terms. Cancel any time before ${renewLabel} and you pay nothing.`}
                </div>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                  <div
                    className="flex items-center gap-1.5"
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'rgb(var(--constellation-slate-mute-rgb))',
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      style={{ width: 11, height: 11 }}
                    >
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V8a4 4 0 018 0v3" />
                    </svg>
                    Powered by{' '}
                    <span style={{ color: 'rgb(var(--constellation-slate-pale-rgb))' }}>
                      Stripe
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-3"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'rgb(var(--constellation-slate-mute-rgb))',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      style={{ cursor: 'pointer', color: CYAN }}
                    >
                      Back
                    </button>
                    <span>Terms</span>
                    <span>Privacy</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="px-9 py-11 text-center"
            >
              <div
                className="mx-auto flex h-[74px] w-[74px] items-center justify-center rounded-full"
                style={{ background: `linear-gradient(150deg,${CYAN},${GOLD})` }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={INK}
                  strokeWidth="3"
                  style={{ width: 32, height: 32 }}
                >
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              </div>
              <h3
                className="font-orbitron"
                style={{
                  margin: '22px 0 0',
                  fontWeight: 900,
                  fontSize: 22,
                  color: 'rgb(var(--constellation-cyan-pale-rgb))',
                }}
              >
                Day 1 starts tomorrow.
              </h3>
              <p
                className="mx-auto"
                style={{
                  marginTop: 12,
                  maxWidth: 440,
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.5,
                  color: BODY,
                }}
              >
                {t(
                  "{name}'s free month is live. Month one's anchor moves are already in {his} plan.",
                )}
              </p>
              <div
                className="mx-auto mt-6 flex max-w-[420px] flex-col gap-2.5 rounded-2xl px-5 py-4"
                style={{
                  background: 'rgb(var(--constellation-ink-navy-rgb) / .8)',
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .16)',
                }}
              >
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'rgb(var(--constellation-slate-light-rgb))',
                  }}
                >
                  <span>Free until</span>
                  <span style={{ color: FROST, fontWeight: 700 }}>{renewLabel}</span>
                </div>
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'rgb(var(--constellation-slate-light-rgb))',
                  }}
                >
                  <span>Then</span>
                  <span style={{ color: FROST, fontWeight: 700 }}>$5 / month</span>
                </div>
                <div
                  className="flex justify-between"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'rgb(var(--constellation-slate-light-rgb))',
                  }}
                >
                  <span>Paying with</span>
                  <span style={{ color: FROST, fontWeight: 700 }}>{paymentMethodLabel}</span>
                </div>
              </div>
              <Button
                onClick={() => setStep(4)}
                disabled={!barComplete}
                className="mt-7 h-12 rounded-full px-8 text-xs disabled:opacity-40"
                style={PRIMARY_BTN}
              >
                {t('Open {his} dashboard')}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>

              <div className="mt-3.5 flex items-center justify-center gap-2.5">
                <div
                  className="h-[2px] w-[120px] overflow-hidden rounded-full"
                  style={{ background: 'rgb(var(--constellation-cyan-rgb) / .16)' }}
                >
                  <motion.div
                    className="h-full w-full"
                    style={{
                      background: `linear-gradient(90deg,${CYAN},${GOLD})`,
                      transformOrigin: 'left',
                    }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: barComplete ? 1 : 0.85 }}
                    transition={
                      barComplete
                        ? { duration: 0.35, ease: 'easeOut' }
                        : { duration: 6, ease: 'easeOut' }
                    }
                  />
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'rgb(var(--constellation-slate-mute-rgb))',
                  }}
                >
                  {t('Building {his} dashboard…')}
                </div>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="dash"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <DashboardStep
                childName={childName}
                childGender={childGender}
                interest={interest}
                plan={plan}
                months={months}
                progress={progress}
                onTrack={() => setStep(5)}
                onDone={onClose}
              />
            </motion.div>
          )}

          {step === 5 && (
            <motion.div
              key="track"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <TrackStep
                childName={childName}
                childGender={childGender}
                progress={progress}
                steps={trackSteps}
                onBack={() => setStep(4)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
