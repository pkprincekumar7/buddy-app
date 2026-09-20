import { fillTemplate } from '@/lib/growthAreaData';
import {
  FB_TAGS,
  adjTarget,
  type FeedbackTag,
  type Interest,
  type Plan,
  type PlanActivity,
  type PlanMonth,
} from '@/lib/startJourneyPlans';
import type { NinetyDayPlan } from '@/hooks/useNinetyDayPlan';
import { GOLD, GOLD_PALE, CYAN, INK, FROST, FIELD_LABEL_STYLE } from './theme';
import { TextField, TextAreaField } from './fields';

interface DashboardStepProps {
  childName: string;
  childGender: string | null;
  interest: Interest;
  plan: Plan;
  months: PlanMonth[];
  progress: NinetyDayPlan;
  onTrack: () => void;
  onDone: () => void;
}

const activityId = (month: PlanMonth, act: PlanActivity) => month.key + act.n;
const fieldKey = (activityId: string, fieldK: string) => `act:${activityId}:${fieldK}`;

export default function DashboardStep({
  childName,
  childGender,
  interest,
  plan,
  months,
  progress,
  onTrack,
  onDone,
}: DashboardStepProps) {
  const t = (text: string) => fillTemplate(text, childName, childGender);

  const doneCount = Object.values(progress.applied).filter(Boolean).length;
  const currentMonth = months[progress.monthIdx] ?? months[0];

  // Aggregate "ninety-day proof" stats across every activity in every month,
  // not just the one currently showing.
  let sessions = 0;
  let imports = 0;
  let fieldsFilled = 0;
  let fieldsTotal = 0;
  let metricBase = '';
  let metricBest = '';
  months.forEach((month) => {
    month.acts.forEach((act) => {
      const id = activityId(month, act);
      act.do.forEach((f) => {
        const key = fieldKey(id, f.k);
        fieldsTotal++;
        if (f.kind === 'count') {
          const c = progress.actCt[key] ?? 0;
          sessions += c;
          if (c >= adjTarget(progress.fb[id]?.tag, f.target)) fieldsFilled++;
        } else if (f.kind === 'photo') {
          const n = (progress.photoFiles[key] ?? []).length;
          imports += n;
          if (n) fieldsFilled++;
        } else {
          const val = (progress.actIn[key] ?? '').trim();
          if (val) fieldsFilled++;
          if (f.k === 'metricBase') metricBase = val;
          if (f.k === 'metricBest') metricBest = val;
        }
      });
    });
  });
  const proofMetric =
    metricBase && metricBest
      ? `${metricBase}  →  ${metricBest}`
      : metricBase
        ? `${metricBase}  →  —`
        : '—';

  const evOk = progress.evName.trim().length > 1 && !!progress.evDate;
  let evCountdown = '';
  let evCountLabel = '';
  let evDateLabel = '';
  if (progress.evSet && progress.evDate) {
    const target = new Date(`${progress.evDate}T00:00:00`);
    const days = Math.round((target.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
    evCountdown = String(Math.abs(days));
    evCountLabel =
      days > 0 ? (days === 1 ? 'Day away' : 'Days away') : days === 0 ? 'Today' : 'Days ago';
    evDateLabel = target.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  return (
    <div className="px-9 py-9">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div style={{ maxWidth: 560 }}>
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
            Built around {t(interest.label)}
          </div>
          <h3
            className="font-orbitron"
            style={{
              margin: '11px 0 0',
              fontWeight: 900,
              fontSize: 24,
              lineHeight: 1.2,
              color: 'rgb(var(--constellation-cyan-pale-rgb))',
            }}
          >
            {t("{name}'s ninety days")}
          </h3>
          <div
            style={{
              marginTop: 12,
              fontSize: 15.5,
              fontWeight: 700,
              lineHeight: 1.5,
              color: 'rgb(var(--constellation-gold-pale-rgb))',
            }}
          >
            {t(`Ninety days. ${interest.won}. Nine achievements, all earned outside the house.`)}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div
            className="whitespace-nowrap rounded-full px-4 py-2.5"
            style={{
              border: '1px solid rgb(var(--constellation-cyan-rgb) / .2)',
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: 'rgb(var(--constellation-slate-light-rgb))',
            }}
          >
            {doneCount}/9 earned
          </div>
          <div
            className="whitespace-nowrap rounded-full px-4 py-2.5"
            style={{
              border: '1px solid rgb(var(--constellation-gold-rgb) / .24)',
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: GOLD,
            }}
          >
            Day 1 of 90
          </div>
        </div>
      </div>

      {/* Day 90 target */}
      <div
        className="mt-8 rounded-[20px] p-6"
        style={{
          background:
            'linear-gradient(150deg,rgb(var(--constellation-gold-rgb) / .13),rgb(var(--constellation-ink-navy-rgb) / .72))',
          border: '1px solid rgb(var(--constellation-gold-rgb) / .3)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div style={{ maxWidth: 430 }}>
            <div className="flex items-center gap-2">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke={GOLD}
                strokeWidth="2.2"
                style={{ width: 13, height: 13, flexShrink: 0 }}
              >
                <path d="M5 21V4a1 1 0 011-1h11l-1.5 4L17 11H6" />
              </svg>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 10,
                  letterSpacing: '.2em',
                  textTransform: 'uppercase',
                  color: GOLD,
                }}
              >
                Day 90 target
              </div>
            </div>
            <div
              className="font-orbitron"
              style={{
                marginTop: 10,
                fontWeight: 700,
                fontSize: 16,
                lineHeight: 1.35,
                color: 'rgb(var(--constellation-cyan-pale-rgb))',
              }}
            >
              {progress.evSet ? progress.evName : t('Name the real event {he} is working towards.')}
            </div>
            {!progress.evSet && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13.5,
                  fontWeight: 600,
                  lineHeight: 1.45,
                  color: 'rgb(var(--constellation-slate-cool-rgb))',
                }}
              >
                One real thing, ninety days out, with other people watching. It turns practice into
                preparation.
              </div>
            )}
          </div>

          {!progress.evSet ? (
            <div
              className="flex flex-col gap-2.5"
              style={{ flex: 1, minWidth: 'min(300px, 100%)' }}
            >
              <div className="flex flex-wrap gap-2">
                {interest.ev.map((rawLabel) => {
                  const label = t(rawLabel);
                  return (
                    <button
                      key={rawLabel}
                      type="button"
                      onClick={() => progress.setEvName(label)}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 14px',
                        borderRadius: 999,
                        border: '1px solid rgb(var(--constellation-cyan-rgb) / .2)',
                        background: 'rgb(var(--constellation-ink-navy-rgb) / .7)',
                        fontWeight: 700,
                        fontSize: 12,
                        color: 'rgb(var(--constellation-slate-light-rgb))',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <label htmlFor="ev-name" className="sr-only">
                Event name
              </label>
              <input
                id="ev-name"
                value={progress.evName}
                onChange={(e) => progress.setEvName(e.target.value)}
                placeholder={t(interest.ev[0] ?? 'School showcase')}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '12px 15px',
                  borderRadius: 12,
                  background: 'rgb(var(--constellation-navy-deepest-rgb) / .85)',
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .22)',
                  color: FROST,
                  fontWeight: 700,
                  fontSize: 15.5,
                  outline: 'none',
                }}
              />
              <div className="flex flex-wrap items-center gap-2.5">
                <label htmlFor="ev-date" className="sr-only">
                  Event date
                </label>
                <input
                  id="ev-date"
                  type="date"
                  value={progress.evDate}
                  onChange={(e) => progress.setEvDate(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 150,
                    boxSizing: 'border-box',
                    padding: '12px 15px',
                    borderRadius: 12,
                    background: 'rgb(var(--constellation-navy-deepest-rgb) / .85)',
                    border: '1px solid rgb(var(--constellation-cyan-rgb) / .22)',
                    color: FROST,
                    fontWeight: 700,
                    fontSize: 15,
                    outline: 'none',
                    colorScheme: 'dark',
                  }}
                />
                <button
                  type="button"
                  onClick={progress.saveTarget}
                  disabled={!evOk}
                  className="font-orbitron"
                  style={{
                    cursor: evOk ? 'pointer' : 'not-allowed',
                    padding: '12px 26px',
                    borderRadius: 999,
                    border: 'none',
                    background: evOk
                      ? `linear-gradient(135deg,${CYAN},${GOLD})`
                      : 'rgb(var(--constellation-cyan-rgb) / .12)',
                    color: evOk ? INK : 'rgb(var(--constellation-slate-dim-rgb))',
                    fontWeight: 900,
                    fontSize: 11,
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Set target
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <div
                className="rounded-2xl px-5 py-3.5 text-center"
                style={{
                  background: 'rgb(var(--constellation-navy-deepest-rgb) / .7)',
                  border: '1px solid rgb(var(--constellation-gold-rgb) / .3)',
                }}
              >
                <div
                  className="font-orbitron"
                  style={{ fontWeight: 900, fontSize: 26, lineHeight: 1, color: GOLD }}
                >
                  {evCountdown}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontWeight: 700,
                    fontSize: 9.5,
                    letterSpacing: '.16em',
                    textTransform: 'uppercase',
                    color: 'rgb(var(--constellation-slate-warm-rgb))',
                  }}
                >
                  {evCountLabel}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: FROST }}>{evDateLabel}</div>
                <div className="mt-1.5 flex flex-wrap gap-3.5">
                  <button
                    type="button"
                    onClick={onTrack}
                    style={{
                      cursor: 'pointer',
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: GOLD,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Track it step by step →
                  </button>
                  {progress.isGeneratingTrackSteps && (
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: 'rgb(var(--constellation-slate-mute-rgb))',
                      }}
                    >
                      Personalizing your tracker…
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={progress.editTarget}
                    style={{
                      cursor: 'pointer',
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: CYAN,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Change target
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Month tabs */}
      <div className="mt-8 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-2.5">
        {months.map((m, idx) => {
          const on = idx === progress.monthIdx;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => progress.setMonthIdx(idx)}
              className="min-w-0 rounded-[14px] px-2.5 py-2 text-center sm:px-5 sm:py-2.5 sm:text-left"
              style={{
                cursor: 'pointer',
                border: `1px solid ${on ? 'rgb(var(--constellation-gold-rgb) / .55)' : 'rgb(var(--constellation-cyan-rgb) / .16)'}`,
                background: on
                  ? 'rgb(var(--constellation-gold-rgb) / .11)'
                  : 'rgb(var(--constellation-ink-navy-rgb) / .7)',
              }}
            >
              <div
                className="truncate"
                style={{
                  fontWeight: 700,
                  fontSize: 9.5,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: on
                    ? 'rgb(var(--constellation-gold-warm-rgb))'
                    : 'rgb(var(--constellation-slate-mute-rgb))',
                }}
              >
                {m.kicker}
              </div>
              <div
                className="mt-1 truncate font-orbitron"
                style={{
                  fontWeight: 700,
                  fontSize: 12.5,
                  color: on
                    ? 'rgb(var(--constellation-gold-pale-rgb))'
                    : 'rgb(var(--constellation-slate-light-rgb))',
                }}
              >
                {m.name}
              </div>
            </button>
          );
        })}
      </div>

      {/* Current month's achievement card */}
      {currentMonth && (
        <div
          className="mt-7 rounded-[18px] p-6"
          style={{
            background:
              'linear-gradient(150deg,rgb(var(--constellation-gold-rgb) / .12),rgb(var(--constellation-ink-navy-rgb) / .6))',
            border: '1px solid rgb(var(--constellation-gold-rgb) / .26)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div
              style={{
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: '.2em',
                textTransform: 'uppercase',
                color: GOLD,
              }}
            >
              The achievement this month
            </div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: 'rgb(var(--constellation-slate-light-rgb))',
              }}
            >
              {
                currentMonth.acts.filter((a) => progress.applied[activityId(currentMonth, a)])
                  .length
              }{' '}
              of 3 this month
            </div>
          </div>
          <div
            className="mt-2.5 font-orbitron"
            style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.35, color: FROST }}
          >
            {t(currentMonth.goal)}
          </div>

          <div className="mt-5 flex flex-col gap-2.5">
            {currentMonth.acts.map((act) => (
              <ActivityCard
                key={act.n}
                childName={childName}
                childGender={childGender}
                activityId={activityId(currentMonth, act)}
                act={act}
                progress={progress}
              />
            ))}
          </div>
        </div>
      )}

      {/* Ninety-day proof */}
      <div
        className="mt-6 rounded-2xl px-6 py-[22px]"
        style={{
          background: 'rgb(var(--constellation-navy-deepest-rgb) / .5)',
          border: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: '.2em',
            textTransform: 'uppercase',
            color: CYAN,
          }}
        >
          The ninety-day proof
        </div>
        <div
          className="mt-4 grid gap-[18px]"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}
        >
          {[
            { n: String(sessions), label: 'Sessions logged' },
            { n: String(imports), label: 'Pieces of work imported' },
            { n: `${doneCount}/9`, label: 'Achievements earned' },
            { n: `${fieldsFilled}/${fieldsTotal}`, label: 'Records kept in the app' },
          ].map((p) => (
            <div key={p.label}>
              <div
                className="font-orbitron"
                style={{ fontWeight: 700, fontSize: 24, color: FROST }}
              >
                {p.n}
              </div>
              <div
                className="mt-1"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  color: 'rgb(var(--constellation-slate-warm-rgb))',
                }}
              >
                {p.label}
              </div>
            </div>
          ))}
        </div>
        <div
          className="mt-[18px] flex flex-wrap items-baseline justify-between gap-4"
          style={{ paddingTop: 16, borderTop: '1px solid rgb(var(--constellation-cyan-rgb) / .1)' }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'rgb(var(--constellation-slate-light-rgb))',
            }}
          >
            {t(plan.metric)}
          </div>
          <div
            className="whitespace-nowrap font-orbitron"
            style={{
              fontWeight: 700,
              fontSize: 17,
              color:
                metricBase && metricBest
                  ? 'hsl(var(--success-bright))'
                  : 'rgb(var(--constellation-slate-mute-rgb))',
            }}
          >
            {proofMetric}
          </div>
        </div>
        <div
          className="mt-3.5"
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.5,
            color: 'rgb(var(--constellation-slate-mute-rgb))',
          }}
        >
          {doneCount === 9
            ? t(
                'Nine achievements, all of them done outside this app and recorded inside it. This is {his} ninety days.',
              )
            : t(
                'Every number here came from something {he} actually did. Nothing on this card was written by us.',
              )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'rgb(var(--constellation-slate-mute-rgb))',
          }}
        >
          {doneCount === 9
            ? t('All nine achievements earned. Month four is {his} to write.')
            : 'An achievement counts once it has actually happened outside the house.'}
        </div>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full px-7 py-3"
          style={{
            cursor: 'pointer',
            border: '1px solid rgb(var(--constellation-cyan-rgb) / .34)',
            background: 'rgb(var(--constellation-cyan-rgb) / .08)',
            fontFamily: 'Orbitron, sans-serif',
            fontWeight: 900,
            fontSize: 11.5,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: FROST,
          }}
        >
          Done for now
        </button>
      </div>
    </div>
  );
}

