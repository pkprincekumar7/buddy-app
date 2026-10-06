import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated, {
  Easing,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ChevronRight, X } from 'lucide-react-native';

import { MODAL_BACKDROP, MODAL_SCALE } from '@/lib/animations';
import { fillTemplate } from '@/lib/growthAreaData';
import {
  readInterest,
  getPlan,
  buildPlanMonths,
  mergeTrackSteps,
  TRACK,
} from '@/lib/startJourneyPlans';
import type { Plan } from '@/lib/startJourneyPlans';
import {
  useNinetyDayPlan,
  type PersonalityProfile,
} from '@/hooks/useNinetyDayPlan';
import type { ChildRecord } from '@/types/api';
import { color, css, gradient, rgb } from '@/theme';
import DashboardStep from './DashboardStep';
import TrackStep from './TrackStep';
import {
  GOLD,
  GOLD_PALE,
  CYAN,
  CYAN_PALE,
  INK,
  BODY,
  FROST,
  CAPTION,
  FIELD_LABEL_STYLE,
  GRAD_CYAN_GOLD_150,
  GRAD_CYAN_GOLD_90,
  PLACEHOLDER,
  PRIMARY_BTN,
  PRIMARY_BTN_TEXT,
  SLATE_COOL,
  SLATE_DEEP,
  SLATE_LIGHT,
  SLATE_MUTE,
  SLATE_PALE,
  SLATE_WARM,
  SUCCESS,
  kicker,
  orb,
  rj,
} from './theme';
import { SelectField, TextField } from './fields';
import { AppleGlyph, CHECK_PATH, Glyph, LockGlyph } from './icons';
import {
  AMEX_BLUE,
  CARD_MARK_TEXT,
  MASTERCARD_ORANGE,
  MASTERCARD_RED,
  VISA_BLUE,
} from './palette';

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
 *
 * RN: the web's Radix dialog is an RN <Modal> with the same card chrome
 * (centered, 100vw − 2rem wide, max 90% tall, its own scroll) plus keyboard
 * avoidance for the checkout form; Android back closes it.
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
const CARD_ROW_INPUT: TextStyle = {
  minWidth: 0,
  flex: 1,
  paddingVertical: 12,
  paddingHorizontal: 14,
  backgroundColor: 'transparent',
  ...rj(15.5, 700, FROST, 0.05),
};

const CARD_BG = css(
  'linear-gradient(165deg,rgb(var(--constellation-navy-panel3-rgb) / .98),rgb(var(--constellation-ink-navy-rgb) / .98))',
);
const CARD_SHADOW = css(
  '0 40px 120px rgb(var(--constellation-void-deep-rgb) / .6)',
);
const ORB_SHADOW = css('0 0 12px rgb(var(--constellation-cyan-rgb) / .6)');
const PRICE_CARD_BG = css(
  'linear-gradient(150deg,rgb(var(--constellation-gold-rgb) / .14),rgb(var(--constellation-ink-navy-rgb) / .6))',
);
const DIVIDER = rgb('constellation-cyan', 0.14);

/** framer `initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}`, 0.3s easeOut. */
const STEP_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 10 }] },
  100: {
    opacity: 1,
    transform: [{ translateY: 0 }],
    easing: Easing.out(Easing.ease),
  },
}).duration(300);

