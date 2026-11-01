/** A generation's `kind`, as the circles' APIs name them (`…/generation`). */
export type GenerationKind =
  | 'personality'
  | 'parent_questions'
  | 'child_rounds'
  | 'recommendations'
  | 'life_pathway'
  | 'plan'
  | 'event_tracker'
  | 'observations';

/**
 * Returns a human-readable progress message based on elapsed time and the kind of
 * generation running.
 */
export function jobProgressMessage(elapsedMs: number, kind: GenerationKind): string {
  const s = elapsedMs / 1000;
  if (s < 3) return '';

  if (kind === 'recommendations') {
    if (s < 8) return "Analysing your child's growth areas…";
    if (s < 15) return 'Personalising recommendations…';
  } else if (kind === 'personality') {
    if (s < 8) return 'Shaping personality insights…';
    if (s < 15) return "Finalising your child's personality profile…";
  } else if (kind === 'life_pathway') {
    if (s < 8) return 'Mapping a personalised journey…';
    if (s < 15) return 'Tailoring milestones for your child…';
  } else if (kind === 'parent_questions') {
    if (s < 8) return 'Reading your child’s profile…';
    if (s < 15) return 'Writing questions just for them…';
  } else if (kind === 'child_rounds') {
    if (s < 8) return 'Turning your answers into a game…';
    if (s < 15) return 'Shaping choices your child will love…';
  } else if (kind === 'observations') {
    if (s < 8) return 'Reading back what you have told us…';
    if (s < 15) return 'Grouping it into patterns…';
  } else {
    if (s < 8) return 'Generating activity ideas…';
    if (s < 15) return 'Personalising activities for your child…';
  }

  if (s < 20) return 'Almost there…';
  if (s < 120)
    return 'This is taking a little longer than usual — you can wait or come back later.';
  return "Still working on this. Feel free to explore the app — we'll have this ready when you return.";
}
