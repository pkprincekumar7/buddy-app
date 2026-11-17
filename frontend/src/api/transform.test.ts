import { describe, expect, it } from 'vitest';
import { planEditsDiffer, rebasePlanPatch, type TransformDoc } from './transform';

// Two devices saving one plan (api/transform.ts): this device's unsaved change, made on
// `base`, moved onto `server` (saved by the other device since). The browser tests (TRN-07)
// cover a map field end to end; these cover the rest of the rules.

const doc = (over: Partial<TransformDoc> = {}): TransformDoc => ({
  version: 1,
  areas: [],
  ask: null,
  plan: null,
  track_steps: null,
  applied: {},
  act_inputs: {},
  act_counts: {},
  track_done: {},
  track_inputs: {},
  track_sittings: {},
  feedback: {},
  event_name: null,
  event_date: null,
  event_set: false,
  photos: {},
  generating: [],
  completed_at: null,
  ...over,
});

const photos = (field: string, ...keys: string[]) => ({
  [field]: keys.map((key) => ({ key, url: null })),
});

describe('rebasePlanPatch: map fields', () => {
  it('keeps what only this device changed, next to the other device’s', () => {
    const base = doc();
    const server = doc({ act_counts: { b: 2 } });
    expect(rebasePlanPatch({ act_counts: { a: 1 } }, base, server)).toEqual({
      act_counts: { b: 2, a: 1 },
    });
  });

  it('where both changed one key, the server’s stays and nothing is sent', () => {
    const base = doc({ act_counts: { a: 1 } });
    const server = doc({ act_counts: { a: 5 } });
    expect(rebasePlanPatch({ act_counts: { a: 2 } }, base, server)).toEqual({});
  });

  it('a key this device removed goes, unless the other device changed it', () => {
    const base = doc({ track_done: { s1: true, s2: true } });
    expect(rebasePlanPatch({ track_done: { s2: true } }, base, base)).toEqual({
      track_done: { s2: true },
    });
    const server = doc({ track_done: { s1: false, s2: true } });
    expect(rebasePlanPatch({ track_done: { s2: true } }, base, server)).toEqual({});
  });
});

describe('rebasePlanPatch: the ask', () => {
  it('is kept when only this device changed it', () => {
    expect(rebasePlanPatch({ ask: 'Drawing' }, doc(), doc({ version: 2 }))).toEqual({
      ask: 'Drawing',
    });
  });

  it('is kept when a generation made the plan meanwhile (no plan, version 0, before)', () => {
    const base = doc({ version: 0 });
    const server = doc({ generating: ['life_pathway'] });
    expect(rebasePlanPatch({ ask: 'Building things' }, base, server)).toEqual({
      ask: 'Building things',
    });
    // Only the version and a generated part moved: not "Updated on another device".
    expect(planEditsDiffer(base, server)).toBe(false);
  });

  it("is dropped when the other device changed it too ('' counts as none)", () => {
    expect(rebasePlanPatch({ ask: 'Drawing' }, doc(), doc({ ask: 'Music' }))).toEqual({});
    expect(rebasePlanPatch({ ask: '' }, doc(), doc())).toEqual({});
  });
});

describe('rebasePlanPatch: the Day-90 event moves as one', () => {
  const mine = {
    event_name: 'Art show',
    event_date: '2027-02-01',
    event_set: true,
    clear_track_steps: true,
  };

  it('all of it, with clearing the old steps, when only this device set it', () => {
    expect(rebasePlanPatch(mine, doc(), doc({ act_counts: { x: 1 } }))).toEqual(mine);
  });

  it('none of it when the other device changed any part', () => {
    expect(rebasePlanPatch(mine, doc(), doc({ event_date: '2027-03-01' }))).toEqual({});
  });

  it('nothing when this device sent the event unchanged', () => {
    const base = doc({ event_name: 'Art show' });
    expect(rebasePlanPatch({ event_name: 'Art show' }, base, base)).toEqual({});
  });
});

describe('rebasePlanPatch: photos merge as sets', () => {
  it('adds this device’s new keys and removes its removed ones, keeping the other’s', () => {
    const base = doc({ photos: photos('f', 'p1', 'p2') });
    const server = doc({ photos: photos('f', 'p1', 'p2', 'theirs') });
    expect(rebasePlanPatch({ photos: { f: ['p1', 'mine'] } }, base, server)).toEqual({
      photos: { f: ['p1', 'theirs', 'mine'] },
    });
  });

  it('a key both added is not sent twice; nothing left means no photos field', () => {
    const base = doc();
    const server = doc({ photos: photos('f', 'same') });
    expect(rebasePlanPatch({ photos: { f: ['same'] } }, base, server)).toEqual({});
  });
});

describe('planEditsDiffer', () => {
  it('sees the parent’s edits, not the version or generated parts', () => {
    expect(planEditsDiffer(doc(), doc({ version: 7, generating: ['plan'] }))).toBe(false);
    expect(planEditsDiffer(doc(), doc({ ask: 'Drawing' }))).toBe(true);
    expect(planEditsDiffer(doc(), doc({ photos: photos('f', 'p') }))).toBe(true);
    expect(planEditsDiffer(doc({ ask: '' }), doc({ ask: null }))).toBe(false);
  });
});