function ActivityCard({
  childName,
  childGender,
  activityId,
  act,
  progress,
}: {
  childName: string;
  childGender: string | null;
  activityId: string;
  act: PlanActivity;
  progress: NinetyDayPlan;
}) {
  const t = (text: string) => fillTemplate(text, childName, childGender);
  const on = !!progress.applied[activityId];
  const isOpen = progress.actOpen === activityId;
  const feedback = progress.fb[activityId];
  const draft = progress.fbDraft[activityId] ?? '';

  const nDone = act.do.filter((f) => {
    const key = fieldKey(activityId, f.k);
    if (f.kind === 'count') return (progress.actCt[key] ?? 0) >= adjTarget(feedback?.tag, f.target);
    if (f.kind === 'photo') return (progress.photoFiles[key] ?? []).length > 0;
    return (progress.actIn[key] ?? '').trim().length > 0;
  }).length;

  const adjustedFields = act.do
    .filter((f) => f.kind === 'count' && adjTarget(feedback?.tag, f.target) !== (f.target ?? 1))
    .map(
      (f) =>
        `${f.label.toLowerCase()}: ${adjTarget(feedback?.tag, f.target)} (was ${f.target ?? 1})`,
    );

  const timeLabel = feedback?.tag === 'No time this week' ? 'When you can' : act.time;
  const metaLabel = `${timeLabel} · ${on ? 'earned' : `${nDone}/${act.do.length} logged`}${feedback?.tag ? ' · adjusted' : ''}`;

  return (
    <div
      className="overflow-hidden rounded-[14px]"
      style={{
        background: 'rgb(var(--constellation-void-rgb) / .5)',
        border: `1px solid ${on ? 'rgb(var(--success-bright) / .4)' : 'rgb(var(--constellation-cyan-rgb) / .14)'}`,
      }}
    >
      <button
        type="button"
        onClick={() => progress.toggleActOpen(activityId)}
        className="flex w-full items-center gap-3.5 px-[18px] py-4 text-left"
        style={{ cursor: 'pointer' }}
      >
        <div
          className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full"
          style={{
            border: `1px solid ${on ? 'hsl(var(--success-bright) / .55)' : 'rgb(var(--constellation-cyan-rgb) / .2)'}`,
            background: on
              ? 'hsl(var(--success-bright) / .16)'
              : 'rgb(var(--constellation-void-rgb) / .6)',
          }}
        >
          {on ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="hsl(var(--success-bright))"
              strokeWidth="3"
              style={{ width: 10, height: 10 }}
            >
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgb(var(--constellation-slate-light-rgb))"
                strokeWidth="2.6"
                className="sm:hidden"
                style={{
                  width: 10,
                  height: 10,
                  transform: isOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform .2s ease',
                }}
              >
                <path d={isOpen ? 'M5 12h14' : 'M12 5v14M5 12h14'} />
              </svg>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgb(var(--constellation-cyan-rgb) / .22)"
                strokeWidth="3"
                className="hidden sm:block"
                style={{ width: 10, height: 10 }}
              >
                <path d="M4 12.5l5 5L20 6.5" />
              </svg>
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontWeight: 700,
              fontSize: 14.5,
              lineHeight: 1.3,
              color: on ? 'hsl(var(--success-bright))' : FROST,
            }}
          >
            {t(act.title)}
          </div>
          <div
            className="mt-0.5"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'rgb(var(--constellation-slate-mute-rgb))',
            }}
          >
            {metaLabel}
          </div>
        </div>
        <div
          className="hidden h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full sm:flex"
          style={{
            border: '1px solid rgb(var(--constellation-cyan-rgb) / .22)',
            background: 'rgb(var(--constellation-void-rgb) / .7)',
            color: 'rgb(var(--constellation-slate-light-rgb))',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            style={{
              width: 12,
              height: 12,
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform .2s ease',
            }}
          >
            <path d={isOpen ? 'M5 12h14' : 'M12 5v14M5 12h14'} />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="flex flex-col gap-3.5 px-[18px] pb-[18px] pt-0.5">
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.5,
              color: 'rgb(var(--constellation-slate-soft-rgb))',
            }}
          >
            {t(act.objective)}
          </div>
          {adjustedFields.length > 0 && (
            <div
              style={{
                marginTop: -6,
                fontSize: 12.5,
                fontWeight: 700,
                lineHeight: 1.45,
                color: GOLD,
              }}
            >
              Updated from your feedback — {adjustedFields.join(', ')}. Earn it at the new number.
            </div>
          )}

          {act.do.map((f) => (
            <ActivityField
              key={f.k}
              activityId={activityId}
              field={f}
              feedback={feedback}
              progress={progress}
              t={t}
            />
          ))}

          <div
            className="rounded-xl p-3.5"
            style={{
              border: '1px solid rgb(var(--constellation-cyan-rgb) / .12)',
              background: 'rgb(var(--constellation-void-rgb) / .55)',
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 9,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: 'rgb(var(--constellation-slate-warm-rgb))',
              }}
            >
              Your feedback as a parent
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {FB_TAGS.map((tag) => {
                const tagOn = feedback?.tag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => progress.setFeedbackTag(activityId, tag)}
                    style={{
                      cursor: 'pointer',
                      padding: '7px 13px',
                      borderRadius: 999,
                      border: `1px solid ${tagOn ? 'rgb(var(--constellation-gold-rgb) / .45)' : 'rgb(var(--constellation-cyan-rgb) / .16)'}`,
                      background: tagOn
                        ? 'rgb(var(--constellation-gold-rgb) / .14)'
                        : 'rgb(var(--constellation-void-rgb) / .6)',
                      fontWeight: 700,
                      fontSize: 11.5,
                      color: tagOn ? GOLD_PALE : 'rgb(var(--constellation-slate-light-rgb))',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 flex flex-wrap items-start gap-2">
              <textarea
                value={draft}
                onChange={(e) => progress.setFeedbackDraft(activityId, e.target.value)}
                placeholder="Anything else we should know"
                rows={2}
                style={{
                  flex: '1 1 160px',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgb(var(--constellation-void-rgb) / .7)',
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .14)',
                  fontFamily: 'inherit',
                  fontWeight: 700,
                  fontSize: 14,
                  lineHeight: 1.4,
                  color: FROST,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => progress.sendFeedbackNote(activityId)}
                style={{
                  cursor: 'pointer',
                  padding: '11px 16px',
                  borderRadius: 999,
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .3)',
                  background: 'rgb(var(--constellation-cyan-rgb) / .08)',
                  fontWeight: 800,
                  fontSize: 10,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                  color: 'rgb(var(--constellation-cyan-pale-rgb))',
                  whiteSpace: 'nowrap',
                }}
              >
                Send
              </button>
            </div>
            {(!!feedback?.tag || !!feedback?.note) && (
              <div
                className="mt-2.5 flex items-start gap-2 rounded-lg p-2.5"
                style={{
                  border: '1px solid hsl(var(--success-bright) / .3)',
                  background: 'hsl(var(--success-bright) / .09)',
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="hsl(var(--success-bright))"
                  strokeWidth="3"
                  style={{ width: 11, height: 11, flexShrink: 0, marginTop: 4 }}
                >
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: 1.45,
                    color: 'hsl(var(--success-bright))',
                  }}
                >
                  {feedback?.tag ??
                    'Noted and saved with this activity. The coach sees it before next month is set.'}
                </div>
              </div>
            )}
            {feedback?.note && (
              <div
                className="mt-2"
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  lineHeight: 1.45,
                  color: 'rgb(var(--constellation-slate-cool-rgb))',
                }}
              >
                You wrote: {feedback.note}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => progress.toggleApplied(activityId)}
            className="flex items-center justify-center gap-2 rounded-full py-2.5"
            style={{
              cursor: 'pointer',
              border: `1px solid ${on ? 'hsl(var(--success-bright) / .55)' : 'rgb(var(--constellation-gold-rgb) / .4)'}`,
              background: on
                ? 'hsl(var(--success-bright) / .16)'
                : 'rgb(var(--constellation-gold-rgb) / .1)',
              fontWeight: 800,
              fontSize: 10.5,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: on ? 'hsl(var(--success-bright))' : GOLD_PALE,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              style={{ width: 11, height: 11 }}
            >
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
            {on ? 'Earned' : 'Mark as earned'}
          </button>
        </div>
      )}
    </div>
  );
}

