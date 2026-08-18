/**
 * Release-page observation patterns: the icon registry, the provenance copy, and
 * the validator that stands between raw provider output and what the page renders.
 *
 * The page makes one factual promise — "Superpower records what you notice. It
 * draws no conclusions and labels nothing." Four rules here exist to keep that
 * true, and none of them are stylistic:
 *
 *  1. An observation with no note is an unevidenced claim, so it is dropped rather
 *     than shown. Notes were originally required to be the parent's near-verbatim
 *     words, which made them provably grounded but produced cards that read the
 *     parent's own sentences back at them. They are now derived observations, so
 *     grounding rests on the prompt rather than on a string match — except for
 *     child-choice lines, which are still checked exactly (see isAllowedNote).
 *  2. `sources` is mandatory and app-labelled. The provider names which evidence
 *     bucket it drew on; the sentence the parent reads is written here. That is
 *     what makes a fabricated frequency ("Noted 7 times") structurally
 *     impossible — there is no field for the model to put a count in.
 *  3. `icon` is a key into the registry below, never geometry from the provider.
 *  4. Every evidence block offered to the provider gets a slot before any block
 *     gets a second one — see selectObservations. Without this, the set tracks
 *     whichever block happened to hold the most text: six completed Grow areas is
 *     ~30 answers against a handful of onboarding fields, so the parent's
 *     onboarding answers would silently vanish from a page that claims to read
 *     back what they told us.
 */

/** Icon path data, ported 1:1 from the "Observations" mockup's IC constant. */
export const OBSERVATION_ICONS = {
  focus: 'M12 4v3M12 17v3M4 12h3M17 12h3M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z',
  read: 'M4 5.5h7v13H4zM20 5.5h-7v13h7z',
  sense: 'M12 4a8 8 0 0 0-8 8v5h4v-6M12 4a8 8 0 0 1 8 8v5h-4v-6',
  motion: 'M13 4l-2 7h5l-3 9M6 9l3-1M18 14l-3 1',
  words: 'M5 7h14M5 12h9M5 17h6',
  social:
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c1-3.5 3.2-5.2 6-5.2S14 16.5 15 20M16 5.5a3 3 0 0 1 0 6',
  /**
   * Neutral fallback for an unrecognised key. Deliberately domain-free: showing
   * the "read" glyph on a pattern about mealtimes would signal a reading
   * observation the parent never made, which is worse than a plain mark.
   */
  note: 'M6 4h9l3 3v13H6zM9 11h6M9 15h4',
} as const;

export type ObservationIconKey = keyof typeof OBSERVATION_ICONS;

const ICON_KEYS = Object.keys(OBSERVATION_ICONS) as ObservationIconKey[];
/** Keys offered to the provider — `note` is ours to fall back to, not theirs to pick. */
export const SELECTABLE_ICON_KEYS = ICON_KEYS.filter((k) => k !== 'note');

/**
 * Where an observation came from. Order matters — it is the order the prompt
 * presents the blocks and the order selectObservations reserves slots in.
 *
 * `child` is the one that is not the parent's prose: the child picked between two
 * offered options in the Grow rounds rather than writing anything, so evidence
 * from that block is a *choice*, and the prompt is explicit that it must not be
 * dressed up as something the child said. Everything else here is the parent
 * writing in their own words.
 *
 * All four are still single sittings rather than observation over time. What they
 * do give is corroboration: a pattern the parent described that the child's
 * choices also point to has genuinely turned up more than once, which is the only
 * sense in which this page can currently claim recurrence.
 */
export const OBSERVATION_SOURCES = ['onboarding', 'grow', 'child', 'concern'] as const;

export type ObservationSourceKey = (typeof OBSERVATION_SOURCES)[number];

/**
 * Noun phrases composed into "From …". App-owned copy; the provider only ever
 * picks keys, so no count or claim can arrive from the model through here.
 */
function sourceNoun(source: ObservationSourceKey, childName: string): string {
  switch (source) {
    case 'onboarding':
      return 'your onboarding answers';
    case 'grow':
      return 'your Grow answers';
    case 'child':
      return childName ? `what ${childName} chose` : 'what your child chose';
    case 'concern':
      return 'what you told us';
  }
}

