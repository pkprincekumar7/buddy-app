import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { isAbort } from '@/api/polling';
import {
  runTransformGeneration,
  transform,
  TRANSFORM_ERRORS,
  type PlanPatch,
  type PlanPhoto,
  type TransformDoc,
  type TransformKind,
} from '@/api/transform';
import { httpErrorMessage } from '@/lib/apiError';
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

/** A photo on a plan item: its S3 key once uploaded (none while a local preview). */
interface PhotoItem {
  key?: string;
  url: string;
}

type GenerationState = 'idle' | 'running' | 'failed';

const PATCH_DEBOUNCE_MS = 600;

/** Defensive coercion for a stored document's feedback map — a tag value
 * outside FB_TAGS (an older client, a manual edit) is dropped rather than
 * trusted, since it drives which of the fixed feedback-tag buttons lights up. */
function normalizeFeedback(raw: unknown): Record<string, ActivityFeedback> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ActivityFeedback> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const tag = FB_TAGS.includes(v.tag as FeedbackTag) ? (v.tag as FeedbackTag) : null;
    const note = typeof v.note === 'string' ? v.note : undefined;
    out[key] = { tag, note };
  }
  return out;
}

/** The stored photos (key and a short-lived URL each) as photoFiles keeps them. */
function hydratePhotos(raw: Record<string, PlanPhoto[]>): Record<string, PhotoItem[]> {
  const out: Record<string, PhotoItem[]> = {};
  for (const [key, photos] of Object.entries(raw)) {
    const items = photos.map((photo) => ({ key: photo.key, url: photo.url ?? '' }));
    if (items.length) out[key] = items;
  }
  return out;
}

/** The inverse: the keys to save, never a local preview that's still mid-upload (or
 * failed and got rolled back). A key sent replaces that key's list (build plan 7.7). */