function ActivityField({
  activityId,
  field,
  feedback,
  progress,
  t,
}: {
  activityId: string;
  field: PlanActivity['do'][number];
  feedback: { tag?: FeedbackTag | null; note?: string } | undefined;
  progress: NinetyDayPlan;
  t: (text: string) => string;
}) {
  const key = fieldKey(activityId, field.k);
  const label = t(field.label);
  const placeholder = field.ph ? t(field.ph) : undefined;

  if (field.kind === 'text') {
    return (
      <TextField
        id={key}
        label={label}
        value={progress.actIn[key] ?? ''}
        onChange={(v) => progress.setActField(key, v)}
        placeholder={placeholder}
      />
    );
  }
  if (field.kind === 'area') {
    return (
      <TextAreaField
        id={key}
        label={label}
        value={progress.actIn[key] ?? ''}
        onChange={(v) => progress.setActField(key, v)}
        placeholder={placeholder}
        rows={2}
      />
    );
  }
  if (field.kind === 'date') {
    return (
      <TextField
        id={key}
        label={label}
        type="date"
        value={progress.actIn[key] ?? ''}
        onChange={(v) => progress.setActField(key, v)}
      />
    );
  }
  if (field.kind === 'num') {
    return (
      <TextField
        id={key}
        label={label}
        type="number"
        value={progress.actIn[key] ?? ''}
        onChange={(v) => progress.setActField(key, v)}
        placeholder={placeholder}
      />
    );
  }
  if (field.kind === 'count') {
    const target = adjTarget(feedback?.tag, field.target);
    const count = progress.actCt[key] ?? 0;
    const step = field.stepBy ?? 1;
    return (
      <div>
        <span style={FIELD_LABEL_STYLE}>{label}</span>
        <div className="mt-2 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => progress.decCount(key, step)}
            className="flex h-8 w-8 items-center justify-center rounded-[10px]"
            style={{
              cursor: 'pointer',
              border: '1px solid rgb(var(--constellation-cyan-rgb) / .16)',
              background: 'rgb(var(--constellation-void-rgb) / .7)',
              color: 'rgb(var(--constellation-slate-light-rgb))',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              style={{ width: 11, height: 11 }}
            >
              <path d="M5 12h14" />
            </svg>
          </button>
          <span style={{ fontWeight: 700, fontSize: 14, color: FROST, whiteSpace: 'nowrap' }}>
            {count} / {target}
          </span>
          <button
            type="button"
            onClick={() => progress.incCount(key, step)}
            className="ml-auto whitespace-nowrap rounded-full px-4 py-2"
            style={{
              cursor: 'pointer',
              border: '1px solid rgb(var(--constellation-gold-rgb) / .35)',
              background: 'rgb(var(--constellation-gold-rgb) / .08)',
              fontWeight: 800,
              fontSize: 10,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: GOLD_PALE,
            }}
          >
            {placeholder ?? 'Log one'}
          </button>
        </div>
      </div>
    );
  }
  // photo
  const files = progress.photoFiles[key] ?? [];
  return (
    <div>
      <span style={FIELD_LABEL_STYLE}>{label}</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {files.map((f, i) => (
          <div
            key={f.url}
            className="relative h-[58px] w-[58px] overflow-hidden rounded-[10px]"
            style={{
              border: '1px solid rgb(var(--constellation-cyan-rgb) / .2)',
              background: 'rgb(var(--constellation-void-rgb) / .7)',
            }}
          >
            <img src={f.url} alt={`Imported for ${label}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => progress.removePhoto(key, i)}
              className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full"
              style={{
                cursor: 'pointer',
                background: 'rgb(var(--constellation-void-rgb) / .9)',
                border: '1px solid rgb(var(--constellation-cyan-rgb) / .28)',
                color: 'rgb(var(--constellation-slate-light-rgb))',
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                style={{ width: 8, height: 8 }}
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
        <label
          className="flex h-[58px] w-[58px] items-center justify-center rounded-[10px]"
          style={{
            cursor: 'pointer',
            border: '1.5px dashed rgb(var(--constellation-cyan-rgb) / .24)',
            background: 'rgb(var(--constellation-void-rgb) / .5)',
            color: 'rgb(var(--constellation-slate-light-rgb))',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ width: 16, height: 16 }}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label={label}
            onChange={(e) => progress.addPhotos(key, e.target.files)}
          />
        </label>
      </div>
    </div>
  );
}