const SOURCE_SET = new Set<string>(OBSERVATION_SOURCES);

export interface ObservationItem {
  /** Stable across regeneration where the pattern is: slug of the title. */
  id: string;
  title: string;
  summary: string;
  /** The parent's own words. Never empty — see rule 1 above. */
  notes: string[];
  icon: ObservationIconKey;
  sources: ObservationSourceKey[];
}

/** How many cards the page shows. */
export const MAX_OBSERVATIONS = 6;
/**
 * How many the provider may return. Deliberately above the display cap: the
 * per-source guarantee in selectObservations can only pick from what it is given,
 * so it needs candidates to choose between. With no slack, a set where the first
 * six cards all cite one block leaves nothing to promote and the guarantee is
 * empty. The prompt's "return fewer when the evidence is thin" still governs —
 * this is a ceiling, not a target.
 */
const MAX_GENERATED_CANDIDATES = 8;
const MAX_NOTES_PER_OBSERVATION = 3;
/**
 * Slightly above the 8 the prompt asks for. The schema's 60-char limit is the real
 * layout guard; this is a backstop against a runaway title, and setting it at
 * exactly 8 turned "Gives up when it does not work first time" — a good title,
 * well inside the char budget — into an ellipsis mid-thought.
 */
const TITLE_MAX_WORDS = 10;
const SUMMARY_MAX_WORDS = 28;
const NOTE_MAX_WORDS = 22;

/**
 * Renders provenance as a sentence, e.g. "From your onboarding and Grow answers".
 * Returns '' for an empty list so callers render nothing rather than a bare "From".
 */
export function formatObservationSources(sources: ObservationSourceKey[], childName = ''): string {
  const nouns = sources.map((s) => sourceNoun(s, childName)).filter(Boolean);
  if (nouns.length === 0) return '';
  if (nouns.length === 1) return `From ${nouns[0]}`;
  // These two are the only pair sharing a "your … answers" shape, so they are the
  // only pair the shared head can be elided from.
  if (sources.length === 2 && sources.includes('onboarding') && sources.includes('grow')) {
    return 'From your onboarding and Grow answers';
  }
  const head = nouns.slice(0, -1).join(', ');
  return `From ${head} and ${nouns[nouns.length - 1]}`;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Settle how a note is punctuated, because the provider will not do it
 * consistently. Across runs the same prompt returned parent notes wrapped in
 * typographic quotes three times and bare once, while the child-choice lines
 * always carry the straight quotes we put into that block ourselves — so one card
 * could show "…", “…” and unquoted text side by side.
 *
 * Wrapping quotes come off: the bullet already frames a note as evidence, and
 * notes cannot be uniformly quoted anyway, since a child-choice line is a record
 * of a choice rather than something anyone said. Quotes *inside* the text are
 * structural — they delimit the two options in Chose “X” over “Y” — so those stay,
 * normalised to typographic so nothing mixes styles.
 */
function tidyNote(text: string): string {
  let out = text.trim();

  const WRAPPERS: [string, string][] = [
    ['"', '"'],
    ['“', '”'],
    ["'", "'"],
    ['‘', '’'],
  ];
  for (const [open, close] of WRAPPERS) {
    // >= not >, so a note that is nothing but a quote pair collapses to '' and is
    // dropped by the caller, rather than surviving as a bare “”.
    if (out.length >= open.length + close.length && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, -close.length).trim();
      break;
    }
  }

  // Alternate open/close across whatever straight doubles remain.
  let closing = false;
  out = out.replace(/"/g, () => {
    closing = !closing;
    return closing ? '“' : '”';
  });

  // Punctuation on its own is not evidence. Unicode-aware so a note in any script
  // counts as content — this catches a stray lone quote, not a Devanagari note.
  return /[\p{L}\p{N}]/u.test(out) ? out : '';
}

/**
 * Comparison key for a child-choice note: case, spacing, trailing periods and
 * quote style all normalised away, so cosmetic reformatting still matches while
 * any change to the actual options does not.
 */
function choiceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"]/g, '"')
    .replace(/[\s.]+/g, ' ')
    .trim();
}

