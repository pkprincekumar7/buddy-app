import { Text, TextInput, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';

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
import { hsl, rgb } from '@/theme';
import {
  GOLD,
  GOLD_PALE,
  CYAN,
  CYAN_PALE,
  INK,
  FROST,
  FIELD_LABEL_STYLE,
  GRAD_CYAN_GOLD_135,
  PLACEHOLDER,
  SLATE_COOL,
  SLATE_LIGHT,
  SLATE_MUTE,
  SLATE_WARM,
  SUCCESS,
  kicker,
  orb,
  rj,
} from './theme';
import { DateInput, PhotoGrid, TextField, TextAreaField } from './fields';
import { CHECK_PATH, FLAG_PATH, Glyph, MINUS_PATH, PLUS_PATH } from './icons';

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

const activityIdOf = (month: PlanMonth, act: PlanActivity) => month.key + act.n;
const fieldKey = (actId: string, fieldK: string) => `act:${actId}:${fieldK}`;

const TARGET_CARD_BG = `linear-gradient(150deg,${rgb(
  'constellation-gold',
  0.13,
)},${rgb('constellation-ink-navy', 0.72)})`;
const MONTH_CARD_BG = `linear-gradient(150deg,${rgb(
  'constellation-gold',
  0.12,
)},${rgb('constellation-ink-navy', 0.6)})`;

const EV_INPUT = {
  paddingVertical: 12,
  paddingHorizontal: 15,
  borderRadius: 12,
  backgroundColor: rgb('constellation-navy-deepest', 0.85),
  borderWidth: 1,
  borderColor: rgb('constellation-cyan', 0.22),
  ...rj(15.5, 700, FROST),
} as const;

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
  months.forEach(month => {
    month.acts.forEach(act => {
      const id = activityIdOf(month, act);
      act.do.forEach(f => {
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
    const days = Math.round(
      (target.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
    );
    evCountdown = String(Math.abs(days));
    evCountLabel =
      days > 0
        ? days === 1
          ? 'Day away'
          : 'Days away'
        : days === 0
        ? 'Today'
        : 'Days ago';
    evDateLabel = target.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  const pill = (
    borderAlpha: number,
    borderToken: string,
    textColor: string,
    label: string,
  ) => (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: rgb(borderToken, borderAlpha),
      }}
    >
      <Text numberOfLines={1} style={kicker(11, 0.12, textColor)}>
        {label}
      </Text>
    </View>
  );

  return (
    <View style={{ paddingHorizontal: 36, paddingVertical: 36 }}>
      <View style={{ gap: 24 }}>
        <View style={{ maxWidth: 560 }}>
          <Text
            style={{ ...orb(10.5, 700, GOLD, 0.2), textTransform: 'uppercase' }}
          >
            Built around {t(interest.label)}
          </Text>
          <Text
            accessibilityRole="header"
            style={{
              ...orb(24, 900, CYAN_PALE),
              marginTop: 11,
              lineHeight: 24 * 1.2,
            }}
          >
            {t("{name}'s ninety days")}
          </Text>
          <Text
            style={{
              ...rj(15.5, 700, GOLD_PALE),
              marginTop: 12,
              lineHeight: 15.5 * 1.5,
            }}
          >
            {t(
              `Ninety days. ${interest.won}. Nine achievements, all earned outside the house.`,
            )}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {pill(
            0.2,
            'constellation-cyan',
            SLATE_LIGHT,
            `${doneCount}/9 earned`,
          )}
          {pill(0.24, 'constellation-gold', GOLD, 'Day 1 of 90')}
        </View>
      </View>

      {/* Day 90 target */}
      <View
        style={{
          marginTop: 32,
          borderRadius: 20,
          padding: 24,
          experimental_backgroundImage: TARGET_CARD_BG,
          borderWidth: 1,
          borderColor: rgb('constellation-gold', 0.3),
          gap: 20,
        }}
      >
        <View style={{ maxWidth: 430 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Glyph d={FLAG_PATH} size={13} stroke={GOLD} strokeWidth={2.2} />
            <Text style={kicker(10, 0.2, GOLD)}>Day 90 target</Text>
          </View>
          <Text
            style={{
              ...orb(16, 700, CYAN_PALE),
              marginTop: 10,
              lineHeight: 16 * 1.35,
            }}
          >
            {progress.evSet
              ? progress.evName
              : t('Name the real event {he} is working towards.')}
          </Text>
          {!progress.evSet && (
            <Text
              style={{
                ...rj(13.5, 600, SLATE_COOL),
                marginTop: 8,
                lineHeight: 13.5 * 1.45,
              }}
            >
              One real thing, ninety days out, with other people watching. It
              turns practice into preparation.
            </Text>
          )}
        </View>

        {!progress.evSet ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {interest.ev.map(rawLabel => {
                const label = t(rawLabel);
                return (
                  <Pressable
                    key={rawLabel}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    onPress={() => progress.setEvName(label)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: rgb('constellation-cyan', 0.2),
                      backgroundColor: rgb('constellation-ink-navy', 0.7),
                    }}
                  >
                    <Text style={rj(12, 700, SLATE_LIGHT)}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              accessibilityLabel="Event name"
              value={progress.evName}
              onChangeText={progress.setEvName}
              placeholder={t(interest.ev[0] ?? 'School showcase')}
              placeholderTextColor={PLACEHOLDER}
              style={EV_INPUT}
            />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <View style={{ flexGrow: 1, flexBasis: 150 }}>
                <DateInput
                  label="Event date"
                  value={progress.evDate}
                  onChange={progress.setEvDate}
                  style={{ ...EV_INPUT, fontSize: 15 }}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set target"
                accessibilityState={{ disabled: !evOk }}
                disabled={!evOk}
                onPress={progress.saveTarget}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 26,
                  borderRadius: 999,
                  ...(evOk
                    ? { experimental_backgroundImage: GRAD_CYAN_GOLD_135 }
                    : { backgroundColor: rgb('constellation-cyan', 0.12) }),
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    ...orb(
                      11,
                      900,
                      evOk ? INK : rgb('constellation-slate-dim'),
                      0.14,
                    ),
                    textTransform: 'uppercase',
                  }}
                >
                  Set target
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <View
              style={{
                borderRadius: 16,
                paddingHorizontal: 20,
                paddingVertical: 14,
                alignItems: 'center',
                backgroundColor: rgb('constellation-navy-deepest', 0.7),
                borderWidth: 1,
                borderColor: rgb('constellation-gold', 0.3),
              }}
            >
              <Text
                style={{
                  ...orb(26, 900, GOLD),
                  lineHeight: 26,
                  textAlign: 'center',
                }}
              >
                {evCountdown}
              </Text>
              <Text
                style={{
                  ...kicker(9.5, 0.16, SLATE_WARM),
                  marginTop: 6,
                  textAlign: 'center',
                }}
              >
                {evCountLabel}
              </Text>
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text style={rj(13.5, 700, FROST)}>{evDateLabel}</Text>
              <View
                style={{
                  marginTop: 6,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 14,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Track it step by step"
                  onPress={onTrack}
                >
                  <Text numberOfLines={1} style={rj(12.5, 700, GOLD)}>
                    Track it step by step →
                  </Text>
                </Pressable>
                {progress.isGeneratingTrackSteps && (
                  <Text style={rj(12.5, 600, SLATE_MUTE)}>
                    Personalizing your tracker…
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change target"
                  onPress={progress.editTarget}
                >
                  <Text numberOfLines={1} style={rj(12.5, 700, CYAN)}>
                    Change target
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Month tabs */}
      <View style={{ marginTop: 32, flexDirection: 'row', gap: 8 }}>
        {months.map((m, idx) => {
          const on = idx === progress.monthIdx;
          return (
            <Pressable
              key={m.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${m.kicker}: ${m.name}`}
              onPress={() => progress.setMonthIdx(idx)}
              style={{
                flex: 1,
                minWidth: 0,
                borderRadius: 14,
                paddingHorizontal: 10,
                paddingVertical: 8,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: on
                  ? rgb('constellation-gold', 0.55)
                  : rgb('constellation-cyan', 0.16),
                backgroundColor: on
                  ? rgb('constellation-gold', 0.11)
                  : rgb('constellation-ink-navy', 0.7),
              }}
            >
              <Text
                numberOfLines={1}
                style={kicker(
                  9.5,
                  0.1,
                  on
                    ? rgb('constellation-gold-warm')
                    : rgb('constellation-slate-mute'),
                )}
              >
                {m.kicker}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  ...orb(
                    12.5,
                    700,
                    on ? rgb('constellation-gold-pale') : SLATE_LIGHT,
                  ),
                  marginTop: 4,
                }}
              >
                {m.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Current month's achievement card */}
      {currentMonth && (
        <View
          style={{
            marginTop: 28,
            borderRadius: 18,
            padding: 24,
            experimental_backgroundImage: MONTH_CARD_BG,
            borderWidth: 1,
            borderColor: rgb('constellation-gold', 0.26),
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <Text style={kicker(10, 0.2, GOLD)}>
              The achievement this month
            </Text>
            <Text style={kicker(10, 0.12, SLATE_LIGHT)}>
              {
                currentMonth.acts.filter(
                  a => progress.applied[activityIdOf(currentMonth, a)],
                ).length
              }{' '}
              of 3 this month
            </Text>
          </View>
          <Text
            style={{
              ...orb(17, 700, FROST),
              marginTop: 10,
              lineHeight: 17 * 1.35,
            }}
          >
            {t(currentMonth.goal)}
          </Text>

          <View style={{ marginTop: 20, gap: 10 }}>
            {currentMonth.acts.map(act => (
              <ActivityCard
                key={act.n}
                childName={childName}
                childGender={childGender}
                activityId={activityIdOf(currentMonth, act)}
                act={act}
                progress={progress}
              />
            ))}
          </View>
        </View>
      )}

      {/* Ninety-day proof */}
      <View
        style={{
          marginTop: 24,
          borderRadius: 16,
          paddingHorizontal: 24,
          paddingVertical: 22,
          backgroundColor: rgb('constellation-navy-deepest', 0.5),
          borderWidth: 1,
          borderColor: rgb('constellation-cyan', 0.14),
        }}
      >
        <Text style={kicker(10, 0.2, CYAN)}>The ninety-day proof</Text>
        <View
          style={{
            marginTop: 16,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 18,
          }}
        >
          {[
            { n: String(sessions), label: 'Sessions logged' },
            { n: String(imports), label: 'Pieces of work imported' },
            { n: `${doneCount}/9`, label: 'Achievements earned' },
            {
              n: `${fieldsFilled}/${fieldsTotal}`,
              label: 'Records kept in the app',
            },
          ].map(p => (
            <View key={p.label} style={{ flexGrow: 1, flexBasis: 140 }}>
              <Text style={orb(24, 700, FROST)}>{p.n}</Text>
              <Text
                style={{
                  ...rj(12, 600, SLATE_WARM),
                  marginTop: 4,
                  lineHeight: 12 * 1.4,
                }}
              >
                {p.label}
              </Text>
            </View>
          ))}
        </View>
        <View
          style={{
            marginTop: 18,
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: rgb('constellation-cyan', 0.1),
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <Text style={rj(12, 700, SLATE_LIGHT)}>{t(plan.metric)}</Text>
          <Text
            numberOfLines={1}
            style={orb(
              17,
              700,
              metricBase && metricBest ? SUCCESS : SLATE_MUTE,
            )}
          >
            {proofMetric}
          </Text>
        </View>
        <Text
          style={{
            ...rj(12.5, 600, SLATE_MUTE),
            marginTop: 14,
            lineHeight: 12.5 * 1.5,
          }}
        >
          {doneCount === 9
            ? t(
                'Nine achievements, all of them done outside this app and recorded inside it. This is {his} ninety days.',
              )
            : t(
                'Every number here came from something {he} actually did. Nothing on this card was written by us.',
              )}
        </Text>
      </View>

      <View style={{ marginTop: 24, gap: 16 }}>
        <Text style={rj(13, 600, SLATE_MUTE)}>
          {doneCount === 9
            ? t('All nine achievements earned. Month four is {his} to write.')
            : 'An achievement counts once it has actually happened outside the house.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done for now"
          onPress={onDone}
          style={{
            alignSelf: 'flex-start',
            borderRadius: 999,
            paddingHorizontal: 28,
            paddingVertical: 12,
            borderWidth: 1,
            borderColor: rgb('constellation-cyan', 0.34),
            backgroundColor: rgb('constellation-cyan', 0.08),
          }}
        >
          <Text
            style={{
              ...orb(11.5, 900, FROST, 0.14),
              textTransform: 'uppercase',
            }}
          >
            Done for now
          </Text>
        </Pressable>
      </View>
    </View>
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

  const nDone = act.do.filter(f => {
    const key = fieldKey(activityId, f.k);
    if (f.kind === 'count')
      return (progress.actCt[key] ?? 0) >= adjTarget(feedback?.tag, f.target);
    if (f.kind === 'photo') return (progress.photoFiles[key] ?? []).length > 0;
    return (progress.actIn[key] ?? '').trim().length > 0;
  }).length;

  const adjustedFields = act.do
    .filter(
      f =>
        f.kind === 'count' &&
        adjTarget(feedback?.tag, f.target) !== (f.target ?? 1),
    )
    .map(
      f =>
        `${f.label.toLowerCase()}: ${adjTarget(feedback?.tag, f.target)} (was ${
          f.target ?? 1
        })`,
    );

  const timeLabel =
    feedback?.tag === 'No time this week' ? 'When you can' : act.time;
  const metaLabel = `${timeLabel} · ${
    on ? 'earned' : `${nDone}/${act.do.length} logged`
  }${feedback?.tag ? ' · adjusted' : ''}`;
  const title = t(act.title);

  return (
    <View
      style={{
        overflow: 'hidden',
        borderRadius: 14,
        backgroundColor: rgb('constellation-void', 0.5),
        borderWidth: 1,
        borderColor: on
          ? hsl('success-bright', 0.4)
          : rgb('constellation-cyan', 0.14),
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${metaLabel}`}
        accessibilityState={{ expanded: isOpen }}
        onPress={() => progress.toggleActOpen(activityId)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingHorizontal: 18,
          paddingVertical: 16,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: on
              ? hsl('success-bright', 0.55)
              : rgb('constellation-cyan', 0.2),
            backgroundColor: on
              ? hsl('success-bright', 0.16)
              : rgb('constellation-void', 0.6),
          }}
        >
          {on ? (
            <Glyph d={CHECK_PATH} size={10} stroke={SUCCESS} strokeWidth={3} />
          ) : (
            <Animated.View
              style={{
                transform: [{ rotate: isOpen ? '180deg' : '0deg' }],
                transitionProperty: 'transform',
                transitionDuration: 200,
                transitionTimingFunction: 'ease',
              }}
            >
              <Glyph
                d={isOpen ? MINUS_PATH : PLUS_PATH}
                size={10}
                stroke={SLATE_LIGHT}
                strokeWidth={2.6}
              />
            </Animated.View>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              ...rj(14.5, 700, on ? SUCCESS : FROST),
              lineHeight: 14.5 * 1.3,
            }}
          >
            {title}
          </Text>
          <Text style={{ ...rj(12, 600, SLATE_MUTE), marginTop: 2 }}>
            {metaLabel}
          </Text>
        </View>
      </Pressable>

      {isOpen && (
        <View
          style={{
            gap: 14,
            paddingHorizontal: 18,
            paddingBottom: 18,
            paddingTop: 2,
          }}
        >
          <Text
            style={{
              ...rj(13, 600, rgb('constellation-slate-soft')),
              lineHeight: 13 * 1.5,
            }}
          >
            {t(act.objective)}
          </Text>
          {adjustedFields.length > 0 && (
            <Text
              style={{
                ...rj(12.5, 700, GOLD),
                marginTop: -6,
                lineHeight: 12.5 * 1.45,
              }}
            >
              Updated from your feedback — {adjustedFields.join(', ')}. Earn it
              at the new number.
            </Text>
          )}

          {act.do.map(f => (
            <ActivityField
              key={f.k}
              activityId={activityId}
              field={f}
              feedback={feedback}
              progress={progress}
              t={t}
            />
          ))}

          <View
            style={{
              borderRadius: 12,
              padding: 14,
              borderWidth: 1,
              borderColor: rgb('constellation-cyan', 0.12),
              backgroundColor: rgb('constellation-void', 0.55),
            }}
          >
            <Text style={kicker(9, 0.16, SLATE_WARM)}>
              Your feedback as a parent
            </Text>
            <View
              style={{
                marginTop: 10,
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              {FB_TAGS.map(tag => {
                const tagOn = feedback?.tag === tag;
                return (
                  <Pressable
                    key={tag}
                    accessibilityRole="button"
                    accessibilityLabel={tag}
                    accessibilityState={{ selected: tagOn }}
                    onPress={() => progress.setFeedbackTag(activityId, tag)}
                    style={{
                      paddingVertical: 7,
                      paddingHorizontal: 13,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: tagOn
                        ? rgb('constellation-gold', 0.45)
                        : rgb('constellation-cyan', 0.16),
                      backgroundColor: tagOn
                        ? rgb('constellation-gold', 0.14)
                        : rgb('constellation-void', 0.6),
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={rj(11.5, 700, tagOn ? GOLD_PALE : SLATE_LIGHT)}
                    >
                      {tag}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View
              style={{
                marginTop: 10,
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <TextInput
                accessibilityLabel="Anything else we should know"
                value={draft}
                onChangeText={v => progress.setFeedbackDraft(activityId, v)}
                placeholder="Anything else we should know"
                placeholderTextColor={PLACEHOLDER}
                multiline
                textAlignVertical="top"
                style={{
                  flexGrow: 1,
                  flexShrink: 1,
                  flexBasis: 160,
                  minHeight: 2 * 14 * 1.4 + 20,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  backgroundColor: rgb('constellation-void', 0.7),
                  borderWidth: 1,
                  borderColor: rgb('constellation-cyan', 0.14),
                  ...rj(14, 700, FROST),
                  lineHeight: 14 * 1.4,
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send feedback"
                onPress={() => progress.sendFeedbackNote(activityId)}
                style={{
                  paddingVertical: 11,
                  paddingHorizontal: 16,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: rgb('constellation-cyan', 0.3),
                  backgroundColor: rgb('constellation-cyan', 0.08),
                }}
              >
                <Text
                  numberOfLines={1}
                  style={kicker(10, 0.12, CYAN_PALE, 800)}
                >
                  Send
                </Text>
              </Pressable>
            </View>
            {(!!feedback?.tag || !!feedback?.note) && (
              <View
                style={{
                  marginTop: 10,
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 8,
                  borderRadius: 8,
                  padding: 10,
                  borderWidth: 1,
                  borderColor: hsl('success-bright', 0.3),
                  backgroundColor: hsl('success-bright', 0.09),
                }}
              >
                <Glyph
                  d={CHECK_PATH}
                  size={11}
                  stroke={SUCCESS}
                  strokeWidth={3}
                  style={{ marginTop: 4, flexShrink: 0 }}
                />
                <Text
                  style={{
                    ...rj(13, 700, SUCCESS),
                    flex: 1,
                    lineHeight: 13 * 1.45,
                  }}
                >
                  {feedback?.tag ??
                    'Noted and saved with this activity. The coach sees it before next month is set.'}
                </Text>
              </View>
            )}
            {feedback?.note && (
              <Text
                style={{
                  ...rj(12.5, 600, SLATE_COOL),
                  marginTop: 8,
                  lineHeight: 12.5 * 1.45,
                }}
              >
                You wrote: {feedback.note}
              </Text>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={on ? 'Earned' : 'Mark as earned'}
            accessibilityState={{ checked: on }}
            onPress={() => progress.toggleApplied(activityId)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 999,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: on
                ? hsl('success-bright', 0.55)
                : rgb('constellation-gold', 0.4),
              backgroundColor: on
                ? hsl('success-bright', 0.16)
                : rgb('constellation-gold', 0.1),
            }}
          >
            <Glyph
              d={CHECK_PATH}
              size={11}
              stroke={on ? SUCCESS : GOLD_PALE}
              strokeWidth={3}
            />
            <Text style={kicker(10.5, 0.14, on ? SUCCESS : GOLD_PALE, 800)}>
              {on ? 'Earned' : 'Mark as earned'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
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
        onChange={v => progress.setActField(key, v)}
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
        onChange={v => progress.setActField(key, v)}
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
        onChange={v => progress.setActField(key, v)}
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
        onChange={v => progress.setActField(key, v)}
        placeholder={placeholder}
      />
    );
  }
  if (field.kind === 'count') {
    const target = adjTarget(feedback?.tag, field.target);
    const count = progress.actCt[key] ?? 0;
    const step = field.stepBy ?? 1;
    return (
      <View>
        <Text style={FIELD_LABEL_STYLE}>{label}</Text>
        <View
          style={{
            marginTop: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove one from ${label}`}
            onPress={() => progress.decCount(key, step)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: rgb('constellation-cyan', 0.16),
              backgroundColor: rgb('constellation-void', 0.7),
            }}
          >
            <Glyph
              d={MINUS_PATH}
              size={11}
              stroke={SLATE_LIGHT}
              strokeWidth={2.6}
            />
          </Pressable>
          <Text numberOfLines={1} style={rj(14, 700, FROST)}>
            {count} / {target}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${placeholder ?? 'Log one'} for ${label}`}
            onPress={() => progress.incCount(key, step)}
            style={{
              marginLeft: 'auto',
              flexShrink: 1,
              borderRadius: 999,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderWidth: 1,
              borderColor: rgb('constellation-gold', 0.35),
              backgroundColor: rgb('constellation-gold', 0.08),
            }}
          >
            <Text numberOfLines={1} style={kicker(10, 0.12, GOLD_PALE, 800)}>
              {placeholder ?? 'Log one'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  // photo
  return (
    <View>
      <Text style={FIELD_LABEL_STYLE}>{label}</Text>
      <View style={{ marginTop: 8 }}>
        <PhotoGrid
          label={label}
          files={progress.photoFiles[key] ?? []}
          onAdd={photos => progress.addPhotos(key, photos)}
          onRemove={i => progress.removePhoto(key, i)}
          size={58}
          radius={10}
          dashedAlpha={0.24}
          plusSize={16}
        />
      </View>
    </View>
  );
}
