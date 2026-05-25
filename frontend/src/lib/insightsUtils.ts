import { api } from '@/api/client';

// Bump when the insights payload shape changes — any cached plan with a
// different schema_version will be treated as stale and regenerated.
export const INSIGHTS_SCHEMA_VERSION = 2;

export const NON_SCORABLE_DELTA_PTS = 30;

export const truncate = (str: string | undefined | null, n = 38): string =>
  str && str.length > n ? str.slice(0, n - 1) + '…' : (str ?? '');

interface Activity {
  completed?: boolean;
  scorable?: boolean;
  score?: number;
  progress_observation?: string;
  title?: string;
  note?: string;
  ai_feedback?: string;
  parent_feedback?: string;
}

export interface MonthRecord {
  month: number;
  goal?: string;
  [key: string]: unknown;
}

export interface Observation {
  label: string;
  type: 'notStarted' | 'inProgress' | 'improved' | 'declined' | 'noImprovement';
  percent?: number;
}

export interface Pair {
  original: Activity | undefined;
  followUp: Activity | undefined;
  label: string;
  scorable: boolean;
  observation: Observation;
}

export interface MonthData {
  month: MonthRecord;
  pairs: Pair[];
  score: number | null;
}

const computeObservation = (
  original: Activity | undefined,
  followUp: Activity | undefined,
): Observation => {
  if (!original) return { label: 'Not Started', type: 'notStarted' };
  if (!original.completed && !followUp?.completed)
    return { label: 'Not Started', type: 'notStarted' };
  if (original.completed && !followUp?.completed)
    return { label: 'In Progress', type: 'inProgress' };

  if (original.scorable !== false) {
    const origPct = ((original.score ?? 0) / 10) * 100;
    const followPct = ((followUp?.score ?? 0) / 10) * 100;
    if (origPct === 0) return { label: 'No Improvement', type: 'noImprovement' };
    if (followPct > origPct) {
      const pct = Math.round(((followPct - origPct) / origPct) * 100);
      return { label: `Improved by ${pct}%`, type: 'improved', percent: pct };
    }
    if (followPct < origPct) {
      const pct = Math.round(((origPct - followPct) / origPct) * 100);
      return { label: `Declined by ${pct}%`, type: 'declined', percent: pct };
    }
    return { label: 'No Improvement', type: 'noImprovement' };
  } else {
    const po = followUp?.progress_observation;
    if (po === 'Improved') return { label: 'Improved', type: 'improved' };
    if (po === 'Needs More Attention') return { label: 'Needs More Attention', type: 'declined' };
    if (po === 'No Improvement') return { label: 'No Improvement', type: 'noImprovement' };
    return { label: 'No Improvement', type: 'noImprovement' };
  }
};

const computeMonthScore = (pairs: Pair[]): number | null => {
  let total = 0,
    count = 0;
  for (const { observation } of pairs) {
    if (observation.type === 'improved') {
      total += observation.percent ?? NON_SCORABLE_DELTA_PTS;
      count++;
    } else if (observation.type === 'declined') {
      total -= observation.percent ?? NON_SCORABLE_DELTA_PTS;
      count++;
    } else if (observation.type === 'noImprovement') {
      count++;
    }
  }
  return count > 0 ? Math.round(total / count) : null;
};

export const completedCount = (plan: Record<string, unknown> | null | undefined): number => {
  const months = Array.isArray(plan?.months) ? (plan.months as unknown[]) : [];
  return months.reduce((total: number, month: unknown) => {
    const m = month as Record<string, unknown>;
    const periods = Array.isArray(m.periods) ? (m.periods as unknown[]) : [];
    return (
      total +
      periods.reduce((mTotal: number, period: unknown) => {
        const p = period as Record<string, unknown>;
        const activities = Array.isArray(p.activities) ? (p.activities as unknown[]) : [];
        return mTotal + activities.filter((a) => (a as Record<string, unknown>).completed).length;
      }, 0)
    );
  }, 0);
};