/**
 * Guard against fabricated child evidence.
 *
 * A real run recombined two genuine choice lines into a third that never happened
 * — it took the rejected half of one and the rejected half of another and paired
 * them. Nothing about the result looks malformed, so no structural check catches
 * it, and it renders to the parent as something their child chose.
 *
 * Child-choice lines are the one kind of note we can verify exactly, because we
 * compose them ourselves from stored picks. So they are whitelisted: a note in
 * "Chose … over …" form must match a line we actually put in the prompt. Parent
 * notes cannot be checked this way — they are derived observations by design — so
 * they pass through here and rest on the prompt rules instead.
 *
 * This is also why the prompt keeps child lines verbatim while everything else is
 * reworded. Allowing them to be paraphrased was tried, and the very first run
 * produced "Picked fixing something broken over a tournament choice" for a child
 * who had picked teaching OVER fixing — an inverted claim about a real child that
 * no longer matched the literal form, so this guard never saw it.
 */
function isAllowedNote(note: string, allowedChoiceKeys: Set<string> | null): boolean {
  if (!allowedChoiceKeys) return true;
  if (!/^chose\s/i.test(note)) return true;
  return allowedChoiceKeys.has(choiceKey(note));
}

function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** Unwrap `{ observations: [...] }`, or a bare array. */
function readItems(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw as unknown[];
  if (!raw || typeof raw !== 'object') return null;
  const nested = (raw as Record<string, unknown>).observations;
  return Array.isArray(nested) ? (nested as unknown[]) : null;
}

/**
 * Validate generated observations, assigning stable ids. Per-item validity only —
 * set-level trimming and the per-source guarantee live in selectObservations, so
 * that reading already-promoted items back does not re-run selection on a set
 * whose evidence blocks are no longer in hand.
 *
 * Unlike the growth-area question sets, a short set is a valid result and is kept
 * as-is: three well-evidenced patterns is a better page than eight padded to a
 * quota. Individual malformed items are dropped, not fatal to the set.
 */
export function normalizeObservations(
  raw: unknown,
  opts?: {
    /**
     * The exact child-choice lines this generation was given. Supply on the
     * promote path so fabricated choices are dropped; omit when re-reading
     * already-promoted items, whose evidence blocks are no longer in hand.
     */
    allowedChoiceNotes?: readonly string[];
  },
): ObservationItem[] {
  const allowedChoiceKeys = opts?.allowedChoiceNotes
    ? new Set(opts.allowedChoiceNotes.map(choiceKey))
    : null;
  const items = readItems(raw);
  if (!items) return [];

  const out: ObservationItem[] = [];
  const seenIds = new Set<string>();

  for (const item of items) {
    if (out.length >= MAX_GENERATED_CANDIDATES) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;

    const title = readString(o.title);
    const summary = readString(o.summary);
    if (!title || !summary) continue;

    const notes = (Array.isArray(o.notes) ? o.notes : [])
      .map(readString)
      // Tidy before the empty-check, so a note that was nothing but quote marks
      // resolves to '' and is dropped rather than rendering as a bare pair.
      .map(tidyNote)
      .filter(Boolean)
      // Before the cap, so a fabricated choice cannot displace a real note.
      .filter((n) => isAllowedNote(n, allowedChoiceKeys))
      .slice(0, MAX_NOTES_PER_OBSERVATION)
      .map((n) => capWords(n, NOTE_MAX_WORDS));
    // Rule 1: no evidence, no card.
    if (notes.length === 0) continue;

    const sources = (Array.isArray(o.sources) ? o.sources : [])
      .map(readString)
      .filter((s): s is ObservationSourceKey => SOURCE_SET.has(s));
    // Rule 2: an observation we cannot attribute is one we cannot honestly show.
    if (sources.length === 0) continue;

    const iconKey = readString(o.icon) as ObservationIconKey;
    const icon: ObservationIconKey = iconKey in OBSERVATION_ICONS ? iconKey : 'note';

    let id = slugify(title) || `observation_${out.length + 1}`;
    if (seenIds.has(id)) id = `${id}_${out.length + 1}`;
    seenIds.add(id);

    out.push({
      id,
      title: capWords(title, TITLE_MAX_WORDS),
      summary: capWords(summary, SUMMARY_MAX_WORDS),
      notes,
      icon,
      sources: [...new Set(sources)],
    });
  }

  return out;
}

