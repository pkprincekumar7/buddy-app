// structuredClone is available in Node 17+ / Hermes but not in the RN tsconfig lib set
declare function structuredClone<T>(
  value: T,
  options?: { transfer?: Transferable[] },
): T;
