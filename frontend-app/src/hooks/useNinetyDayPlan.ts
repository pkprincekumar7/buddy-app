import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { ApiError } from '@/api/errors';
import { isAbort } from '@/api/polling';
import {
  planEditsDiffer,
  rebasePlanPatch,
  runTransformGeneration,
  transform,
  TRANSFORM_ERRORS,
  type PlanPatch,
  type PlanPhoto,
  type TransformDoc,
  type TransformKind,
} from '@/api/transform';
import { httpErrorMessage } from '@/lib/apiError';
import { avatarProblem } from '@/api/children';
import { FB_TAGS, type FeedbackTag } from '@/lib/startJourneyPlans';
import { useUnmountSignal } from '@/hooks/useUnmountSignal';

// A type, not an interface, so it fits the patch's `feedback` map (an index signature).
export type ActivityFeedback = {
  tag?: FeedbackTag | null;
  note?: string;
};

interface UseNinetyDayPlanOptions {
  childId: string | undefined;
}

/** A photo picked with expo-image-picker (`ImagePickerAsset` subset). */
export interface PickedPhoto {
  uri: string;
  mimeType?: string | null;
}

/** A photo on a plan item: its S3 key once uploaded (none while a local preview). */
interface PhotoItem {
  key?: string;
  url: string;
}

/** A picked photo the avatar type/size rules refuse, before anything is presigned. */
class PhotoRejected extends Error {}

type GenerationState = 'idle' | 'running' | 'failed';

const PATCH_DEBOUNCE_MS = 600;
// A save that failed on the way (offline, a 5xx) is tried again after 2 s, 4 s, … 30 s.
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;
// Saves refused because another device saved first, rebased and sent again, at most.
const REBASES = 3;

/** Worth sending again as it is: the network, a 5xx, or a limit. Anything else (a 422)
 * would be refused the same way every time. */
function retryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status >= 500 || err.status === 429 || err.status === 408;
}

/** Defensive coercion for a stored document's feedback map — a tag value
 * outside FB_TAGS (an older client, a manual edit) is dropped rather than
 * trusted, since it drives which of the fixed feedback-tag buttons lights up. */
function normalizeFeedback(raw: unknown): Record<string, ActivityFeedback> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ActivityFeedback> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const tag = FB_TAGS.includes(v.tag as FeedbackTag)
      ? (v.tag as FeedbackTag)
      : null;
    const note = typeof v.note === 'string' ? v.note : undefined;
    out[key] = { tag, note };
  }
  return out;
}

/** The stored photos (key and a short-lived URL each) as photoFiles keeps them. */
function hydratePhotos(
  raw: Record<string, PlanPhoto[]>,
): Record<string, PhotoItem[]> {
  const out: Record<string, PhotoItem[]> = {};
  for (const [key, photos] of Object.entries(raw)) {
    const items = photos.map(photo => ({
      key: photo.key,
      url: photo.url ?? '',
    }));
    if (items.length) out[key] = items;
  }
  return out;
}

/** The photos to show for `keys` (the merged plan's), with each key's URL from the server
 * or this device, plus the local previews still uploading here. */
function mergePhotos(
  keys: Record<string, PlanPhoto[]>,
  saving: Record<string, string[]> | null | undefined,
  local: Record<string, PhotoItem[]>,
): Record<string, PhotoItem[]> {
  const urls = new Map<string, string>();
  for (const items of Object.values(local))
    for (const item of items) if (item.key) urls.set(item.key, item.url);
  for (const photos of Object.values(keys))
    for (const p of photos) urls.set(p.key, p.url ?? '');
  const lists: Record<string, string[]> = {};
  for (const [field, photos] of Object.entries(keys))
    lists[field] = photos.map(p => p.key);
  Object.assign(lists, saving);
  const out: Record<string, PhotoItem[]> = {};
  for (const field of new Set([...Object.keys(lists), ...Object.keys(local)])) {
    const items = [
      ...(lists[field] ?? []).map(key => ({ key, url: urls.get(key) ?? '' })),
      ...(local[field] ?? []).filter(item => !item.key),
    ];
    if (items.length) out[field] = items;
  }
  return out;
}

