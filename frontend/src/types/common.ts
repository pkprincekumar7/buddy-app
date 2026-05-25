export type ID = string;
export type Timestamp = string;

export type DispatchFn = (action: { type: string; payload?: unknown }) => void;