function formatCardNumber(raw: string): string {
  return raw
    .replace(/\D/g, '')
    .slice(0, 16)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2
    ? `${digits.slice(0, 2)} / ${digits.slice(2)}`
    : digits;
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
  const scrollRef = useRef<ScrollView | null>(null);

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

  // RN: each step is a new screen inside one scroll view — start it at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

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
    if (
      !progress.evSet ||
      progress.hasTrackSteps ||
      progress.isGeneratingTrackSteps
    )
      return;
    progress.generateTrackSteps(
      progress.evName,
      progress.evDate,
      interest.label,
    );
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
  const paymentMethodLabel =
    expressMethod ?? (lastFour ? `Card •••• ${lastFour}` : 'Card');

  const stepLabel =
    step === 0
      ? t('Step 1 of 3 · About {name}')
      : step === 1
      ? 'Step 2 of 3 · Your plan'
      : step === 2
      ? 'Step 3 of 3 · Secure checkout'
      : 'Subscription active';

  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {open ? (
        <Animated.View {...MODAL_BACKDROP} className="flex-1 bg-overlay">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <View className="flex-1 items-center justify-center p-4">
              <Pressable
                className="absolute inset-0"
                accessibilityLabel="Close dialog"
                onPress={onClose}
              />
              <Animated.View
                {...MODAL_SCALE}
                accessibilityViewIsModal
                style={{
                  width: '100%',
                  maxHeight: '90%',
                  borderRadius: 24,
                  overflow: 'hidden',
                  backgroundColor: color.background,
                  experimental_backgroundImage: CARD_BG,
                  borderWidth: 1,
                  borderColor: rgb('constellation-cyan', 0.24),
                  boxShadow: CARD_SHADOW,
                }}
              >
                <ScrollView
                  ref={scrollRef}
                  bounces={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ gap: 16 }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingHorizontal: 24,
                      paddingVertical: 16,
                      paddingRight: 56,
                      borderBottomWidth: 1,
                      borderBottomColor: DIVIDER,
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        experimental_backgroundImage: gradient.orbCyan,
                        boxShadow: ORB_SHADOW,
                      }}
                    />
                    <Text
                      accessibilityRole="header"
                      style={{
                        ...orb(11, 700, BODY, 0.2),
                        textTransform: 'uppercase',
                        flexShrink: 1,
                      }}
                    >
                      {stepLabel}
                    </Text>
                  </View>

                  <Animated.View key={step} entering={STEP_ENTER}>
                    {step === 0 && (
                      <View
                        style={{ paddingHorizontal: 32, paddingVertical: 32 }}
                      >
                        <Text
                          style={{
                            ...orb(10.5, 700, GOLD, 0.2),
                            textTransform: 'uppercase',
                          }}
                        >
                          One question before we begin
                        </Text>
                        <Text
                          accessibilityRole="header"
                          style={{
                            ...orb(23, 900, CYAN_PALE),
                            marginTop: 12,
                            lineHeight: 23 * 1.25,
                          }}
                        >
                          {t('What does {name} say')}
                          {'\n'}
                          <Text style={{ color: GOLD }}>
                            {t('{he} {is} interested in?')}
                          </Text>
                        </Text>
                        <Text
                          style={{
                            ...rj(15, 600, BODY),
                            marginTop: 12,
                            lineHeight: 15 * 1.5,
                          }}
                        >
                          {t(
                            'In {his} words, not yours. Month one is built around what {he} already leans towards, so this is the one thing we need to know.',
                          )}
                        </Text>

                        <View
                          style={{
                            marginTop: 24,
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            gap: 8,
                          }}
                        >
                          {INTEREST_CHIPS.map(label => {
                            const on = progress.ask.includes(label);
                            return (
                              <Pressable
                                key={label}
                                accessibilityRole="button"
                                accessibilityLabel={label}
                                accessibilityState={{ selected: on }}
                                onPress={() => toggleInterestChip(label)}
                                style={{
                                  paddingVertical: 9,
                                  paddingHorizontal: 16,
                                  borderRadius: 999,
                                  borderWidth: 1,
                                  borderColor: on
                                    ? rgb('constellation-gold', 0.6)
                                    : rgb('constellation-cyan', 0.18),
                                  backgroundColor: on
                                    ? rgb('constellation-gold', 0.13)
                                    : rgb('constellation-ink-navy', 0.7),
                                }}
                              >
                                <Text
                                  style={rj(
                                    12.5,
                                    700,
                                    on ? GOLD_PALE : SLATE_LIGHT,
                                  )}
                                >
                                  {label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        <View
                          style={{
                            marginTop: 20,
                            borderRadius: 16,
                            backgroundColor: rgb(
                              'constellation-navy-deepest',
                              0.85,
                            ),
                            borderWidth: 1,
                            borderColor: rgb('constellation-cyan', 0.24),
                          }}
                        >
                          <TextInput
                            accessibilityLabel={t(
                              'What {he} is interested in, in {his} own words',
                            )}
                            value={progress.ask}
                            onChangeText={progress.setAsk}
                            multiline
                            textAlignVertical="top"
                            placeholder={t(
                              '{He} says {he} likes taking things apart to see how they work — mostly old remotes and the phone charger.',
                            )}
                            placeholderTextColor={PLACEHOLDER}
                            style={{
                              width: '100%',
                              minHeight: 4 * 16 * 1.5 + 32,
                              paddingVertical: 16,
                              paddingHorizontal: 18,
                              backgroundColor: 'transparent',
                              ...rj(16, 600, FROST),
                              lineHeight: 16 * 1.5,
                            }}
                          />
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 12,
                              paddingHorizontal: 18,
                              paddingBottom: 14,
                            }}
                          >
                            <Text
                              style={{
                                ...rj(12.5, 600, SLATE_MUTE),
                                flexShrink: 1,
                              }}
                            >
                              {askHint}
                            </Text>
                            <Text
                              style={rj(
                                11.5,
                                700,
                                askOk ? SUCCESS : SLATE_DEEP,
                              )}
                            >
                              {askCount}
                            </Text>
                          </View>
                        </View>

                        <View
                          style={{
                            marginTop: 24,
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 16,
                          }}
                        >
                          <PrimaryButton
                            label="Continue"
                            onPress={() => setStep(1)}
                            disabled={!askOk}
                            disabledOpacity={0.4}
                          />
                          <Text style={rj(12.5, 600, SLATE_MUTE)}>
                            {t('You can change this later from {his} profile.')}
                          </Text>
                        </View>
                      </View>
                    )}

                    {step === 1 && (
                      <View>
                        <View
                          style={{ paddingHorizontal: 32, paddingVertical: 32 }}
                        >
                          <Text
                            accessibilityRole="header"
                            style={{
                              ...orb(23, 900, CYAN_PALE),
                              lineHeight: 23 * 1.2,
                            }}
                          >
                            {t("{name}'s first month")}
                            {'\n'}
                            <Text style={{ color: GOLD }}>is on us.</Text>
                          </Text>
                          {!!askEcho && (
                            <View
                              style={{
                                marginTop: 16,
                                borderRadius: 12,
                                paddingHorizontal: 16,
                                paddingVertical: 12,
                                backgroundColor: rgb(
                                  'constellation-cyan',
                                  0.07,
                                ),
                                borderLeftWidth: 2,
                                borderLeftColor: rgb('constellation-cyan', 0.5),
                              }}
                            >
                              <Text style={kicker(10, 0.18, BODY)}>
                                {t('In {his} words')}
                              </Text>
                              <Text
                                style={{
                                  ...rj(14, 600, CAPTION),
                                  marginTop: 7,
                                  lineHeight: 14 * 1.45,
                                }}
                              >
                                {askEcho}
                              </Text>
                            </View>
                          )}
                          <Text
                            style={{
                              ...rj(15, 600, SLATE_COOL),
                              marginTop: 12,
                              lineHeight: 15 * 1.5,
                            }}
                          >
                            Nothing is charged today. Your subscription starts
                            after 30 days and you can cancel before then in one
                            tap.
                          </Text>
                          <View style={{ marginTop: 24, gap: 12 }}>
                            {[
                              t(
                                'A monthly plan built from {name}’s profile, across all six growth areas.',
                              ),
                              'Weekly check-ins that take about two minutes.',
                              t(
                                "{name}'s finished work logged, so progress compounds over time.",
                              ),
                              'One child per subscription. Add a sibling any time for $5.',
                            ].map(line => (
                              <View
                                key={line}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'flex-start',
                                  gap: 12,
                                }}
                              >
                                <Glyph
                                  d={CHECK_PATH}
                                  size={15}
                                  stroke={CYAN}
                                  strokeWidth={2.6}
                                  style={{ marginTop: 3, flexShrink: 0 }}
                                />
                                <Text
                                  style={{
                                    ...rj(14.5, 600, CAPTION),
                                    flex: 1,
                                    lineHeight: 14.5 * 1.45,
                                  }}
                                >
                                  {line}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>

                        <SidePanel>
                          <View
                            style={{
                              borderRadius: 16,
                              padding: 20,
                              experimental_backgroundImage: PRICE_CARD_BG,
                              borderWidth: 1,
                              borderColor: rgb('constellation-gold', 0.3),
                            }}
                          >
                            <Text style={kicker(10.5, 0.2, GOLD)}>
                              Superpower Pathway
                            </Text>
                            <View
                              style={{
                                marginTop: 8,
                                flexDirection: 'row',
                                alignItems: 'baseline',
                                gap: 8,
                              }}
                            >
                              <Text
                                style={{
                                  ...orb(36, 900, CYAN_PALE),
                                  lineHeight: 36 * 1.1,
                                }}
                              >
                                $0
                              </Text>
                              <Text style={rj(14, 700, SLATE_PALE)}>
                                for month one
                              </Text>
                            </View>
                            <Text
                              style={{
                                ...rj(14, 600, SLATE_COOL),
                                marginTop: 8,
                              }}
                            >
                              then $5 / month, per child
                            </Text>
                          </View>

                          <View style={{ marginTop: 20, gap: 12 }}>
                            <SummaryRow label="Today" value="$0.00" />
                            <SummaryRow
                              label={`On ${renewLabel}`}
                              value="$5.00"
                            />
                            <View
                              style={{ height: 1, backgroundColor: DIVIDER }}
                            />
                            <TotalRow label="DUE NOW" value="$0.00" />
                          </View>

                          <PrimaryButton
                            label="Continue"
                            onPress={() => setStep(2)}
                            fullWidth
                            style={{ marginTop: 24 }}
                          />
                          <Text
                            style={{
                              ...rj(12.5, 600, SLATE_MUTE),
                              marginTop: 12,
                              textAlign: 'center',
                            }}
                          >
                            We remind you two days before the first charge.
                          </Text>
                        </SidePanel>
                      </View>
                    )}

                    {step === 2 && (
                      <View>
                        <View
                          style={{ paddingHorizontal: 32, paddingVertical: 32 }}
                        >
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 14,
                            }}
                          >
                            <Text
                              accessibilityRole="header"
                              style={orb(19, 900, CYAN_PALE)}
                            >
                              Pay with
                            </Text>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <LockGlyph size={11} stroke={SUCCESS} />
                              <Text style={kicker(10.5, 0.14, SUCCESS)}>
                                $0 today
                              </Text>
                            </View>
                          </View>

                          <View
                            style={{
                              marginTop: 16,
                              flexDirection: 'row',
                              gap: 10,
                            }}
                          >
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Apple Pay"
                              accessibilityState={{ disabled: busy }}
                              disabled={busy}
                              onPress={() => finishPayment('Apple Pay')}
                              style={{
                                flex: 1,
                                height: 46,
                                borderRadius: 10,
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                backgroundColor: CYAN_PALE,
                                opacity: busy ? 0.6 : 1,
                              }}
                            >
                              <AppleGlyph size={15} fill={INK} />
                              <Text style={rj(15, 700, INK)}>Pay</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Link"
                              accessibilityState={{ disabled: busy }}
                              disabled={busy}
                              onPress={() => finishPayment('Link')}
                              style={{
                                flex: 1,
                                height: 46,
                                borderRadius: 10,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: SUCCESS,
                                opacity: busy ? 0.6 : 1,
                              }}
                            >
                              <Text style={rj(14, 800, INK)}>Link</Text>
                            </Pressable>
                          </View>

                          <View
                            style={{
                              marginVertical: 16,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 12,
                            }}
                          >
                            <View
                              style={{
                                flex: 1,
                                height: 1,
                                backgroundColor: DIVIDER,
                              }}
                            />
                            <Text style={kicker(10, 0.2, SLATE_MUTE)}>
                              or pay with card
                            </Text>
                            <View
                              style={{
                                flex: 1,
                                height: 1,
                                backgroundColor: DIVIDER,
                              }}
                            />
                          </View>

                          <View style={{ gap: 14 }}>
                            <TextField
                              id="journey-pay-email"
                              label="Email"
                              type="email"
                              value={email}
                              onChange={setEmail}
                              placeholder="priya@example.com"
                            />

                            <View>
                              <Text style={FIELD_LABEL_STYLE}>
                                Card information
                              </Text>
                              <View
                                style={{
                                  marginTop: 6,
                                  overflow: 'hidden',
                                  borderRadius: 10,
                                  backgroundColor: rgb(
                                    'constellation-navy-deepest',
                                    0.85,
                                  ),
                                  borderWidth: 1,
                                  borderColor: rgb('constellation-cyan', 0.2),
                                }}
                              >
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    paddingHorizontal: 14,
                                    borderBottomWidth: 1,
                                    borderBottomColor: DIVIDER,
                                  }}
                                >
                                  <TextInput
                                    accessibilityLabel="Card number"
                                    keyboardType="number-pad"
                                    value={cardNumber}
                                    onChangeText={v =>
                                      setCardNumber(formatCardNumber(v))
                                    }
                                    placeholder="1234 1234 1234 1234"
                                    placeholderTextColor={PLACEHOLDER}
                                    style={{
                                      ...CARD_ROW_INPUT,
                                      paddingHorizontal: 0,
                                    }}
                                  />
                                  <CardMarks />
                                </View>
                                <View style={{ flexDirection: 'row' }}>
                                  <TextInput
                                    accessibilityLabel="Expiry"
                                    keyboardType="number-pad"
                                    value={expiry}
                                    onChangeText={v =>
                                      setExpiry(formatExpiry(v))
                                    }
                                    placeholder="MM / YY"
                                    placeholderTextColor={PLACEHOLDER}
                                    style={{
                                      ...CARD_ROW_INPUT,
                                      borderRightWidth: 1,
                                      borderRightColor: DIVIDER,
                                    }}
                                  />
                                  <TextInput
                                    accessibilityLabel="CVC"
                                    keyboardType="number-pad"
                                    value={cvc}
                                    onChangeText={v =>
                                      setCvc(v.replace(/\D/g, '').slice(0, 4))
                                    }
                                    placeholder="CVC"
                                    placeholderTextColor={PLACEHOLDER}
                                    style={CARD_ROW_INPUT}
                                  />
                                </View>
                              </View>
                            </View>

                            <TextField
                              id="journey-pay-name"
                              label="Name on card"
                              value={nameOnCard}
                              onChange={setNameOnCard}
                              placeholder="Priya Sharma"
                            />

                            <View
                              style={{
                                flexDirection: 'row',
                                gap: 12,
                                alignItems: 'flex-start',
                              }}
                            >
                              <View style={{ flex: 1.1, minWidth: 0 }}>
                                <SelectField
                                  id="journey-pay-country"
                                  label="Country"
                                  value={country}
                                  options={COUNTRIES}
                                  onChange={setCountry}
                                />
                              </View>
                              <View style={{ flex: 0.9, minWidth: 0 }}>
                                <TextField
                                  id="journey-pay-zip"
                                  label="Postal code"
                                  value={zip}
                                  onChange={setZip}
                                  placeholder="560001"
                                />
                              </View>
                            </View>
                          </View>
                        </View>

                        <SidePanel>
                          <Text style={kicker(10.5, 0.2, SLATE_WARM)}>
                            Subscribing to
                          </Text>
                          <Text
                            style={{ ...orb(17, 900, CYAN_PALE), marginTop: 8 }}
                          >
                            Superpower Pathway
                          </Text>
                          <Text
                            style={{
                              ...rj(13.5, 600, SLATE_WARM),
                              marginTop: 5,
                            }}
                          >
                            {t('Monthly · one child · {name}')}
                          </Text>

                          <View style={{ marginTop: 20, gap: 10 }}>
                            <SummaryRow
                              label="Superpower Pathway"
                              value="$5.00"
                              valueStyle={rj(14, 600, CAPTION)}
                            />
                            <SummaryRow
                              label="First month free"
                              value="−$5.00"
                              valueStyle={rj(14, 600, SUCCESS)}
                            />
                            <View
                              style={{ height: 1, backgroundColor: DIVIDER }}
                            />
                            <TotalRow label="TOTAL DUE TODAY" value="$0.00" />
                            <Text style={rj(13, 600, SLATE_MUTE)}>
                              On {renewLabel} and monthly after, $5.00 will be
                              charged to this card.
                            </Text>
                          </View>

                          <PrimaryButton
                            label={busy ? 'Confirming…' : 'Start free month'}
                            onPress={() => finishPayment(null)}
                            disabled={busy}
                            disabledOpacity={0.7}
                            fullWidth
                            trailingChevron={!busy}
                            chevronGap={4}
                            style={{ marginTop: 24 }}
                          />

                          <Text
                            style={{
                              ...rj(12.5, 600, SLATE_MUTE),
                              marginTop: 14,
                              lineHeight: 12.5 * 1.5,
                            }}
                          >
                            {`By subscribing you allow Superpower to charge this card for future payments in line with their terms. Cancel any time before ${renewLabel} and you pay nothing.`}
                          </Text>

                          <View
                            style={{
                              paddingTop: 20,
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 12,
                            }}
                          >
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <LockGlyph size={11} stroke={SLATE_MUTE} />
                              <Text style={rj(12, 700, SLATE_MUTE)}>
                                Powered by{' '}
                                <Text style={{ color: SLATE_PALE }}>
                                  Stripe
                                </Text>
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 12,
                              }}
                            >
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Back"
                                hitSlop={8}
                                onPress={() => setStep(1)}
                              >
                                <Text style={rj(12, 600, CYAN)}>Back</Text>
                              </Pressable>
                              <Text style={rj(12, 600, SLATE_MUTE)}>Terms</Text>
                              <Text style={rj(12, 600, SLATE_MUTE)}>
                                Privacy
                              </Text>
                            </View>
                          </View>
                        </SidePanel>
                      </View>
                    )}

                    {step === 3 && (
                      <View
                        style={{
                          paddingHorizontal: 36,
                          paddingVertical: 44,
                          alignItems: 'center',
                        }}
                      >
                        <View
                          style={{
                            width: 74,
                            height: 74,
                            borderRadius: 999,
                            alignItems: 'center',
                            justifyContent: 'center',
                            experimental_backgroundImage: GRAD_CYAN_GOLD_150,
                          }}
                        >
                          <Glyph
                            d={CHECK_PATH}
                            size={32}
                            stroke={INK}
                            strokeWidth={3}
                          />
                        </View>
                        <Text
                          accessibilityRole="header"
                          style={{
                            ...orb(22, 900, CYAN_PALE),
                            marginTop: 22,
                            textAlign: 'center',
                          }}
                        >
                          Day 1 starts tomorrow.
                        </Text>
                        <Text
                          style={{
                            ...rj(15, 600, BODY),
                            marginTop: 12,
                            maxWidth: 440,
                            lineHeight: 15 * 1.5,
                            textAlign: 'center',
                          }}
                        >
                          {t(
                            "{name}'s free month is live. Month one's anchor moves are already in {his} plan.",
                          )}
                        </Text>
                        <View
                          style={{
                            marginTop: 24,
                            width: '100%',
                            maxWidth: 420,
                            gap: 10,
                            borderRadius: 16,
                            paddingHorizontal: 20,
                            paddingVertical: 16,
                            backgroundColor: rgb('constellation-ink-navy', 0.8),
                            borderWidth: 1,
                            borderColor: rgb('constellation-cyan', 0.16),
                          }}
                        >
                          <SummaryRow label="Free until" value={renewLabel} />
                          <SummaryRow label="Then" value="$5 / month" />
                          <SummaryRow
                            label="Paying with"
                            value={paymentMethodLabel}
                          />
                        </View>
                        <PrimaryButton
                          label={t('Open {his} dashboard')}
                          onPress={() => setStep(4)}
                          disabled={!barComplete}
                          disabledOpacity={0.4}
                          trailingChevron
                          chevronGap={8}
                          style={{ marginTop: 28 }}
                        />

                        <View
                          style={{
                            marginTop: 14,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 10,
                          }}
                        >
                          <LoadingBar complete={barComplete} />
                          <Text style={rj(12, 600, SLATE_MUTE)}>
                            {t('Building {his} dashboard…')}
                          </Text>
                        </View>
                      </View>
                    )}

                    {step === 4 && (
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
                    )}

                    {step === 5 && (
                      <TrackStep
                        childName={childName}
                        childGender={childGender}
                        progress={progress}
                        steps={trackSteps}
                        onBack={() => setStep(4)}
                      />
                    )}
                  </Animated.View>
                </ScrollView>

                {/* Radix DialogContent's built-in close button. */}
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={12}
                  style={{
                    position: 'absolute',
                    right: 16,
                    top: 16,
                    opacity: 0.7,
                  }}
                >
                  <X size={16} color={color.foreground} />
                </Pressable>
              </Animated.View>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

