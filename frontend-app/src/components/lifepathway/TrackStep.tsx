import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';

import { fillTemplate } from '@/lib/growthAreaData';
import type {
  TrackField,
  TrackStep as TrackStepData,
} from '@/lib/startJourneyPlans';
import type { NinetyDayPlan } from '@/hooks/useNinetyDayPlan';
import { rgb } from '@/theme';
import {
  GOLD,
  GOLD_PALE,
  CYAN,
  CYAN_PALE,
  FROST,
  FIELD_LABEL_STYLE,
  GRAD_CYAN_GOLD_90,
  SLATE_COOL,
  SLATE_DEEP,
  SLATE_LIGHT,
  SLATE_MUTE,
  SLATE_PALE,
  kicker,
  orb,
  rj,
} from './theme';
import { PhotoGrid, TextField, TextAreaField } from './fields';
import { BACK_ARROW_PATH, CHECK_PATH, Glyph } from './icons';

interface TrackStepProps {
  childName: string;
  childGender: string | null;
  progress: NinetyDayPlan;
  /** The LLM-generated-or-static 9-step sequence — see mergeTrackSteps in `@/lib/startJourneyPlans`. */
  steps: TrackStepData[];
  onBack: () => void;
}

const SITTING_WEEKS = [1, 2, 3, 4];
/** Rail button width at phone width (web `w-[62px]`). */
const RAIL_ITEM_W = 62;

const DETAIL_CARD_BG = `linear-gradient(150deg,${rgb(
  'constellation-gold',
  0.1,
)},${rgb('constellation-ink-navy', 0.6)})`;

/** First non-blank string, falling back to the last argument — an explicit
 * empty-string-aware alternative to `||`/`??` chaining. */
function firstFilled(...values: Array<string | undefined>): string {
  for (const v of values) {
    if (v?.trim()) return v;
  }
  return values[values.length - 1] ?? '';
}

