import { api } from '@/api/client';
import { INSIGHTS_SCHEMA_VERSION, buildMonthData } from '@/lib/insightsUtils';
import type { MonthData } from '@/lib/insightsUtils';

function buildInsightsPrompt(
  childName: string | null | undefined,
  childAge: string | number | null | undefined,
  childGender: string | null | undefined,
  monthData: MonthData[],
): string {
  const name = childName ?? 'the child';
  const pronoun =
    childGender?.toLowerCase() === 'female'
      ? 'she'
      : childGender?.toLowerCase() === 'male'
        ? 'he'
        : 'they';
  const possessive =
    childGender?.toLowerCase() === 'female'
      ? 'her'
      : childGender?.toLowerCase() === 'male'
        ? 'his'
        : 'their';

  const lines: string[] = [];

  // Child profile
  lines.push(`You are generating personalised progress insights for a parent about their child.`);
  lines.push('');
  lines.push(`Child profile:`);
  lines.push(`- Name: ${name}`);
  if (childAge) lines.push(`- Age: ${String(childAge)}`);
  if (childGender) lines.push(`- Gender: ${childGender}`);
  lines.push('');
  lines.push(
    `Write all insights in parent-facing language. Use ${name}'s name naturally. Refer to ${name} using ${pronoun}/${possessive} pronouns. Avoid clinical or technical language. Honesty takes priority over encouragement — a parent who receives only positive language cannot take informed action to support their child's development.`,
  );
  lines.push('');
  lines.push(`--- Assessment Data ---`);

  // Per-month, per-activity data
  monthData.forEach(({ month, pairs }) => {
    lines.push(`Month ${String(month.month)}: ${String(month.goal ?? '')}`);
    lines.push(
      `Objective: ${String((month as Record<string, string | undefined>).objective ?? '')}`,
    );

    pairs.forEach((pair, pIdx) => {
      const orig = pair.original;
      const fu = pair.followUp;
      lines.push(`\n  Activity ${pIdx + 1}: ${orig?.title ?? 'Unknown'}`);

      if (orig?.completed) {
        lines.push(`  Week 1 & 2 (Original):`);
        if (orig.scorable !== false) {
          lines.push(`    Score: ${orig.score ?? 0}/10`);
        } else {
          lines.push(`    AI Note: ${orig.note ?? 'none'}`);
        }
        if (orig.what_changed) lines.push(`    What changed: ${orig.what_changed}`);
        if (orig.what_learned) lines.push(`    What was learned: ${orig.what_learned}`);
        if (orig.recommendation) lines.push(`    Recommendation given: ${orig.recommendation}`);
        lines.push(`    AI Feedback: ${orig.ai_feedback ?? 'none'}`);
        if (orig.parent_feedback) lines.push(`    Parent's note: ${orig.parent_feedback}`);
      } else {
        lines.push(`  Week 1 & 2 (Original): Not yet completed`);
      }

      if (fu?.completed) {
        lines.push(`  Week 3 & 4 (Follow-up): ${fu.title ?? 'Unknown'}`);
        if (fu.scorable !== false) {
          lines.push(`    Score: ${fu.score ?? 0}/10`);
          lines.push(`    Progress vs original: ${pair.observation.label}`);
        } else {
          lines.push(`    AI Note: ${fu.note ?? 'none'}`);
          lines.push(`    Progress vs original: ${fu.progress_observation ?? 'No Improvement'}`);
        }
        if (fu.what_changed) lines.push(`    What changed: ${fu.what_changed}`);
        if (fu.what_learned) lines.push(`    What was learned: ${fu.what_learned}`);
        if (fu.recommendation) lines.push(`    Recommendation given: ${fu.recommendation}`);
        lines.push(`    AI Feedback: ${fu.ai_feedback ?? 'none'}`);
        if (fu.parent_feedback) lines.push(`    Parent's note: ${fu.parent_feedback}`);
      } else {
        lines.push(`  Week 3 & 4 (Follow-up): Not yet completed`);
      }
    });

    lines.push('');
  });

  // Output instruction
  lines.push(`--- Task ---`);
  lines.push('');
  lines.push(
    `Based on everything above, generate exactly 3 insight items in the "insight_items" array. Follow this structure precisely:`,
  );
  lines.push('');
  lines.push(
    `IMPORTANT: The items MUST appear in this exact order in the array: [strength, strength, anomaly]. Do not reorder them.`,
  );
  lines.push(
    `Item 1 (type: "strength") — Highlight a clear, evidence-based strength ${name} has demonstrated across the activities. ` +
      `"text": one warm, complete sentence starting with ${name}'s first name. ` +
      `"details": 2–3 sentences expanding on the specific behaviours or patterns that show this strength; reference actual activity data.`,
  );
  lines.push('');
  lines.push(
    `Item 2 (type: "strength") — Highlight a second distinct strength — choose a different area or skill from Item 1. ` +
      `"text": one warm, complete sentence starting with ${name}'s first name. ` +
      `"details": 2–3 sentences with specific evidence; celebrate any progress, even small wins.`,
  );
  lines.push('');
  lines.push(
    `Item 3 (type: "anomaly") — Identify one area where ${name} is genuinely struggling or has shown inconsistent progress across the data. ` +
      `Be honest: if the scores, notes, or observations consistently show weakness in a particular area, name it clearly. Do not soften the message so much that the parent fails to understand they need to act. ` +
      `"text": one clear, forward-looking sentence starting with ${name}'s first name that names the specific area of concern. ` +
      `"details": 2–3 sentences that: (a) explain what the data specifically shows — reference actual scores, notes, or observations; (b) tell the parent clearly what this means for ${possessive} development; (c) give the parent one specific, concrete action they can take to address this gap — not a vague suggestion, but something they can do this week.`,
  );
  lines.push('');
  lines.push(
    `Rules: ` +
      `Do not fabricate data not present above. ` +
      `Do not use scores as the only evidence — interpret what the scores and notes reveal about ${name}'s thinking, effort, or engagement. ` +
      `Language should be clear and specific. Warm tone is welcome but must not override honesty. Age-appropriate for a ${childAge ? String(childAge) + '-year-old' : 'child'}.`,
  );

  return lines.join('\n');
}

