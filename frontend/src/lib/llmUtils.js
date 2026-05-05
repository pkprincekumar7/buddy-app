// LLM sometimes wraps values as { type: "string", value: "..." } instead of plain values.
export const unwrapLLM = (val) =>
  val && typeof val === 'object' && 'value' in val ? val.value : val;