// ─── Local building blocks ───────────────────────────────────────────────────

/** The right-hand column of the Plan/Payment steps (stacked below at phone width). */
function SidePanel({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        paddingHorizontal: 32,
        paddingVertical: 32,
        backgroundColor: rgb('constellation-ink-navy', 0.7),
        borderLeftWidth: 1,
        borderLeftColor: DIVIDER,
      }}
    >
      {children}
    </View>
  );
}

function SummaryRow({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: TextStyle;
}) {
  return (
    <View
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
    >
      <Text style={{ ...rj(14, 600, SLATE_LIGHT), flexShrink: 1 }}>
        {label}
      </Text>
      <Text style={valueStyle ?? rj(14, 700, FROST)}>{value}</Text>
    </View>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  const s = orb(13, 900, GOLD, 0.06);
  return (
    <View
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
    >
      <Text style={s}>{label}</Text>
      <Text style={s}>{value}</Text>
    </View>
  );
}

/** Web `<Button className="h-12 rounded-full px-8 text-xs" style={PRIMARY_BTN}>`. */
function PrimaryButton({
  label,
  onPress,
  disabled = false,
  disabledOpacity = 0.5,
  fullWidth = false,
  trailingChevron = false,
  chevronGap = 4,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  disabledOpacity?: number;
  fullWidth?: boolean;
  trailingChevron?: boolean;
  chevronGap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        PRIMARY_BTN,
        {
          height: 48,
          paddingVertical: 0,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        disabled && { opacity: disabledOpacity },
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
        style,
      ]}
    >
      <Text numberOfLines={1} style={PRIMARY_BTN_TEXT}>
        {label}
      </Text>
      {trailingChevron && (
        <ChevronRight
          size={16}
          color={INK}
          style={{ marginLeft: chevronGap - 8 }}
        />
      )}
    </Pressable>
  );
}

