import { api } from '@/api/client';
import { unwrapLLM } from '@/lib/llmUtils';

// Bump when the insights payload shape changes — any cached plan with a
// different schema_version will be treated as stale and regenerated.
export const INSIGHTS_SCHEMA_VERSION = 2;

export const NON_SCORABLE_DELTA_PTS = 30;

export const truncate = (str, n = 38) =>
  str && str.length > n ? str.slice(0, n - 1) + '…' : str || '';

const computeObservation = (original, followUp) => {
  if (!original) return { label: 'Not Started', type: 'notStarted' };
  if (!original.completed && !followUp?.completed)
    return { label: 'Not Started', type: 'notStarted' };
  if (original.completed && !followUp?.completed)
    return { label: 'In Progress', type: 'inProgress' };

  if (original.scorable !== false) {
    const origPct   = (original.score / 10) * 100;
    const followPct = (followUp.score / 10) * 100;
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
    const po = followUp.progress_observation;
    if (po === 'Improved')             return { label: 'Improved',             type: 'improved'      };
    if (po === 'Needs More Attention') return { label: 'Needs More Attention', type: 'declined'      };
    if (po === 'No Improvement')       return { label: 'No Improvement',       type: 'noImprovement' };
    return { label: 'No Improvement', type: 'noImprovement' };
  }
};

const computeMonthScore = (pairs) => {
  let total = 0, count = 0;
  for (const { observation } of pairs) {
    if (observation.type === 'improved')           { total += observation.percent ?? NON_SCORABLE_DELTA_PTS; count++; }
    else if (observation.type === 'declined')      { total -= observation.percent ?? NON_SCORABLE_DELTA_PTS; count++; }
    else if (observation.type === 'noImprovement') { count++; }
  }
  return count > 0 ? Math.round(total / count) : null;
};

export const completedCount = (plan) =>
  (plan?.months || []).reduce((total, month) =>
    total + (month.periods || []).reduce((mTotal, period) =>
      mTotal + (period.activities || []).filter(a => a.completed).length, 0), 0);

export const buildMonthData = (plan) =>
  (plan?.months || []).map(month => {
    const pairs = [0, 1].map(actIdx => {
      const original = month.periods?.[0]?.activities?.[actIdx];
      const followUp = month.periods?.[1]?.activities?.[actIdx];
      return {
        original,
        followUp,
        label:       truncate(original?.title || `Activity ${actIdx + 1}`),
        scorable:    original?.scorable !== false,
        observation: computeObservation(original, followUp),
      };
    });
    return { month, pairs, score: computeMonthScore(pairs) };
  });

const buildInsightsPrompt = (childName, monthData) => {
  const name = childName || 'the child';
  const lines = [
    `Generate personalised progress insights for ${name} based on their 3-month goal plan assessments.\n`,
  ];

  monthData.forEach(({ month, pairs }) => {
    lines.push(`--- Month ${month.month}: ${month.goal} ---`);
    lines.push(`Month objective: ${month.objective}`);
    pairs.forEach((pair, pIdx) => {
      const orig = pair.original;
      const fu   = pair.followUp;
      lines.push(`\n  Objective ${pIdx + 1}: ${orig?.title || 'Unknown'}`);

      if (orig?.completed) {
        lines.push(`  Original (Week 1&2):`);
        if (orig.scorable !== false) {
          lines.push(`    Score: ${orig.score}/10`);
        } else {
          lines.push(`    Note: ${orig.note || 'none'}`);
        }
        lines.push(`    AI Feedback: ${orig.ai_feedback || 'none'}`);
        if (orig.parent_feedback) lines.push(`    Parent Feedback: ${orig.parent_feedback}`);
      } else {
        lines.push(`  Original (Week 1&2): Not completed`);
      }

      if (fu?.completed) {
        lines.push(`  Follow-up (Week 3&4): ${fu.title || 'Unknown'}`);
        if (fu.scorable !== false) {
          lines.push(`    Score: ${fu.score}/10`);
          lines.push(`    Progress: ${pair.observation.label}`);
        } else {
          lines.push(`    Note: ${fu.note || 'none'}`);
          lines.push(`    Progress: ${fu.progress_observation || 'No Improvement'}`);
        }
        lines.push(`    AI Feedback: ${fu.ai_feedback || 'none'}`);
        if (fu.parent_feedback) lines.push(`    Parent Feedback: ${fu.parent_feedback}`);
      } else {
        lines.push(`  Follow-up (Week 3&4): Not completed`);
      }
    });
    lines.push('');
  });

  lines.push(`Based on the data above, generate insight_items: an array of exactly 3 objects. The first 2 must highlight ${name}'s clear strengths (type: "strength"). The third must identify a potential improvement area (type: "anomaly"). Each object has: "text" (a single complete, warm sentence starting with ${name}'s first name describing the insight), "type" ("strength" or "anomaly"), "details" (2–3 sentences of expanded detail; for the anomaly, frame it in a very positive and constructive manner focused on growth opportunity, celebrating small wins and encouraging next steps).`);

  return lines.join('\n');
};

export const generateInsights = async (childName, plan) => {
  const monthData = buildMonthData(plan);
  const prompt = buildInsightsPrompt(childName, monthData);

  const result = await api.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        insight_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text:    { type: 'string' },
              type:    { type: 'string', enum: ['strength', 'anomaly'] },
              details: { type: 'string' },
            },
          },
        },
      },
    },
  });

  const data = result.properties ?? result;
  return {
    schema_version: INSIGHTS_SCHEMA_VERSION,
    insight_items:  Array.isArray(data.insight_items) ? data.insight_items : [],
  };
};
