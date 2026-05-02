/** Collapse LLM prose to a single short line for UI and downstream summary fields. */
export function personalizedDescriptionOneLiner(raw, maxLen = 180) {
  const flat = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!flat) return '';
  let sentence = flat;
  const m = flat.match(/^(.+?[.!?])(\s|$)/);
  if (m) sentence = m[1].trim();
  if (sentence.length > maxLen) {
    sentence = sentence.slice(0, maxLen).trimEnd();
    const lastSpace = sentence.lastIndexOf(' ');
    if (lastSpace > Math.floor(maxLen * 0.5)) sentence = sentence.slice(0, lastSpace);
    sentence = `${sentence}…`;
  }
  return sentence;
}

/** Prefer one-liner for LLM-derived persisted profiles; leave shorter/rule copy unchanged. */
export function maybeClampStoredPersonalityDescription(vm, opts = {}) {
  const source = opts.analysisSource;
  const desc = vm?.profile?.description;
  if (!vm?.profile || typeof desc !== 'string' || !desc.trim()) return vm;
  const longLegacy = desc.length > 280;
  const fromLlm = source === 'llm';
  if (!fromLlm && !longLegacy) return vm;
  return {
    ...vm,
    profile: {
      ...vm.profile,
      description: personalizedDescriptionOneLiner(desc),
    },
  };
}