export const buildMonthData = (plan: Record<string, unknown> | null | undefined): MonthData[] => {
  const months = Array.isArray(plan?.months) ? (plan.months as unknown[]) : [];
  return months.map((month: unknown) => {
    const m = month as MonthRecord;
    const periods = Array.isArray(m.periods) ? (m.periods as unknown[]) : [];
    const pairs: Pair[] = [0, 1].map((actIdx) => {
      const period0 = periods[0] as Record<string, unknown> | undefined;
      const period1 = periods[1] as Record<string, unknown> | undefined;
      const acts0 = Array.isArray(period0?.activities) ? (period0.activities as unknown[]) : [];
      const acts1 = Array.isArray(period1?.activities) ? (period1.activities as unknown[]) : [];
      const original = acts0[actIdx] as Activity | undefined;
      const followUp = acts1[actIdx] as Activity | undefined;
      return {
        original,
        followUp,
        label: truncate(original?.title ?? `Activity ${actIdx + 1}`),
        scorable: original?.scorable !== false,
        observation: computeObservation(original, followUp),
      };
    });
    return { month: m, pairs, score: computeMonthScore(pairs) };
  });
};

const buildInsightsPrompt = (
  childName: string | null | undefined,
  monthData: MonthData[],
): string => {
  const name = childName ?? 'the child';
  const lines = [
    `Generate personalised progress insights for ${name} based on their 3-month goal plan assessments.\n`,
  ];

  monthData.forEach(({ month, pairs }) => {
    lines.push(`--- Month ${String(month.month)}: ${String(month.goal)} ---`);
    lines.push(`Month objective: ${String(month.objective)}`);
    pairs.forEach((pair, pIdx) => {
      const orig = pair.original;
      const fu = pair.followUp;
      lines.push(`\n  Objective ${pIdx + 1}: ${orig?.title ?? 'Unknown'}`);

      if (orig?.completed) {
        lines.push(`  Original (Week 1&2):`);
        if (orig.scorable !== false) {
          lines.push(`    Score: ${orig.score ?? 0}/10`);
        } else {
          lines.push(`    Note: ${orig.note ?? 'none'}`);
        }
        lines.push(`    AI Feedback: ${orig.ai_feedback ?? 'none'}`);
        if (orig.parent_feedback) lines.push(`    Parent Feedback: ${orig.parent_feedback}`);
      } else {
        lines.push(`  Original (Week 1&2): Not completed`);
      }

      if (fu?.completed) {
        lines.push(`  Follow-up (Week 3&4): ${fu.title ?? 'Unknown'}`);
        if (fu.scorable !== false) {
          lines.push(`    Score: ${fu.score ?? 0}/10`);
          lines.push(`    Progress: ${pair.observation.label}`);
        } else {
          lines.push(`    Note: ${fu.note ?? 'none'}`);
          lines.push(`    Progress: ${fu.progress_observation ?? 'No Improvement'}`);
        }
        lines.push(`    AI Feedback: ${fu.ai_feedback ?? 'none'}`);
        if (fu.parent_feedback) lines.push(`    Parent Feedback: ${fu.parent_feedback}`);
      } else {
        lines.push(`  Follow-up (Week 3&4): Not completed`);
      }
    });
    lines.push('');
  });

  lines.push(
    `Based on the data above, generate insight_items: an array of exactly 3 objects. The first 2 must highlight ${name}'s clear strengths (type: "strength"). The third must identify a potential improvement area (type: "anomaly"). Each object has: "text" (a single complete, warm sentence starting with ${name}'s first name describing the insight), "type" ("strength" or "anomaly"), "details" (2–3 sentences of expanded detail; for the anomaly, frame it in a very positive and constructive manner focused on growth opportunity, celebrating small wins and encouraging next steps).`,
  );

  return lines.join('\n');
};

export const generateInsights = async (
  childName: string | null | undefined,
  plan: Record<string, unknown> | null | undefined,
): Promise<{ schema_version: number; insight_items: unknown[] }> => {
  const monthData = buildMonthData(plan);
  const prompt = buildInsightsPrompt(childName, monthData);

  const result: unknown = await api.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        insight_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              type: { type: 'string', enum: ['strength', 'anomaly'] },
              details: { type: 'string' },
            },
          },
        },
      },
    },
  });

  const data = result as Record<string, unknown>;
  return {
    schema_version: INSIGHTS_SCHEMA_VERSION,
    insight_items: Array.isArray(data.insight_items) ? (data.insight_items as unknown[]) : [],
  };
};
