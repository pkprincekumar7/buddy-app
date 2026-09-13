import { useCallback, useState } from 'react';
import type { FeedbackTag } from '@/lib/startJourneyPlans';

export interface ActivityFeedback {
  tag?: FeedbackTag | null;
  note?: string;
}

/**
 * Owns the local, unpersisted state shared by the StartJourneyModal's
 * Dashboard (step 4) and Tracker (step 5) — the achievement checklist, the
 * Day 90 target event, and the tracker's own step progress. Nothing here is
 * written anywhere; it exists only for the lifetime of one modal session,
 * matching the rest of this feature.
 */
export function useNinetyDayProgress() {
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

  const [trDone, setTrDone] = useState<Record<number, boolean>>({});
  const [trStep, setTrStep] = useState<number | null>(null);
  const [trIn, setTrIn] = useState<Record<string, string>>({});
  const [trSit, setTrSit] = useState<Record<number, boolean>>({});

  const toggleActOpen = useCallback((id: string) => {
    setActOpen((prev) => (prev === id ? null : id));
  }, []);

  const setActField = useCallback((key: string, value: string) => {
    setActIn((prev) => ({ ...prev, [key]: value }));
  }, []);

  const incCount = useCallback((key: string, step: number) => {
    setActCt((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + step }));
  }, []);

  const decCount = useCallback((key: string, step: number) => {
    setActCt((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) - step) }));
  }, []);

  const setFeedbackTag = useCallback((activityId: string, tag: FeedbackTag) => {
    setFb((prev) => {
      const current = prev[activityId];
      return {
        ...prev,
        [activityId]: { ...current, tag: current?.tag === tag ? null : tag },
      };
    });
  }, []);

  const setFeedbackDraft = useCallback((activityId: string, text: string) => {
    setFbDraft((prev) => ({ ...prev, [activityId]: text }));
  }, []);

  const sendFeedbackNote = useCallback(
    (activityId: string) => {
      const draft = (fbDraft[activityId] ?? '').trim();
      if (!draft) return;
      setFb((prev) => ({ ...prev, [activityId]: { ...prev[activityId], note: draft } }));
      setFbDraft((prev) => ({ ...prev, [activityId]: '' }));
    },
    [fbDraft],
  );

  const addPhotos = useCallback((key: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({ url: URL.createObjectURL(f) }));
    if (added.length === 0) return;
    setPhotoFiles((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...added] }));
  }, []);

  const removePhoto = useCallback((key: string, index: number) => {
    setPhotoFiles((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).filter((_, i) => i !== index),
    }));
  }, []);

  const toggleApplied = useCallback((activityId: string) => {
    setApplied((prev) => ({ ...prev, [activityId]: !prev[activityId] }));
  }, []);

  const saveTarget = useCallback(() => {
    if (evName.trim().length > 1 && evDate) setEvSet(true);
  }, [evName, evDate]);

  const editTarget = useCallback(() => setEvSet(false), []);

  const toggleTrackDone = useCallback((stepIdx: number) => {
    setTrDone((prev) => {
      const next = { ...prev };
      if (next[stepIdx]) delete next[stepIdx];
      else next[stepIdx] = true;
      return next;
    });
  }, []);

  const setTrackField = useCallback((key: string, value: string) => {
    setTrIn((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSitting = useCallback((week: number) => {
    setTrSit((prev) => {
      const next = { ...prev };
      if (next[week]) delete next[week];
      else next[week] = true;
      return next;
    });
  }, []);

  return {
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

export type NinetyDayProgress = ReturnType<typeof useNinetyDayProgress>;