function toPhotosPayload(files: Record<string, PhotoItem[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, items] of Object.entries(files)) {
    out[key] = items.flatMap((item) => (item.key ? [item.key] : []));
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
    setLoadingDoc(true);
    transform
      .get(childId)
      .then((fetched) => {
        if (cancelled) return;
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
        if (fetched.generating.includes('plan')) setResume((prev) => [...prev, 'plan']);
        if (fetched.generating.includes('event_tracker'))
          setResume((prev) => [...prev, 'event_tracker']);
      })
      .catch((err) => {
        console.warn('[useNinetyDayPlan] Could not load the saved plan:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });
    return () => {
      cancelled = true;
    };
  }, [childId]);

  // Debounced, best-effort persistence — merges every scheduled patch into one
  // pending buffer so a burst of quick taps/keystrokes becomes one write.
  const pendingPatchRef = useRef<PlanPatch>({});
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPatch = useCallback(async (): Promise<boolean> => {
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = null;
    if (!childId) return false;
    const body = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(body).length === 0) return true;
    try {
      await transform.patch(childId, body);
      return true;
    } catch (err) {
      console.error('[useNinetyDayPlan] Failed to save progress:', err);
      toast.error(
        httpErrorMessage(err as Error, {
          codeMessages: TRANSFORM_ERRORS,
          fallback: 'Could not save your progress. Please try again.',
        }),
      );
      return false;
    }
  }, [childId]);

  const schedulePatch = useCallback(
    (partial: PlanPatch) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...partial };
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(() => void flushPatch(), PATCH_DEBOUNCE_MS);
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
      if (!childId) return;
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
    setActOpen((prev) => (prev === id ? null : id));
  }, []);

  const setActField = useCallback(
    (key: string, value: string) => {
      setActIn((prev) => {
        const next = { ...prev, [key]: value };
        schedulePatch({ act_inputs: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const incCount = useCallback(
    (key: string, step: number) => {
      setActCt((prev) => {
        const next = { ...prev, [key]: (prev[key] ?? 0) + step };
        schedulePatch({ act_counts: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const decCount = useCallback(
    (key: string, step: number) => {
      setActCt((prev) => {
        const next = { ...prev, [key]: Math.max(0, (prev[key] ?? 0) - step) };
        schedulePatch({ act_counts: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const setFeedbackTag = useCallback(
    (activityId: string, tag: FeedbackTag) => {
      setFb((prev) => {
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
    setFbDraft((prev) => ({ ...prev, [activityId]: text }));
  }, []);

  const sendFeedbackNote = useCallback(
    (activityId: string) => {
      const draft = (fbDraft[activityId] ?? '').trim();
      if (!draft) return;
      setFb((prev) => {
        const next = { ...prev, [activityId]: { ...prev[activityId], note: draft } };
        schedulePatch({ feedback: next });
        return next;
      });
      setFbDraft((prev) => ({ ...prev, [activityId]: '' }));
    },
    [fbDraft, schedulePatch],
  );

  const addPhotos = useCallback(
    (key: string, files: FileList | null) => {
      if (!files || files.length === 0 || !childId) return;
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        // Silent no-op otherwise — e.g. a HEIC photo some browsers report
        // with no MIME type at all never even reaches the backend's own
        // format check below, so this is the only place that case surfaces.
        toast.error('That file doesn’t look like a photo. Try a JPEG, PNG, WEBP or GIF.');
        return;
      }

      imageFiles.forEach((file) => {
        // Shown immediately as a local preview while the real upload runs in
        // the background — swapped for the permanent S3 URL once it lands.
        const localUrl = URL.createObjectURL(file);
        setPhotoFiles((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), { url: localUrl }] }));

        transform
          .uploadPhoto(childId, key, file, file.type)
          .then((uploaded) => {
            setPhotoFiles((prev) => {
              const next = {
                ...prev,
                [key]: (prev[key] ?? []).map((p) =>
                  p.url === localUrl ? { key: uploaded.key, url: uploaded.url ?? '' } : p,
                ),
              };
              schedulePatch({ photos: toPhotosPayload(next) });
              return next;
            });
          })
          .catch((err) => {
            console.error('[useNinetyDayPlan] Photo upload failed:', err);
            // A 415 (e.g. an iPhone HEIC photo the backend's allow-list
            // rejects) needs a different message — "try again" is actively
            // wrong when retrying the same file will fail identically.
            toast.error(
              httpErrorMessage(err as Error, {
                codeMessages: TRANSFORM_ERRORS,
                statusMessages: {
                  415: 'That photo format isn’t supported. Try a JPEG, PNG, WEBP or GIF instead.',
                },
                fallback: 'Could not upload the photo. Please try again.',
              }),
            );
            setPhotoFiles((prev) => ({
              ...prev,
              [key]: (prev[key] ?? []).filter((p) => p.url !== localUrl),
            }));
          })
          .finally(() => URL.revokeObjectURL(localUrl));
      });
    },
    [childId, schedulePatch],
  );

  const removePhoto = useCallback(
    (key: string, index: number) => {
      setPhotoFiles((prev) => {
        const next = { ...prev, [key]: (prev[key] ?? []).filter((_, i) => i !== index) };
        schedulePatch({ photos: toPhotosPayload(next) });
        return next;
      });
    },
    [schedulePatch],
  );

  const toggleApplied = useCallback(
    (activityId: string) => {
      setApplied((prev) => {
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
      !!doc?.track_steps && (doc?.event_name !== name || doc?.event_date !== evDate);
    if (retargeted) {
      setDoc((prev) => (prev ? { ...prev, track_steps: null } : prev));
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
      setTrDone((prev) => {
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
      setTrIn((prev) => {
        const next = { ...prev, [key]: value };
        schedulePatch({ track_inputs: next });
        return next;
      });
    },
    [schedulePatch],
  );

  const toggleSitting = useCallback(
    (week: number) => {
      setTrSit((prev) => {
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
