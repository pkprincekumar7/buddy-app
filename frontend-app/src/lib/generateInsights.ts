import { api } from '@/api/client';
import { INSIGHTS_SCHEMA_VERSION, buildMonthData } from '@/lib/insightsUtils';
import type { MonthData } from '@/lib/insightsUtils';

function buildInsightsPrompt(childName: string | null | undefined, monthData: MonthData[]): string {
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
}

export async function generateInsights(
  childName: string | null | undefined,
  plan: Record<string, unknown> | null | undefined,
): Promise<{ schema_version: number; insight_items: unknown[] }> {
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
}
