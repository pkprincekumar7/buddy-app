/** Collapse LLM prose to a single short line for UI and downstream summary fields. */
export function personalizedDescriptionOneLiner(raw: unknown, maxLen = 180): string {
  const flat = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!flat) return '';
  let sentence = flat;
  const m = flat.match(/^(.+?[.!?])(\s|$)/);
  if (m) sentence = (m[1] ?? flat).trim();
  if (sentence.length > maxLen) {
    sentence = sentence.slice(0, maxLen).trimEnd();
    const lastSpace = sentence.lastIndexOf(' ');
    if (lastSpace > Math.floor(maxLen * 0.5)) sentence = sentence.slice(0, lastSpace);
    sentence = `${sentence}…`;
  }
  return sentence;
}

/** Prefer one-liner for LLM-derived persisted profiles; leave shorter/rule copy unchanged. */
export function maybeClampStoredPersonalityDescription(
  vm: Record<string, unknown>,
  opts: { analysisSource?: string } = {},
): Record<string, unknown> {
  const source = opts.analysisSource;
  const profile = vm?.profile;
  if (!profile || typeof profile !== 'object') return vm;
  const desc = (profile as Record<string, unknown>).description;
  if (typeof desc !== 'string' || !desc.trim()) return vm;
  const longLegacy = desc.length > 280;
  const fromLlm = source === 'llm';
  if (!fromLlm && !longLegacy) return vm;
  return {
    ...vm,
    profile: {
      ...(profile as Record<string, unknown>),
      description: personalizedDescriptionOneLiner(desc),
    },
  };
}
