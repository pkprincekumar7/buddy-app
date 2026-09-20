import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { ApiError } from '@/api/errors';
import { useJob } from '@/hooks/useJob';
import {
  buildNinetyDayPlanPrompt,
  buildNinetyDayTrackerPrompt,
  ninetyDayPlanSchema,
  ninetyDayTrackerSchema,
} from '@/lib/ninetyDayPlanPrompt';
import { FB_TAGS, type FeedbackTag } from '@/lib/startJourneyPlans';
import type { ChildRecord, NinetyDayPlanRecord } from '@/types/api';

export interface ActivityFeedback {
  tag?: FeedbackTag | null;
  note?: string;
}

export interface PersonalityProfile {
  personality_type?: string;
  summary?: string;
  top_strengths?: unknown[];
}

interface UseNinetyDayPlanOptions {
  childId: string | undefined;
  childData: ChildRecord | null;
  profile: PersonalityProfile | null;
}

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

/** Coerces a stored document's photos map into the shape photoFiles keeps
 * locally — defensive against anything malformed, same reasoning as
 * normalizeFeedback above. */
function hydratePhotos(raw: unknown): Record<string, { url: string }[]> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, { url: string }[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const urls = value.filter((v): v is string => typeof v === 'string');
    if (urls.length) out[key] = urls.map((url) => ({ url }));
  }
  return out;
}

/** The inverse — only ever persists real uploaded URLs, never a transient
 * blob: preview that's still mid-upload (or failed and got rolled back). */
function toPhotosPayload(files: Record<string, { url: string }[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, items] of Object.entries(files)) {
    const urls = items.map((item) => item.url).filter((url) => !url.startsWith('blob:'));
    if (urls.length) out[key] = urls;
  }
  return out;
}

/**
 * Owns the "Start {name}'s 90 days" flow end to end: fetches/generates/persists
 * the plan + tracker document (backed by `GET/PATCH /user/ninety-day-plan`,
 * plus the generate_ninety_day_plan / generate_event_tracker LLM jobs), and
 * every mutating callback the Dashboard/Tracker steps use — replaces the old
 * unpersisted useNinetyDayProgress.
 */
export function useNinetyDayPlan({ childId, childData, profile }: UseNinetyDayPlanOptions) {
  const [doc, setDoc] = useState<NinetyDayPlanRecord | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);

  const [ask, setAsk] = useState('');
  const [monthIdx, setMonthIdx] = useState(0);
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [actOpen, setActOpen] = useState<string | null>(null);
  const [actIn, setActIn] = useState<Record<string, string>>({});
  const [actCt, setActCt] = useState<Record<string, number>>({});
  const [fb, setFb] = useState<Record<string, ActivityFeedback>>({});
  const [fbDraft, setFbDraft] = useState<Record<string, string>>({});
  const [photoFiles, setPhotoFiles] = useState<Record<string, { url: string }[]>>({});

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
    api.ninetyDayPlan
      .get(childId)
      .then((fetched) => {
        if (cancelled) return;
        setDoc(fetched);
        setAsk(typeof fetched.ask === 'string' ? fetched.ask : '');
        setApplied(fetched.applied ?? {});
        setActIn(fetched.act_inputs ?? {});
        setActCt(fetched.act_counts ?? {});
        setFb(normalizeFeedback(fetched.feedback));
        setPhotoFiles(hydratePhotos(fetched.photos));
        setEvName(fetched.event_name ?? '');
        setEvDate(fetched.event_date ?? '');
        setEvSet(fetched.event_set ?? false);
        setTrDone(fetched.track_done ?? {});
        setTrIn(fetched.track_inputs ?? {});
        setTrSit(fetched.track_sittings ?? {});
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
  const pendingPatchRef = useRef<Record<string, unknown>>({});
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPatch = useCallback(() => {
    if (!childId) return;
    const body = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(body).length === 0) return;
    api.ninetyDayPlan.patch(childId, body).catch((err) => {
      console.error('[useNinetyDayPlan] Failed to save progress:', err);
      toast.error('Could not save your progress. Please try again.');
    });
  }, [childId]);

  const schedulePatch = useCallback(
    (partial: Record<string, unknown>) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...partial };
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      patchTimerRef.current = setTimeout(flushPatch, PATCH_DEBOUNCE_MS);
    },
    [flushPatch],
  );

  useEffect(
    () => () => {
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      flushPatch();
    },
    [flushPatch],
  );

  // ─── Plan generation ─────────────────────────────────────────────────────

  const refetchDoc = useCallback(() => {
    if (!childId) return;
    return api.ninetyDayPlan.get(childId).then(setDoc);
  }, [childId]);

  const planJob = useJob({
    activeJobs: childData?.active_jobs,
    jobType: 'generate_ninety_day_plan',
    onCompleted: refetchDoc,
  });

  const generatePlan = useCallback(
    (askText: string) => {
      if (!childId) return;
      const prompt = buildNinetyDayPlanPrompt({
        childName: typeof childData?.name === 'string' ? childData.name : null,
        age: childData?.age ?? null,
        gender: typeof childData?.gender === 'string' ? childData.gender : null,
        ask: askText,
        archetype: profile?.personality_type ?? null,
        personalityNarrative: profile?.summary ?? null,
        strengths: Array.isArray(profile?.top_strengths)
          ? profile.top_strengths.map((v) => String(v)).filter(Boolean)
          : null,
      });
      void planJob.enqueue({
        type: 'generate_ninety_day_plan',
        child_id: childId,
        payload: { prompt, response_json_schema: ninetyDayPlanSchema() },
        write_back: { collection: 'ninety_day_plans', filter: {}, field: 'plan' },
      });
    },
    [childId, childData, profile, planJob],
  );

  // ─── Tracker generation ──────────────────────────────────────────────────

  const trackerJob = useJob({
    activeJobs: childData?.active_jobs,
    jobType: 'generate_event_tracker',
    onCompleted: refetchDoc,
  });

  const generateTrackSteps = useCallback(
    (eventName: string, eventDate: string, interestLabel: string) => {
      if (!childId) return;
      const prompt = buildNinetyDayTrackerPrompt({
        childName: typeof childData?.name === 'string' ? childData.name : null,
        age: childData?.age ?? null,
        gender: typeof childData?.gender === 'string' ? childData.gender : null,
        interestLabel,
        eventName,
        eventDate,
      });
      void trackerJob.enqueue({
        type: 'generate_event_tracker',
        child_id: childId,
        payload: { prompt, response_json_schema: ninetyDayTrackerSchema() },
        write_back: { collection: 'ninety_day_plans', filter: {}, field: 'track_steps' },
      });
    },
    [childId, childData, trackerJob],
  );

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

        api.ninetyDayPlan
          .uploadPhoto(childId, key, file)
          .then(({ photo_url }) => {
            setPhotoFiles((prev) => {
              const next = {
                ...prev,
                [key]: (prev[key] ?? []).map((p) => (p.url === localUrl ? { url: photo_url } : p)),
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
              err instanceof ApiError && err.status === 415
                ? 'That photo format isn’t supported. Try a JPEG, PNG, WEBP or GIF instead.'
                : 'Could not upload the photo. Please try again.',
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
    isGeneratingPlan: planJob.isLoading,
    planFailed: planJob.isFailed,
    generateTrackSteps,
    isGeneratingTrackSteps: trackerJob.isLoading,
    trackerFailed: trackerJob.isFailed,

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