/** Card-network marks — fixed third-party brand colors, not app theme tokens. */
function CardMarks() {
  const mark: ViewStyle = { width: 26, height: 17, borderRadius: 3 };
  return (
    <View
      style={{ flexDirection: 'row', gap: 4, flexShrink: 0 }}
      accessibilityLabel="Visa, Mastercard and American Express accepted"
    >
      <View
        style={{
          ...mark,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: VISA_BLUE,
        }}
      >
        <Text style={rj(8, 800, CARD_MARK_TEXT, 0.04)}>VISA</Text>
      </View>
      <View style={{ ...mark, backgroundColor: MASTERCARD_RED }}>
        <View
          style={{
            position: 'absolute',
            left: 9,
            top: 0,
            width: 17,
            height: 17,
            borderRadius: 3,
            backgroundColor: MASTERCARD_ORANGE,
            opacity: 0.85,
          }}
        />
      </View>
      <View
        style={{
          ...mark,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: AMEX_BLUE,
        }}
      >
        <Text style={rj(7, 800, CARD_MARK_TEXT)}>AMEX</Text>
      </View>
    </View>
  );
}

/** Done step's bar: eases to 85% over 6s while the plan job runs, then snaps
 * to 100% in .35s once `complete` (web framer scaleX from the left). */
function LoadingBar({ complete }: { complete: boolean }) {
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withTiming(complete ? 1 : 0.85, {
      duration: complete ? 350 : 6000,
      easing: Easing.out(Easing.ease),
    });
  }, [complete, scale]);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scaleX: scale.value }],
  }));
  return (
    <View
      style={{
        width: 120,
        height: 2,
        overflow: 'hidden',
        borderRadius: 999,
        backgroundColor: rgb('constellation-cyan', 0.16),
      }}
    >
      <Animated.View
        style={[
          {
            width: '100%',
            height: '100%',
            transformOrigin: 'left',
            experimental_backgroundImage: GRAD_CYAN_GOLD_90,
          },
          animated,
        ]}
      />
    </View>
  );
}
