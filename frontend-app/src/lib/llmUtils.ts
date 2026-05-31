// LLM sometimes wraps values as { type: "string", value: "..." } instead of plain values.
export const unwrapLLM = (val: unknown): unknown =>
  val && typeof val === 'object' && 'value' in val
    ? (val as Record<string, unknown>).value
    : val;