export default function TrackStep({
  childName,
  childGender,
  progress,
  steps,
  onBack,
}: TrackStepProps) {
  const t = (text: string) => fillTemplate(text, childName, childGender);

  const trDoneCount = Object.values(progress.trDone).filter(Boolean).length;
  const nextIdx = steps.findIndex((_, k) => !progress.trDone[k]);
  const activeIdx = progress.trStep ?? (nextIdx === -1 ? 0 : nextIdx);
  const active = steps[activeIdx] ?? steps[0];

  // Web: activeRailBtn.scrollIntoView({ inline: 'center' }) on every change.
  const railRef = useRef<ScrollView | null>(null);
  const [railW, setRailW] = useState(0);
  useEffect(() => {
    if (!railW) return;
    const x = Math.max(0, activeIdx * RAIL_ITEM_W - (railW - RAIL_ITEM_W) / 2);
    railRef.current?.scrollTo({ x, animated: true });
  }, [activeIdx, railW]);

  const trName = firstFilled(
    progress.trIn.comp,
    progress.evName,
    'School showcase',
  );
  const nextTitle = t(steps[nextIdx]?.title ?? '');
  const trNow =
    nextIdx === -1
      ? `All ${steps.length} logged. Made, entered, shown.`
      : `Next: ${nextTitle.charAt(0).toLowerCase()}${nextTitle.slice(1)}.`;

  let trCountLabel = 'Date not set';
  if (progress.evDate) {
    const d = Math.round(
      (new Date(`${progress.evDate}T00:00:00`).getTime() -
        new Date().setHours(0, 0, 0, 0)) /
        86_400_000,
    );
    trCountLabel =
      d > 0
        ? `${d} ${d === 1 ? 'day away' : 'days away'}`
        : d === 0
        ? 'Today'
        : 'Held';
  }

  const isFirst = activeIdx === 0;
  const isLast = activeIdx === steps.length - 1;
  const activeDone = !!progress.trDone[activeIdx];

  return (
    <View style={{ paddingHorizontal: 36, paddingVertical: 36 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to the ninety days"
        onPress={onBack}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          alignSelf: 'flex-start',
        }}
      >
        <Glyph
          d={BACK_ARROW_PATH}
          size={12}
          stroke={SLATE_LIGHT}
          strokeWidth={2.4}
        />
        <Text style={kicker(11, 0.14, SLATE_LIGHT)}>
          Back to the ninety days
        </Text>
      </Pressable>

      <View style={{ marginTop: 20, gap: 24 }}>
        <View style={{ maxWidth: 560 }}>
          <Text style={kicker(10.5, 0.2, GOLD)}>Day 90 target</Text>
          <Text
            accessibilityRole="header"
            style={{
              ...orb(24, 900, CYAN_PALE),
              marginTop: 11,
              lineHeight: 24 * 1.2,
            }}
          >
            {trName}
          </Text>
          <Text
            style={{
              ...rj(15.5, 700, rgb('constellation-gold-pale')),
              marginTop: 12,
              lineHeight: 15.5 * 1.5,
            }}
          >
            {trNow}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: rgb('constellation-cyan', 0.2),
            }}
          >
            <Text numberOfLines={1} style={kicker(11, 0.12, SLATE_PALE)}>
              {trDoneCount}/{steps.length} steps done
            </Text>
          </View>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: rgb('constellation-gold', 0.24),
            }}
          >
            <Text numberOfLines={1} style={kicker(11, 0.12, GOLD)}>
              {trCountLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* Rail */}
      <View
        style={{
          marginTop: 28,
          borderRadius: 18,
          padding: 24,
          backgroundColor: rgb('constellation-void', 0.42),
          borderWidth: 1,
          borderColor: rgb('constellation-cyan', 0.1),
        }}
      >
        <ScrollView
          ref={railRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={e => setRailW(e.nativeEvent.layout.width)}
          contentContainerStyle={{ alignItems: 'flex-start' }}
        >
          {steps.map((step, k) => {
            const done = !!progress.trDone[k];
            const isNow = !done && k === nextIdx;
            const cl = done ? CYAN : isNow ? GOLD : SLATE_DEEP;
            const line = done
              ? rgb('constellation-cyan', 0.3)
              : rgb('constellation-cyan', 0.11);
            const short = t(step.short);
            return (
              <Pressable
                key={step.title}
                accessibilityRole="button"
                accessibilityLabel={`Step ${k + 1}: ${short}${
                  done ? ', done' : ''
                }`}
                accessibilityState={{ selected: k === activeIdx }}
                onPress={() => progress.setTrStep(k)}
                style={{ width: RAIL_ITEM_W, alignItems: 'center', gap: 10 }}
              >
                <View
                  style={{
                    width: '100%',
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <View style={{ height: 2, flex: 1, backgroundColor: line }} />
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1.5,
                      borderColor: cl,
                      backgroundColor: done
                        ? rgb('constellation-cyan', 0.16)
                        : isNow
                        ? rgb('constellation-gold', 0.14)
                        : rgb('constellation-ink-navy', 0.7),
                      boxShadow:
                        k === activeIdx
                          ? `0 0 0 4px ${rgb('constellation-gold', 0.22)}`
                          : undefined,
                    }}
                  >
                    <Text style={orb(10, 900, cl)}>{done ? '✓' : k + 1}</Text>
                  </View>
                  <View style={{ height: 2, flex: 1, backgroundColor: line }} />
                </View>
                <Text
                  style={{
                    ...kicker(9.5, 0.12, cl),
                    width: '100%',
                    textAlign: 'center',
                  }}
                >
                  {short}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View
          style={{
            marginTop: 18,
            height: 6,
            overflow: 'hidden',
            borderRadius: 999,
            backgroundColor: rgb('constellation-cyan', 0.09),
          }}
        >
          <Animated.View
            style={{
              height: '100%',
              width: `${
                steps.length
                  ? Math.round((trDoneCount / steps.length) * 100)
                  : 0
              }%`,
              experimental_backgroundImage: GRAD_CYAN_GOLD_90,
              transitionProperty: 'width',
              transitionDuration: 300,
              transitionTimingFunction: 'ease',
            }}
          />
        </View>
      </View>

      {/* Current step detail */}
      {active && (
        <View
          style={{
            marginTop: 24,
            borderRadius: 18,
            padding: 24,
            experimental_backgroundImage: DETAIL_CARD_BG,
            borderWidth: 1,
            borderColor: rgb('constellation-gold', 0.24),
          }}
        >
          {/* Web: flex-wrap justify-between — at phone width the text block
              fills the row and the step icon wraps beneath it. */}
          <View style={{ gap: 16 }}>
            <View>
              <Text style={kicker(10, 0.16, GOLD)}>
                Step {activeIdx + 1} of {steps.length} · {t(active.when)}
              </Text>
              <Text
                style={{
                  ...orb(19, 900, FROST),
                  marginTop: 8,
                  lineHeight: 19 * 1.3,
                }}
              >
                {t(active.title)}
              </Text>
              <Text
                style={{
                  ...rj(14, 600, SLATE_COOL),
                  marginTop: 8,
                  lineHeight: 14 * 1.5,
                }}
              >
                {t(active.body)}
              </Text>
            </View>
            <Glyph
              d={active.paths}
              size={40}
              viewBox="0 0 48 48"
              stroke={GOLD_PALE}
              strokeWidth={2}
              style={{ flexShrink: 0, opacity: 0.7 }}
            />
          </View>

          <View style={{ marginTop: 20, gap: 14 }}>
            {active.fields.map(f => (
              <TrackFieldInput key={f.k} field={f} progress={progress} t={t} />
            ))}

            {active.sittings && (
              <View>
                <Text style={FIELD_LABEL_STYLE}>Sittings logged</Text>
                <View style={{ marginTop: 8, flexDirection: 'row', gap: 8 }}>
                  {SITTING_WEEKS.map(week => {
                    const on = !!progress.trSit[week];
                    return (
                      <Pressable
                        key={week}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`Week ${week}`}
                        accessibilityState={{ checked: on }}
                        onPress={() => progress.toggleSitting(week)}
                        style={{
                          flex: 1,
                          borderRadius: 12,
                          paddingVertical: 10,
                          alignItems: 'center',
                          borderWidth: 1,
                          borderColor: on
                            ? rgb('constellation-cyan', 0.45)
                            : rgb('constellation-cyan', 0.16),
                          backgroundColor: on
                            ? rgb('constellation-cyan', 0.14)
                            : rgb('constellation-void', 0.7),
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={{
                            ...rj(
                              12.5,
                              700,
                              on
                                ? rgb('constellation-cyan-bright2')
                                : SLATE_PALE,
                            ),
                            textAlign: 'center',
                          }}
                        >
                          Week {week}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {active.up && (
              <TrackPhotoImport
                upKey={active.up.key}
                label={t(active.up.label)}
                hint={t(active.up.hint)}
                progress={progress}
              />
            )}
          </View>

          <View
            style={{
              marginTop: 24,
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous step"
                accessibilityState={{ disabled: isFirst }}
                disabled={isFirst}
                onPress={() => progress.setTrStep(Math.max(0, activeIdx - 1))}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: rgb('constellation-cyan', 0.2),
                  backgroundColor: rgb('constellation-void', 0.6),
                }}
              >
                <Text
                  style={kicker(11, 0.1, isFirst ? SLATE_DEEP : SLATE_PALE)}
                >
                  Back
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next step"
                accessibilityState={{ disabled: isLast }}
                disabled={isLast}
                onPress={() =>
                  progress.setTrStep(Math.min(steps.length - 1, activeIdx + 1))
                }
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: rgb('constellation-gold', 0.35),
                  backgroundColor: rgb('constellation-gold', 0.08),
                }}
              >
                <Text style={kicker(11, 0.1, isLast ? SLATE_DEEP : GOLD_PALE)}>
                  Next
                </Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={activeDone ? 'Done' : 'Mark done'}
              accessibilityState={{ checked: activeDone }}
              onPress={() => progress.toggleTrackDone(activeIdx)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderRadius: 999,
                paddingHorizontal: 20,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: activeDone
                  ? rgb('constellation-cyan', 0.4)
                  : rgb('constellation-cyan', 0.18),
                backgroundColor: activeDone
                  ? rgb('constellation-cyan', 0.14)
                  : rgb('constellation-void', 0.6),
              }}
            >
              <Glyph
                d={CHECK_PATH}
                size={11}
                stroke={
                  activeDone ? rgb('constellation-cyan-bright2') : SLATE_PALE
                }
                strokeWidth={2.6}
              />
              <Text
                style={kicker(
                  10.5,
                  0.12,
                  activeDone ? rgb('constellation-cyan-bright2') : SLATE_PALE,
                )}
              >
                {activeDone ? 'Done' : 'Mark done'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function TrackFieldInput({
  field,
  progress,
  t,
}: {
  field: TrackField;
  progress: NinetyDayPlan;
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
  progress: NinetyDayPlan;
}) {
  return (
    <View>
      <Text style={FIELD_LABEL_STYLE}>{label}</Text>
      <Text style={{ ...rj(12.5, 600, SLATE_MUTE), marginTop: 6 }}>{hint}</Text>
      <View style={{ marginTop: 10 }}>
        <PhotoGrid
          label={label}
          files={progress.photoFiles[upKey] ?? []}
          onAdd={photos => progress.addPhotos(upKey, photos)}
          onRemove={i => progress.removePhoto(upKey, i)}
          size={64}
          radius={12}
          dashedAlpha={0.26}
          plusSize={18}
        />
      </View>
    </View>
  );
}