const _insightsSchema = {
  type: 'object',
  properties: {
    insight_items: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
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
};

/**
 * Returns the prompt and JSON schema for insights generation.
 * Returns `prompt: null` if no activities have been completed yet (LLM call should be skipped).
 */
export function buildInsightsPayload(
  childName: string | null | undefined,
  plan: Record<string, unknown> | null | undefined,
  childAge?: string | number | null,
  childGender?: string | null,
): { prompt: string | null; schema: Record<string, unknown> } {
  const monthData = buildMonthData(plan);
  const hasAnyCompleted = monthData.some(({ pairs }) =>
    pairs.some((p) => (p.original?.completed ?? false) || (p.followUp?.completed ?? false)),
  );
  if (!hasAnyCompleted) return { prompt: null, schema: _insightsSchema };
  return {
    prompt: buildInsightsPrompt(childName, childAge, childGender, monthData),
    schema: _insightsSchema,
  };
}

export async function generateInsights(
  childName: string | null | undefined,
  plan: Record<string, unknown> | null | undefined,
  childAge?: string | number | null,
  childGender?: string | null,
): Promise<{ schema_version: number; insight_items: unknown[] }> {
  const monthData = buildMonthData(plan);

  // Guard: if no activities have been completed yet, skip the LLM call entirely
  // to avoid hallucinated insights with no real data to draw from.
  const hasAnyCompleted = monthData.some(({ pairs }) =>
    pairs.some((p) => (p.original?.completed ?? false) || (p.followUp?.completed ?? false)),
  );
  if (!hasAnyCompleted) {
    return { schema_version: INSIGHTS_SCHEMA_VERSION, insight_items: [] };
  }

  const prompt = buildInsightsPrompt(childName, childAge, childGender, monthData);

  const result: unknown = await api.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        insight_items: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
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
}