/** The inverse: the keys to save, never a local preview that's still mid-upload (or
 * failed and got rolled back). A key sent replaces that key's list (build plan 7.7). */
function toPhotosPayload(
  files: Record<string, PhotoItem[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, items] of Object.entries(files)) {
    out[key] = items.flatMap(item => (item.key ? [item.key] : []));
  }
  return out;
}

/**
 * Owns the "Start {name}'s 90 days" flow end to end: fetches/generates/persists
 * the plan + tracker (backed by `GET/PATCH …/transform`, plus transform's `plan` and
 * `event_tracker` generations, whose prompts transform builds from the saved `ask` and
 * event — build plan 7.7), and every mutating callback the Dashboard/Tracker steps use.
 */
export function useNinetyDayPlan({ childId }: UseNinetyDayPlanOptions) {
  const [doc, setDoc] = useState<TransformDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  // The load failed: local state is empty, not the parent's, so nothing may be
  // saved or generated from it — each PATCH field replaces the stored one, and an
  // empty map sent from here would wipe what the parent already saved.
  const [loadError, setLoadError] = useState<unknown>(null);
  // Mirrors "a load succeeded for this child" for the callbacks, free of render timing.
  const loadedRef = useRef(false);
  // The plan as the server last returned it for this device's saves: every PATCH is made
  // on its `version`, and a conflict is merged three ways against it.
  const serverRef = useRef<TransformDoc | null>(null);
  // The child `serverRef` and the pending buffer belong to (set when its load lands), and
  // the child shown now. A save, reload or retry still running for the previous child
  // touches only that child's; once the child changed, its failure is dropped, never
  // retried, so one child's edits can't be saved onto another's plan.
  const ownerRef = useRef<string | undefined>(undefined);
  const childIdRef = useRef(childId);
  childIdRef.current = childId;
  const isCurrent = useCallback(
    (id: string) => ownerRef.current === id && childIdRef.current === id,
    [],
  );

  const [reloadKey, setReloadKey] = useState(0);

  const [ask, setAsk] = useState('');
  const [monthIdx, setMonthIdx] = useState(0);
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [actOpen, setActOpen] = useState<string | null>(null);
  const [actIn, setActIn] = useState<Record<string, string>>({});
  const [actCt, setActCt] = useState<Record<string, number>>({});
  const [fb, setFb] = useState<Record<string, ActivityFeedback>>({});
  const [fbDraft, setFbDraft] = useState<Record<string, string>>({});
  const [photoFiles, setPhotoFiles] = useState<Record<string, PhotoItem[]>>({});
  const [planState, setPlanState] = useState<GenerationState>('idle');
  const [trackerState, setTrackerState] = useState<GenerationState>('idle');

  const [evName, setEvName] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evSet, setEvSet] = useState(false);

  const [trDone, setTrDone] = useState<Record<string, boolean>>({});
  const [trStep, setTrStep] = useState<number | null>(null);
  const [trIn, setTrIn] = useState<Record<string, string>>({});
  const [trSit, setTrSit] = useState<Record<string, boolean>>({});

  // Fetch on mount / whenever the child changes, and hydrate local state from
  // whatever the parent already saved instead of always starting empty.
  useEffect(() => {
    if (!childId) return;
    let cancelled = false;
    loadedRef.current = false;
    setLoadingDoc(true);
    setLoadError(null);
    transform
      .get(childId)
      .then(fetched => {
        if (cancelled) return;
        loadedRef.current = true;
        serverRef.current = fetched;
        ownerRef.current = childId;
        failuresRef.current = 0;
        pendingPatchRef.current = {};
        setDoc(fetched);
        setAsk(fetched.ask ?? '');
        setApplied(fetched.applied);
        setActIn(fetched.act_inputs);
        setActCt(fetched.act_counts);
        setFb(normalizeFeedback(fetched.feedback));
        setPhotoFiles(hydratePhotos(fetched.photos));
        setEvName(fetched.event_name ?? '');
        setEvDate(fetched.event_date ?? '');
        setEvSet(fetched.event_set);
        setTrDone(fetched.track_done);
        setTrIn(fetched.track_inputs);
        setTrSit(fetched.track_sittings);
        // A generation still running (another device, or a reload mid-run): join it.
        if (fetched.generating.includes('plan'))
          setResume(prev => [...prev, 'plan']);
        if (fetched.generating.includes('event_tracker'))
          setResume(prev => [...prev, 'event_tracker']);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[useNinetyDayPlan] Could not load the saved plan:', err);
        setLoadError(err ?? new Error('load failed'));
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });
    return () => {
      cancelled = true;
    };
  }, [childId, reloadKey]);

  /** Loads the saved plan again, after a failed load. */
  const reload = useCallback(() => setReloadKey(n => n + 1), []);

  // Debounced persistence — merges every scheduled patch into one pending buffer so a
  // burst of quick taps/keystrokes becomes one write. One save runs at a time, each on
  // the version the last one returned; a failed one goes back into the buffer.
  const pendingPatchRef = useRef<PlanPatch>({});
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);
  const savingRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Local state as `server` plus what's still unsaved here (after a conflict, a refused
   * save, or a reload): the merged plan the next save starts from. */
  const showMerged = useCallback((server: TransformDoc, unsaved: PlanPatch) => {
    setDoc(server);
    setAsk(unsaved.ask ?? server.ask ?? '');
    setApplied(unsaved.applied ?? server.applied);
    setActIn(unsaved.act_inputs ?? server.act_inputs);
    setActCt(unsaved.act_counts ?? server.act_counts);
    setFb(normalizeFeedback(unsaved.feedback ?? server.feedback));
    setPhotoFiles(local => mergePhotos(server.photos, unsaved.photos, local));
    setEvName(unsaved.event_name ?? server.event_name ?? '');
    setEvDate(unsaved.event_date ?? server.event_date ?? '');
    setEvSet(unsaved.event_set ?? server.event_set);
    setTrDone(unsaved.track_done ?? server.track_done);
    setTrIn(unsaved.track_inputs ?? server.track_inputs);
    setTrSit(unsaved.track_sittings ?? server.track_sittings);
  }, []);

  /** The plan from the server again, with what's unsaved here moved onto it. */
  const rebase = useCallback(
    async (failed: PlanPatch): Promise<boolean> => {
      const base = serverRef.current;
      if (!childId || !base || !isCurrent(childId)) return false;
      let server: TransformDoc;
      try {
        server = await transform.get(childId);
      } catch (err) {
        console.error('[useNinetyDayPlan] Could not reload the plan:', err);
        return false;
      }
      if (!isCurrent(childId)) return false; // another child's plan now
      const unsaved = rebasePlanPatch(
        { ...failed, ...pendingPatchRef.current },
        base,
        server,
      );
      if (planEditsDiffer(base, server)) toast('Updated on another device');
      serverRef.current = server;
      pendingPatchRef.current = unsaved;
      showMerged(server, unsaved);
      return true;
    },
    [childId, isCurrent, showMerged],
  );

  const save = useCallback(async (): Promise<boolean> => {
    for (let rebases = 0; ; rebases += 1) {
      const base = serverRef.current;
      const body = pendingPatchRef.current;
      // Still this child's buffer: the flush on a child change sends it, on its version.
      if (!childId || !base || ownerRef.current !== childId) return false;
      if (Object.keys(body).length === 0) return true;
      pendingPatchRef.current = {};
      try {
        const saved = await transform.patch(childId, base.version, body);
        if (ownerRef.current !== childId) return true; // another child's plan now
        serverRef.current = saved;
        failuresRef.current = 0;
        if (childIdRef.current === childId) setDoc(saved);
        return true;
      } catch (err) {
        // Another device saved first: move this change onto its plan and save again.
        const conflict = err instanceof ApiError && err.code === 'plan_changed';
        if (conflict && rebases < REBASES && (await rebase(body))) continue;
        console.error('[useNinetyDayPlan] Failed to save progress:', err);
        // Another child's plan now: dropped, not kept or retried onto it.
        if (!isCurrent(childId)) return false;
        if (conflict || retryable(err)) {
          // Kept, newer edits winning, and sent again: on the next save, or after a pause.
          pendingPatchRef.current = { ...body, ...pendingPatchRef.current };
          failuresRef.current += 1;
          if (failuresRef.current === 1) {
            toast.error(
              httpErrorMessage(err as Error, {
                codeMessages: TRANSFORM_ERRORS,
                fallback: 'Could not save your progress. We’ll keep trying.',
              }),
            );
          }
          if (mountedRef.current && !retryTimerRef.current) {
            const wait = Math.min(
              RETRY_MAX_MS,
              RETRY_BASE_MS * 2 ** (failuresRef.current - 1),
            );
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              if (isCurrent(childId)) void flushPatchRef.current();
            }, wait);
          }
          return false;
        }
        // Refused as it is (e.g. too large): show the saved plan again, with the rest.
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: TRANSFORM_ERRORS,
            fallback: 'Could not save your progress. Please try again.',
          }),
        );
        await rebase({});
        return false;
      }
    }
  }, [childId, isCurrent, rebase]);

  const flushPatch = useCallback((): Promise<boolean> => {
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = null;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    // After the save in flight, so each is made on the version the last one returned.
    const next = savingRef.current.then(save, save);
    savingRef.current = next;
    return next;
  }, [save]);
  const flushPatchRef = useRef(flushPatch);
  flushPatchRef.current = flushPatch;

  const schedulePatch = useCallback(
    (partial: PlanPatch) => {
      // Never save over the stored document from state that wasn't loaded from it.
      if (!loadedRef.current) return;
      pendingPatchRef.current = { ...pendingPatchRef.current, ...partial };
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(
        () => void flushPatch(),
        PATCH_DEBOUNCE_MS,
      );
    },
    [flushPatch],
  );

  useEffect(
    () => () => {
      void flushPatch();
    },
    [flushPatch],
  );

  // ─── Plan and tracker generation ─────────────────────────────────────────

  // Stops polling when the flow goes away.
  const abortRef = useUnmountSignal();
  // Generations found running on load, to join.
  const [resume, setResume] = useState<TransformKind[]>([]);

  /**
   * Saves whatever is pending (transform builds the prompt from the saved `ask` and
   * event), runs the generation, then reads the plan back.
   */
  const runGeneration = useCallback(
    async (kind: 'plan' | 'event_tracker') => {
      if (!childId || !loadedRef.current) return;
      const setState = kind === 'plan' ? setPlanState : setTrackerState;
      setState('running');
      try {
        if (!(await flushPatch())) {
          setState('failed');
          return;
        }
        const outcome = await runTransformGeneration(childId, kind, {
          signal: abortRef.current.signal,
        });
        if (outcome === 'completed') {
          setDoc(await transform.get(childId));
          setState('idle');
        } else {
          setState('failed');
        }
      } catch (err) {
        if (isAbort(err)) return;
        console.error(`[useNinetyDayPlan] ${kind} generation failed:`, err);
        toast.error(
          httpErrorMessage(err as Error, {
            codeMessages: TRANSFORM_ERRORS,
            fallback: 'Could not build the plan. Please try again.',
          }),
        );
        setState('failed');
      }
    },
    [abortRef, childId, flushPatch],
  );

  useEffect(() => {
    if (resume.length === 0) return;
    for (const kind of resume) {
      if (kind === 'plan' || kind === 'event_tracker') void runGeneration(kind);
    }
    setResume([]);
  }, [resume, runGeneration]);

  const generatePlan = useCallback(
    (askText: string) => {
      // The plan is built around the parent's words: make sure they're the saved ones.
      schedulePatch({ ask: askText });
      void runGeneration('plan');
    },
    [schedulePatch, runGeneration],
  );

  /** The tracker, built around the saved Day-90 event and the same `ask`. */
  const generateTrackSteps = useCallback(() => {
    void runGeneration('event_tracker');
  }, [runGeneration]);

  // ─── Local-state callbacks — each also schedules a save ─────────────────

  const setAskAndSave = useCallback(
    (value: string) => {
      setAsk(value);
      schedulePatch({ ask: value });
    },
    [schedulePatch],
  );

  const toggleActOpen = useCallback((id: string) => {
    setActOpen(prev => (prev === id ? null : id));
  }, []);

  const setActField = useCallback(
    (key: string, value: string) => {
      setActIn(prev => {
        const next = { ...prev, [key]: value };
        schedulePatch({ act_inputs: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const incCount = useCallback(
    (key: string, step: number) => {
      setActCt(prev => {
        const next = { ...prev, [key]: (prev[key] ?? 0) + step };
        schedulePatch({ act_counts: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const decCount = useCallback(
    (key: string, step: number) => {
      setActCt(prev => {
        const next = { ...prev, [key]: Math.max(0, (prev[key] ?? 0) - step) };
        schedulePatch({ act_counts: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const setFeedbackTag = useCallback(
    (activityId: string, tag: FeedbackTag) => {
      setFb(prev => {
        const current = prev[activityId];
        const next = {
          ...prev,
          [activityId]: { ...current, tag: current?.tag === tag ? null : tag },
        };
        schedulePatch({ feedback: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const setFeedbackDraft = useCallback((activityId: string, text: string) => {
    setFbDraft(prev => ({ ...prev, [activityId]: text }));
  }, []);

  const sendFeedbackNote = useCallback(
    (activityId: string) => {
      const draft = (fbDraft[activityId] ?? '').trim();
      if (!draft) return;
      setFb(prev => {
        const next = {
          ...prev,
          [activityId]: { ...prev[activityId], note: draft },
        };
        schedulePatch({ feedback: next });
        return next;
      });
      setFbDraft(prev => ({ ...prev, [activityId]: '' }));
    },
    [fbDraft, schedulePatch],
  );

  const addPhotos = useCallback(
    // RN: `files` are expo-image-picker assets (local file URIs) instead of a web FileList.
    (key: string, files: PickedPhoto[] | null) => {
      if (!files || files.length === 0 || !childId || !loadedRef.current)
        return;
      const imageFiles = files.filter(f =>
        (f.mimeType ?? 'image/jpeg').startsWith('image/'),
      );
      if (imageFiles.length === 0) {
        // Silent no-op otherwise — e.g. a HEIC photo some browsers report
        // with no MIME type at all never even reaches the backend's own
        // format check below, so this is the only place that case surfaces.
        toast.error(
          'That file doesn’t look like a photo. Try a JPEG, PNG, WEBP or GIF.',
        );
        return;
      }

      imageFiles.forEach(file => {
        // Shown immediately as a local preview while the real upload runs in
        // the background — swapped for the permanent S3 URL once it lands.
        // The picker's local file URI renders directly in <Image>.
        const localUrl = file.uri;
        const contentType = file.mimeType ?? 'image/jpeg';
        setPhotoFiles(prev => ({
          ...prev,
          [key]: [...(prev[key] ?? []), { url: localUrl }],
        }));

        fetch(file.uri)
          .then(local => local.blob())
          .then(photo => {
            // Same type and 5 MB limits as avatars, checked before presigning.
            const problem = avatarProblem(contentType, photo.size);
            if (problem) throw new PhotoRejected(problem);
            return transform.uploadPhoto(childId, key, photo, contentType);
          })
          .then(uploaded => {
            setPhotoFiles(prev => {
              const next = {
                ...prev,
                [key]: (prev[key] ?? []).map(p =>
                  p.url === localUrl
                    ? { key: uploaded.key, url: uploaded.url ?? '' }
                    : p,
                ),
              };
              schedulePatch({ photos: toPhotosPayload(next) });
              return next;
            });
          })
          .catch(err => {
            console.error('[useNinetyDayPlan] Photo upload failed:', err);
            // A 415 (e.g. an iPhone HEIC photo the backend's allow-list
            // rejects) needs a different message — "try again" is actively
            // wrong when retrying the same file will fail identically.
            toast.error(
              err instanceof PhotoRejected
                ? err.message
                : httpErrorMessage(err as Error, {
                    codeMessages: TRANSFORM_ERRORS,
                    statusMessages: {
                      415: 'That photo format isn’t supported. Try a JPEG, PNG, WEBP or GIF instead.',
                    },
                    fallback: 'Could not upload the photo. Please try again.',
                  }),
            );
            setPhotoFiles(prev => ({
              ...prev,
              [key]: (prev[key] ?? []).filter(p => p.url !== localUrl),
            }));
          });
      });
    },
    [childId, schedulePatch],
  );

  const removePhoto = useCallback(
    (key: string, index: number) => {
      setPhotoFiles(prev => {
        const next = {
          ...prev,
          [key]: (prev[key] ?? []).filter((_, i) => i !== index),
        };
        schedulePatch({ photos: toPhotosPayload(next) });
        return next;
      });
    },
    [schedulePatch],
  );

  const toggleApplied = useCallback(
    (activityId: string) => {
      setApplied(prev => {
        const next = { ...prev, [activityId]: !prev[activityId] };
        schedulePatch({ applied: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const saveTarget = useCallback(() => {
    const name = evName.trim();
    if (name.length <= 1 || !evDate) return;
    setEvSet(true);
    // Re-targeting after a tracker was already generated invalidates it — the
    // old steps were written for a different event and would otherwise sit
    // there silently mismatched with the new one. Clear it optimistically (so
    // hasTrackSteps flips immediately, no refetch round-trip needed) and tell
    // the server to drop it too.
    const retargeted =
      !!doc?.track_steps &&
      (doc?.event_name !== name || doc?.event_date !== evDate);
    if (retargeted) {
      setDoc(prev => (prev ? { ...prev, track_steps: null } : prev));
    }
    schedulePatch({
      event_name: name,
      event_date: evDate,
      event_set: true,
      ...(retargeted ? { clear_track_steps: true } : {}),
    });
  }, [evName, evDate, doc, schedulePatch]);

  const editTarget = useCallback(() => {
    setEvSet(false);
    schedulePatch({ event_set: false });
  }, [schedulePatch]);

  const toggleTrackDone = useCallback(
    (stepIdx: number) => {
      setTrDone(prev => {
        const next = { ...prev };
        const key = String(stepIdx);
        if (next[key]) delete next[key];
        else next[key] = true;
        schedulePatch({ track_done: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const setTrackField = useCallback(
    (key: string, value: string) => {
      setTrIn(prev => {
        const next = { ...prev, [key]: value };
        schedulePatch({ track_inputs: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const toggleSitting = useCallback(
    (week: number) => {
      setTrSit(prev => {
        const next = { ...prev };
        const key = String(week);
        if (next[key]) delete next[key];
        else next[key] = true;
        schedulePatch({ track_sittings: next });
        return next;
      });
    },
    [schedulePatch],
  );

  return {
    doc,
    loadingDoc,
    /** The saved plan couldn't be loaded; saving and generation are off until `reload` succeeds. */
    loadError,
    loadFailed: loadError !== null,
    reload,
    hasPlan: !!doc?.plan,
    hasTrackSteps: !!doc?.track_steps,
    generatePlan,
    isGeneratingPlan: planState === 'running',
    planFailed: planState === 'failed',
    generateTrackSteps,
    isGeneratingTrackSteps: trackerState === 'running',
    trackerFailed: trackerState === 'failed',

    ask,
    setAsk: setAskAndSave,
    monthIdx,
    setMonthIdx,
    applied,
    toggleApplied,
    actOpen,
    toggleActOpen,
    actIn,
    setActField,
    actCt,
    incCount,
    decCount,
    fb,
    setFeedbackTag,
    fbDraft,
    setFeedbackDraft,
    sendFeedbackNote,
    photoFiles,
    addPhotos,
    removePhoto,

    evName,
    setEvName,
    evDate,
    setEvDate,
    evSet,
    saveTarget,
    editTarget,

    trDone,
    toggleTrackDone,
    trStep,
    setTrStep,
    trIn,
    setTrackField,
    trSit,
    toggleSitting,
  };
}

export type NinetyDayPlan = ReturnType<typeof useNinetyDayPlan>;
