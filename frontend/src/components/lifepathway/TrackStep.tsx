import { useEffect, useRef } from 'react';
import { fillTemplate } from '@/lib/growthAreaData';
import { TRACK, type TrackField } from '@/lib/startJourneyPlans';
import type { NinetyDayProgress } from '@/hooks/useNinetyDayProgress';
import { GOLD, GOLD_PALE, CYAN, FROST, FIELD_LABEL_STYLE } from './theme';
import { TextField, TextAreaField } from './fields';

interface TrackStepProps {
  childName: string;
  childGender: string | null;
  progress: NinetyDayProgress;
  onBack: () => void;
}

const SITTING_WEEKS = [1, 2, 3, 4];

/** First non-blank string, falling back to the last argument — an explicit
 * empty-string-aware alternative to `||`/`??` chaining. */
function firstFilled(...values: Array<string | undefined>): string {
  for (const v of values) {
    if (v?.trim()) return v;
  }
  return values[values.length - 1] ?? '';
}

export default function TrackStep({ childName, childGender, progress, onBack }: TrackStepProps) {
  const t = (text: string) => fillTemplate(text, childName, childGender);

  const trDoneCount = Object.values(progress.trDone).filter(Boolean).length;
  const nextIdx = TRACK.findIndex((_, k) => !progress.trDone[k]);
  const activeIdx = progress.trStep ?? (nextIdx === -1 ? 0 : nextIdx);
  const active = TRACK[activeIdx] ?? TRACK[0];

  const activeRailBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRailBtnRef.current?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [activeIdx]);

  const trName = firstFilled(progress.trIn.comp, progress.evName, 'School showcase');
  const nextTitle = t(TRACK[nextIdx]?.title ?? '');
  const trNow =
    nextIdx === -1
      ? `All ${TRACK.length} logged. Made, entered, shown.`
      : `Next: ${nextTitle.charAt(0).toLowerCase()}${nextTitle.slice(1)}.`;

  let trCountLabel = 'Date not set';
  if (progress.evDate) {
    const d = Math.round(
      (new Date(`${progress.evDate}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) /
        86_400_000,
    );
    trCountLabel =
      d > 0 ? `${d} ${d === 1 ? 'day away' : 'days away'}` : d === 0 ? 'Today' : 'Held';
  }

  return (
    <div className="px-9 py-9">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2"
        style={{
          cursor: 'pointer',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'rgb(var(--constellation-slate-light-rgb))',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          style={{ width: 12, height: 12 }}
        >
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        Back to the ninety days
      </button>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
        <div style={{ maxWidth: 560 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 10.5,
              letterSpacing: '.2em',
              textTransform: 'uppercase',
              color: GOLD,
            }}
          >
            Day 90 target
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
            {trName}
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
            {trNow}
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
              color: 'rgb(var(--constellation-slate-pale-rgb))',
            }}
          >
            {trDoneCount}/{TRACK.length} steps done
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
            {trCountLabel}
          </div>
        </div>
      </div>

      {/* Rail */}
      <div
        className="relative mt-7 rounded-[18px] p-6"
        style={{
          background: 'rgb(var(--constellation-void-rgb) / .42)',
          border: '1px solid rgb(var(--constellation-cyan-rgb) / .1)',
        }}
      >
        <div className="flex items-start gap-0 overflow-x-auto">
          {TRACK.map((step, k) => {
            const done = !!progress.trDone[k];
            const isNow = !done && k === nextIdx;
            const cl = done ? CYAN : isNow ? GOLD : 'rgb(var(--constellation-slate-deep-rgb))';
            return (
              <button
                key={step.title}
                ref={k === activeIdx ? activeRailBtnRef : undefined}
                type="button"
                onClick={() => progress.setTrStep(k)}
                className="flex w-[62px] flex-shrink-0 flex-col items-center gap-2.5 sm:w-auto sm:min-w-0 sm:flex-1 sm:flex-shrink"
                style={{ cursor: 'pointer' }}
              >
                <div className="flex w-full items-center">
                  <div
                    className="h-[2px] flex-1"
                    style={{
                      background: done
                        ? 'rgb(var(--constellation-cyan-rgb) / .3)'
                        : 'rgb(var(--constellation-cyan-rgb) / .11)',
                    }}
                  />
                  <div
                    className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full"
                    style={{
                      border: `1.5px solid ${cl}`,
                      background: done
                        ? 'rgb(var(--constellation-cyan-rgb) / .16)'
                        : isNow
                          ? 'rgb(var(--constellation-gold-rgb) / .14)'
                          : 'rgb(var(--constellation-ink-navy-rgb) / .7)',
                      boxShadow:
                        k === activeIdx
                          ? '0 0 0 4px rgb(var(--constellation-gold-rgb) / .22)'
                          : 'none',
                    }}
                  >
                    <span
                      className="font-orbitron"
                      style={{ fontWeight: 900, fontSize: 10, color: cl }}
                    >
                      {done ? '✓' : k + 1}
                    </span>
                  </div>
                  <div
                    className="h-[2px] flex-1"
                    style={{
                      background: done
                        ? 'rgb(var(--constellation-cyan-rgb) / .3)'
                        : 'rgb(var(--constellation-cyan-rgb) / .11)',
                    }}
                  />
                </div>
                <div
                  style={{
                    width: '100%',
                    overflowWrap: 'break-word',
                    fontWeight: 700,
                    fontSize: 9.5,
                    letterSpacing: '.12em',
                    textTransform: 'uppercase',
                    color: cl,
                    textAlign: 'center',
                  }}
                >
                  {t(step.short)}
                </div>
              </button>
            );
          })}
        </div>
        <div
          className="mt-[18px] h-1.5 overflow-hidden rounded-full"
          style={{ background: 'rgb(var(--constellation-cyan-rgb) / .09)' }}
        >
          <div
            className="h-full"
            style={{
              width: `${Math.round((trDoneCount / TRACK.length) * 100)}%`,
              background: `linear-gradient(90deg,${CYAN},${GOLD})`,
              transition: 'width .3s ease',
            }}
          />
        </div>
      </div>

      {/* Current step detail */}
      {active && (
        <div
          className="mt-6 rounded-[18px] p-6"
          style={{
            background:
              'linear-gradient(150deg,rgb(var(--constellation-gold-rgb) / .1),rgb(var(--constellation-ink-navy-rgb) / .6))',
            border: '1px solid rgb(var(--constellation-gold-rgb) / .24)',
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 10,
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: GOLD,
                }}
              >
                Step {activeIdx + 1} of {TRACK.length} · {t(active.when)}
              </div>
              <div
                className="mt-2 font-orbitron"
                style={{ fontWeight: 900, fontSize: 19, lineHeight: 1.3, color: FROST }}
              >
                {t(active.title)}
              </div>
              <div
                className="mt-2"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: 1.5,
                  color: 'rgb(var(--constellation-slate-cool-rgb))',
                }}
              >
                {t(active.body)}
              </div>
            </div>
            <svg
              viewBox="0 0 48 48"
              fill="none"
              stroke={GOLD_PALE}
              strokeWidth="2"
              style={{ width: 40, height: 40, flexShrink: 0, opacity: 0.7 }}
            >
              {active.paths.map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
          </div>

          <div className="mt-5 flex flex-col gap-3.5">
            {active.fields.map((f) => (
              <TrackFieldInput key={f.k} field={f} progress={progress} t={t} />
            ))}

            {active.sittings && (
              <div>
                <span style={FIELD_LABEL_STYLE}>Sittings logged</span>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {SITTING_WEEKS.map((week) => {
                    const on = !!progress.trSit[week];
                    return (
                      <button
                        key={week}
                        type="button"
                        onClick={() => progress.toggleSitting(week)}
                        className="rounded-xl py-2.5 text-center"
                        style={{
                          cursor: 'pointer',
                          border: `1px solid ${on ? 'rgb(var(--constellation-cyan-rgb) / .45)' : 'rgb(var(--constellation-cyan-rgb) / .16)'}`,
                          background: on
                            ? 'rgb(var(--constellation-cyan-rgb) / .14)'
                            : 'rgb(var(--constellation-void-rgb) / .7)',
                          fontWeight: 700,
                          fontSize: 12.5,
                          color: on
                            ? 'rgb(var(--constellation-cyan-bright2-rgb))'
                            : 'rgb(var(--constellation-slate-pale-rgb))',
                        }}
                      >
                        Week {week}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {active.up && (
              <TrackPhotoImport
                upKey={active.up.key}
                label={t(active.up.label)}
                hint={t(active.up.hint)}
                progress={progress}
              />
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-3">
              <button
                type="button"
                disabled={activeIdx === 0}
                onClick={() => progress.setTrStep(Math.max(0, activeIdx - 1))}
                className="rounded-full px-5 py-2.5"
                style={{
                  cursor: activeIdx === 0 ? 'default' : 'pointer',
                  border: '1px solid rgb(var(--constellation-cyan-rgb) / .2)',
                  background: 'rgb(var(--constellation-void-rgb) / .6)',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color:
                    activeIdx === 0
                      ? 'rgb(var(--constellation-slate-deep-rgb))'
                      : 'rgb(var(--constellation-slate-pale-rgb))',
                }}
              >
                Back
              </button>
              <button
                type="button"
                disabled={activeIdx === TRACK.length - 1}
                onClick={() => progress.setTrStep(Math.min(TRACK.length - 1, activeIdx + 1))}
                className="rounded-full px-5 py-2.5"
                style={{
                  cursor: activeIdx === TRACK.length - 1 ? 'default' : 'pointer',
                  border: '1px solid rgb(var(--constellation-gold-rgb) / .35)',
                  background: 'rgb(var(--constellation-gold-rgb) / .08)',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color:
                    activeIdx === TRACK.length - 1
                      ? 'rgb(var(--constellation-slate-deep-rgb))'
                      : GOLD_PALE,
                }}
              >
                Next
              </button>
            </div>
            <button
              type="button"
              onClick={() => progress.toggleTrackDone(activeIdx)}
              className="flex items-center gap-2 rounded-full px-5 py-2.5"
              style={{
                cursor: 'pointer',
                border: `1px solid ${progress.trDone[activeIdx] ? 'rgb(var(--constellation-cyan-rgb) / .4)' : 'rgb(var(--constellation-cyan-rgb) / .18)'}`,
                background: progress.trDone[activeIdx]
                  ? 'rgb(var(--constellation-cyan-rgb) / .14)'
                  : 'rgb(var(--constellation-void-rgb) / .6)',
                fontWeight: 700,
                fontSize: 10.5,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: progress.trDone[activeIdx]
                  ? 'rgb(var(--constellation-cyan-bright2-rgb))'
                  : 'rgb(var(--constellation-slate-pale-rgb))',
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                style={{ width: 11, height: 11 }}
              >
                <path d="M4 12.5l5 5L20 6.5" />
              </svg>
              {progress.trDone[activeIdx] ? 'Done' : 'Mark done'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrackFieldInput({
  field,
  progress,
  t,
}: {
  field: TrackField;
  progress: NinetyDayProgress;
  t: (text: string) => string;
}) {
  const label = t(field.label);
  const placeholder = field.ph ? t(field.ph) : undefined;
  const value = progress.trIn[field.k] ?? '';
  const onChange = (v: string) => progress.setTrackField(field.k, v);

  if (field.type === 'date') {
    return (
      <TextField
        id={`track-${field.k}`}
        label={label}
        type="date"
        value={value}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'note') {
    return (
      <TextAreaField
        id={`track-${field.k}`}
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={2}
      />
    );
  }
  return (
    <TextField
      id={`track-${field.k}`}
      label={label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}

function TrackPhotoImport({
  upKey,
  label,
  hint,
  progress,
}: {
  upKey: string;
  label: string;
  hint: string;
  progress: NinetyDayProgress;
}) {
  const files = progress.photoFiles[upKey] ?? [];
  return (
    <div>
      <span style={FIELD_LABEL_STYLE}>{label}</span>
      <div
        className="mt-1.5"
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: 'rgb(var(--constellation-slate-mute-rgb))',
        }}
      >
        {hint}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {files.map((f, i) => (
          <div
            key={f.url}
            className="relative h-[64px] w-[64px] overflow-hidden rounded-xl"
            style={{
              border: '1px solid rgb(var(--constellation-cyan-rgb) / .2)',
              background: 'rgb(var(--constellation-void-rgb) / .7)',
            }}
          >
            <img src={f.url} alt={`Imported for ${label}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => progress.removePhoto(upKey, i)}
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
          className="flex h-[64px] w-[64px] items-center justify-center rounded-xl"
          style={{
            cursor: 'pointer',
            border: '1.5px dashed rgb(var(--constellation-cyan-rgb) / .26)',
            background: 'rgb(var(--constellation-void-rgb) / .5)',
            color: 'rgb(var(--constellation-slate-light-rgb))',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ width: 18, height: 18 }}
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label={label}
            onChange={(e) => progress.addPhotos(upKey, e.target.files)}
          />
        </label>
      </div>
    </div>
  );
}
