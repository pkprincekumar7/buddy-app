/**
 * Prompt-context builders for the Observations screen — copied verbatim from
 * frontend/src/pages/Observations.tsx (buildGrowthAreaContext /
 * buildChildActivityContext). Keep in sync with the web.
 */
import {
  AREA_QUESTIONS,
  areaById,
  fillTemplate,
  normalizeGeneratedQuestions,
  normalizeGeneratedRounds,
  resolveRounds,
} from '@/lib/growthAreaData';
import type { CompletedArea } from '@/types/api';

/**
 * Flattens the parent's answered Grow reflections into prompt context. The
 * questions matter as much as the answers: "Yes, most days" is uninterpretable
 * without the question it answered, and the observation prompt is required to
 * quote the parent rather than paraphrase, so it needs both sides.
 *
 * Falls back to the hardcoded set for areas answered before generated questions
 * existed — the same resolution order GrowthAreas uses for `askedQuestions`.
 */
export function buildGrowthAreaContext(
  areas: CompletedArea[],
  childName: string,
  childGender: string,
): string {
  const blocks: string[] = [];
  for (const area of areas) {
    const areaId = typeof area.area_id === 'string' ? area.area_id : '';
    if (!areaId) continue;
    const answers = area.answers ?? {};
    if (Object.keys(answers).length === 0) continue;

    const questions =
      normalizeGeneratedQuestions(area.parent_questions, areaId) ??
      AREA_QUESTIONS[areaId] ??
      [];
    const pairs = questions
      .filter(q => answers[q.id])
      .map(
        q =>
          `Q: ${fillTemplate(q.question, childName, childGender)}\nA: ${String(
            answers[q.id],
          )}`,
      );
    // An area whose stored answers key off a question set we no longer have is
    // still the parent's own words — keep them, unlabelled, rather than dropping
    // real evidence because the prompt for it is gone.
    const orphaned =
      pairs.length === 0
        ? Object.values(answers)
            .map(v => String(v).trim())
            .filter(Boolean)
            .map(v => `A: ${v}`)
        : [];
    const lines = [...pairs, ...orphaned];
    if (lines.length === 0) continue;

    const areaName =
      (typeof area.area_name === 'string' && area.area_name
        ? area.area_name
        : null) ??
      areaById(areaId)?.name ??
      areaId;
    blocks.push(`— ${areaName} —\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/**
 * The child's own contribution: their forced-choice picks from the Grow rounds.
 *
 * Recorded as "chose X over Y" because in a two-option round the rejected side
 * carries half the meaning — "chose building over storytelling" says something
 * "chose building" does not. The prompt is separately instructed never to render
 * these as the child's words, since the child tapped copy we wrote.
 *
 * Picks read from the durable `child_activity.selections` first; the backend
 * clears the transient `child_activity_selections` on completion, so the durable
 * copy is the one that survives for a finished area.
 */
export function buildChildActivityContext(
  areas: CompletedArea[],
  childName: string,
  childGender: string,
): { text: string; choiceLines: string[] } {
  const blocks: string[] = [];
  const allLines: string[] = [];
  for (const area of areas) {
    const areaId = typeof area.area_id === 'string' ? area.area_id : '';
    if (!areaId) continue;

    const durable = (
      area.child_activity as { selections?: unknown } | undefined
    )?.selections;
    const picks = (
      Array.isArray(durable) ? durable : area.child_activity_selections ?? []
    ).filter((id): id is string => typeof id === 'string');
    if (picks.length === 0) continue;

    // resolveRounds picks whichever generation of ids the saved picks belong to,
    // so areas played against the hardcoded rounds still resolve correctly.
    const rounds = resolveRounds(
      areaId,
      normalizeGeneratedRounds(area.child_rounds, areaId),
      picks,
    );
    const lines: string[] = [];
    for (const round of rounds) {
      const chose = picks.includes(round.a.id)
        ? round.a
        : picks.includes(round.b.id)
        ? round.b
        : null;
      if (!chose) continue;
      const over = chose.id === round.a.id ? round.b : round.a;
      // Typographic quotes here so the string the provider echoes back already
      // matches what tidyNote would normalise it to.
      lines.push(
        `Chose “${fillTemplate(chose.text, childName, childGender)}” over ` +
          `“${fillTemplate(over.text, childName, childGender)}”`,
      );
    }
    if (lines.length === 0) continue;
    allLines.push(...lines);

    const areaName =
      (typeof area.area_name === 'string' && area.area_name
        ? area.area_name
        : null) ??
      areaById(areaId)?.name ??
      areaId;
    blocks.push(`— ${areaName} —\n${lines.join('\n')}`);
  }
  return { text: blocks.join('\n\n'), choiceLines: allLines };
}