export interface ObservationSelection {
  items: ObservationItem[];
  /**
   * Blocks that were in the prompt but that no surviving card cites. Non-empty
   * means the provider ignored rule 5 and returned nothing to promote — the
   * guarantee below can reorder candidates, it cannot invent one. Callers should
   * surface this rather than let it pass as a complete set.
   */
  unrepresentedSources: ObservationSourceKey[];
  /** Valid candidates cut by the display cap. Never drop these silently. */
  dropped: number;
}

/**
 * Trim validated candidates to what the page shows, giving every offered evidence
 * block a slot before any block takes a second.
 *
 * This is the enforcement behind rule 5 of the prompt. The instruction alone was
 * not enough — an early run dropped the parent's stated concern entirely — and an
 * instruction cannot bind in any case. What this can guarantee: if a candidate
 * citing a given block exists, that block appears on the page. What it cannot:
 * manufacture a card the provider never produced. That case is reported via
 * `unrepresentedSources` instead of being hidden.
 *
 * `availableSources` must be in the order the prompt presented the blocks, so
 * reservation is deterministic rather than dependent on provider ordering.
 */
export function selectObservations(
  items: ObservationItem[],
  availableSources: ObservationSourceKey[],
): ObservationSelection {
  const unrepresented = (kept: ObservationItem[]) =>
    availableSources.filter((s) => !kept.some((o) => o.sources.includes(s)));

  if (items.length <= MAX_OBSERVATIONS) {
    return { items, unrepresentedSources: unrepresented(items), dropped: 0 };
  }

  const reserved = new Set<string>();
  for (const source of availableSources) {
    if (reserved.size >= MAX_OBSERVATIONS) break;
    const first = items.find((o) => !reserved.has(o.id) && o.sources.includes(source));
    if (first) reserved.add(first.id);
  }
  for (const item of items) {
    if (reserved.size >= MAX_OBSERVATIONS) break;
    reserved.add(item.id);
  }

  // Filter rather than emit in pick order, so reserving a low-ranked card does not
  // yank it to the top of the grid — the provider's ordering is its own signal.
  const kept = items.filter((o) => reserved.has(o.id));
  return {
    items: kept,
    unrepresentedSources: unrepresented(kept),
    dropped: items.length - kept.length,
  };
}

/** Response schema for the generate_observations job. */
export function observationsLlmSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      observations: {
        type: 'array',
        // The page shows exactly MAX_OBSERVATIONS, so that is the floor. The
        // ceiling stays higher to leave selectObservations room to honour the
        // per-source guarantee, and to absorb an item lost to validation.
        minItems: MAX_OBSERVATIONS,
        maxItems: MAX_GENERATED_CANDIDATES,
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              maxLength: 60,
              description:
                'At most 8 words naming the pattern in the parent’s own vocabulary. Not a sentence, not a label.',
            },
            summary: {
              type: 'string',
              maxLength: 170,
              description:
                'One sentence, at most 28 words, describing what the parent reported. No diagnosis, no frequency claim.',
            },
            notes: {
              type: 'array',
              // Asks for 2 as the floor to push for substance, while
              // normalizeObservations still accepts an item that comes back with
              // one — losing a whole card costs more than a thin one, given the
              // page needs six.
              minItems: 2,
              maxItems: MAX_NOTES_PER_OBSERVATION,
              items: {
                type: 'string',
                maxLength: 140,
                description:
                  'A distinct, specific observation derived from the evidence — never a sentence copied out of it, and never a repeat of the summary or another note.',
              },
            },
            icon: {
              type: 'string',
              enum: SELECTABLE_ICON_KEYS,
              description: 'Closest matching icon key for this pattern.',
            },
            sources: {
              type: 'array',
              minItems: 1,
              maxItems: OBSERVATION_SOURCES.length,
              items: { type: 'string', enum: [...OBSERVATION_SOURCES] },
              description: 'Every evidence block this observation actually draws on.',
            },
          },
          required: ['title', 'summary', 'notes', 'icon', 'sources'],
        },
      },
    },
    required: ['observations'],
  };
}
