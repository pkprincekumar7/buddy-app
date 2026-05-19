import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { debounce } from 'lodash';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Star, Rocket, Clock, ThumbsUp, ThumbsDown, ChevronLeft, ChevronRight, Brain, Heart, Dumbbell, Palette, Target, Compass, Zap, Award, MessageSquare } from 'lucide-react';
import { Button } from "@/components/ui/button";
import TextareaWithVoice from '../shared/TextareaWithVoice';
import { api } from '@/api/client';
import { toast } from 'sonner';
import ChildActivityGame, { normalizeChildGameRecommendations } from './ChildActivityGame';
import { createPageUrl } from '@/utils';
import { pickPreferredVoice } from '@/lib/tts';

function suggestedActivitiesFromGameRecommendations(rec) {
  if (!rec || typeof rec !== 'object') return [];
  const n = normalizeChildGameRecommendations(rec);
  return Array.isArray(n.suggested_activities) ? n.suggested_activities : [];
}

const growthAreas = [
  { id: 'life_ambition', name: 'Life Ambition', icon: Rocket, color: 'from-purple-500 to-indigo-600', description: 'Discovering purpose and future goals' },
  { id: 'self_care', name: 'Self Care', icon: Heart, color: 'from-rose-500 to-pink-600', description: 'Building healthy habits and emotional wellness' },
  { id: 'critical_thinking', name: 'Critical Thinking', icon: Brain, color: 'from-blue-500 to-cyan-600', description: 'Problem solving and analytical skills' },
  { id: 'creativity', name: 'Creativity', icon: Palette, color: 'from-amber-500 to-orange-600', description: 'Imagination and creative expression' },
  { id: 'physical_wellness', name: 'Physical Wellness', icon: Dumbbell, color: 'from-emerald-500 to-teal-600', description: 'Body awareness and physical health' },
  { id: 'social_skills', name: 'Social Skills', icon: MessageSquare, color: 'from-violet-500 to-purple-600', description: 'Communication and relationship building' }
];

const sampleActivities = {
  life_ambition: [
    { title: 'Dream Board Creation', description: 'Create a visual board of future dreams and goals', duration: '20 mins', type: 'creative' },
    { title: 'Career Explorer Quiz', description: 'Fun quiz to discover interests and potential paths', duration: '10 mins', type: 'game' },
    { title: 'Future Self Letter', description: 'Write a letter to yourself 10 years from now', duration: '15 mins', type: 'reflection' }
  ],
  self_care: [
    { title: 'Emotion Detective', description: 'Identify and name different emotions through scenarios', duration: '10 mins', type: 'game' },
    { title: 'Mindful Breathing Adventure', description: 'Learn calming techniques through a fun story', duration: '8 mins', type: 'activity' },
    { title: 'Gratitude Treasure Hunt', description: 'Find 5 things to be grateful for today', duration: '10 mins', type: 'challenge' }
  ],
  critical_thinking: [
    { title: 'Mystery Solver', description: 'Solve fun logic puzzles and riddles', duration: '15 mins', type: 'game' },
    { title: 'What Would You Do?', description: 'Decision-making scenarios with multiple outcomes', duration: '12 mins', type: 'interactive' },
    { title: 'Pattern Detective', description: 'Find patterns and predict what comes next', duration: '10 mins', type: 'puzzle' }
  ],
  creativity: [
    { title: 'Story Remix', description: 'Take a familiar story and give it a creative twist', duration: '15 mins', type: 'creative' },
    { title: 'Invention Challenge', description: 'Design a solution for an everyday problem', duration: '20 mins', type: 'challenge' },
    { title: 'Music & Mood', description: 'Create sounds that match different emotions', duration: '10 mins', type: 'interactive' }
  ],
  physical_wellness: [
    { title: 'Body Scan Adventure', description: 'Fun guided body awareness activity', duration: '8 mins', type: 'activity' },
    { title: 'Movement Challenge', description: 'Quick fun physical challenges to try', duration: '10 mins', type: 'game' },
    { title: 'Healthy Habits Hero', description: 'Track and celebrate healthy daily habits', duration: '5 mins', type: 'tracker' }
  ],
  social_skills: [
    { title: 'Conversation Starter', description: 'Practice starting and maintaining conversations', duration: '10 mins', type: 'interactive' },
    { title: 'Empathy Explorer', description: 'Understand how others might feel in situations', duration: '12 mins', type: 'game' },
    { title: 'Teamwork Challenge', description: 'Activities that require collaboration', duration: '15 mins', type: 'challenge' }
  ]
};

const areaQuestions = {
  life_ambition: [
    { id: "dream_career", question: "What does {name} dream of becoming when he/she grows up?", type: "text", placeholder: "e.g., Doctor, Teacher, Astronaut, Artist...", followUp: "That's wonderful! Dreams are the seeds of future achievements." },
    { id: "interests_alignment", question: "Are his/her interests & hobbies in line with his/her dream?", type: "choice", options: ["Yes", "No", "Not Sure at this point"], followUp: "Understanding this helps us guide their journey better." },
    { id: "support_type", question: "What kind of support are you willing to give to support his/her dream at this point?", type: "choice", options: ["In every aspect", "Financially", "Moral support", "Not sure at this point"], followUp: "Your support is crucial in nurturing their aspirations." },
    { id: "explore_options", question: "Do you think {name} should explore other career options as well?", type: "choice", options: ["Yes", "No", "Not sure at this point"], followUp: "Exploration helps children discover their true passions." },
    { id: "revisit_timeline", question: "When do you want to re-visit {name}'s life aspirations?", type: "choice", options: ["After 1 year", "After 3 years", "After 5 years", "Not sure at this point"], followUp: "Regular check-ins help keep dreams aligned with growth." }
  ],
  self_care: [
    { id: "emotional_awareness", question: "How well does {name} recognize and name their own emotions?", type: "choice", options: ["Very well", "Somewhat", "Needs support", "Not sure"], followUp: "Emotional awareness is the first step to self-care." },
    { id: "stress_response", question: "How does {name} typically respond when stressed or overwhelmed?", type: "text", placeholder: "e.g., withdraws, cries, talks about it...", followUp: "Understanding stress responses helps us build better coping strategies." },
    { id: "sleep_habits", question: "How would you describe {name}'s sleep habits?", type: "choice", options: ["Very consistent", "Somewhat consistent", "Irregular", "Problematic"], followUp: "Good sleep is fundamental to emotional and physical well-being." },
    { id: "self_soothing", question: "Does {name} have any self-soothing or relaxation activities?", type: "choice", options: ["Yes, several", "One or two", "Not really", "Not sure"], followUp: "Self-soothing skills are important tools for lifelong wellness." },
    { id: "self_care_goals", question: "What self-care habit would you most like {name} to develop?", type: "text", placeholder: "e.g., morning routine, mindfulness, journaling...", followUp: "Great goal! Small daily habits create lasting change." }
  ],
  critical_thinking: [
    { id: "problem_approach", question: "How does {name} typically approach a problem they can't solve immediately?", type: "choice", options: ["Tries different strategies", "Asks for help", "Gets frustrated", "Gives up"], followUp: "Problem-solving persistence is a key thinking skill." },
    { id: "curiosity_level", question: "How curious is {name} about how things work?", type: "choice", options: ["Very curious", "Moderately curious", "Not particularly curious", "Depends on the topic"], followUp: "Curiosity is the engine of critical thinking!" },
    { id: "decision_making", question: "Can {name} make decisions independently, weighing pros and cons?", type: "choice", options: ["Yes, quite well", "Sometimes", "Rarely", "Not yet"], followUp: "Decision-making is a skill that grows with practice." },
    { id: "question_asking", question: "Does {name} ask a lot of 'why' or 'how' questions?", type: "choice", options: ["All the time", "Often", "Occasionally", "Rarely"], followUp: "Asking questions is a sign of an active, thinking mind." },
    { id: "thinking_goals", question: "What critical thinking skill would you most like {name} to strengthen?", type: "text", placeholder: "e.g., logical reasoning, creative solutions, evaluating information...", followUp: "Excellent focus area! We'll build activities around this." }
  ],
  creativity: [
    { id: "creative_outlets", question: "What creative activities does {name} enjoy most?", type: "text", placeholder: "e.g., drawing, storytelling, building, music...", followUp: "Wonderful! Creative outlets are essential for expression and growth." },
    { id: "imagination_use", question: "How often does {name} engage in imaginative play or storytelling?", type: "choice", options: ["Daily", "Several times a week", "Occasionally", "Rarely"], followUp: "Imagination is the birthplace of all creativity." },
    { id: "creative_confidence", question: "Does {name} feel confident sharing their creative work with others?", type: "choice", options: ["Very confident", "Somewhat confident", "Hesitant", "Avoids sharing"], followUp: "Building creative confidence takes a supportive environment." },
    { id: "open_ended_play", question: "Does {name} prefer structured activities or open-ended creative play?", type: "choice", options: ["Prefers structured", "Prefers open-ended", "Enjoys both equally", "Not sure"], followUp: "Both styles have value — balance is key." },
    { id: "creativity_goals", question: "How would you like to nurture {name}'s creativity in the next 3 months?", type: "text", placeholder: "e.g., art classes, music lessons, creative writing...", followUp: "We'll use this to craft the perfect creative missions!" }
  ],
  physical_wellness: [
    { id: "activity_level", question: "How physically active is {name} on a typical day?", type: "choice", options: ["Very active", "Moderately active", "Somewhat sedentary", "Very sedentary"], followUp: "Physical activity is a cornerstone of holistic wellness." },
    { id: "preferred_activities", question: "What physical activities does {name} enjoy most?", type: "text", placeholder: "e.g., swimming, cycling, football, dancing...", followUp: "Linking movement to enjoyment makes it sustainable." },
    { id: "body_awareness", question: "Is {name} aware of their body's signals (hunger, tiredness, discomfort)?", type: "choice", options: ["Very aware", "Somewhat aware", "Not very aware", "Not sure"], followUp: "Body awareness is the foundation of physical self-care." },
    { id: "screen_time", question: "How much screen time does {name} typically have per day?", type: "choice", options: ["Less than 1 hour", "1-2 hours", "3-4 hours", "More than 4 hours"], followUp: "Balancing screen time with physical activity is a key wellness goal." },
    { id: "wellness_goals", question: "What physical wellness goal would you set for {name} over the next 3 months?", type: "text", placeholder: "e.g., learn to swim, improve stamina, develop a sport...", followUp: "A clear physical goal gives movement real purpose!" }
  ],
  social_skills: [
    { id: "friendship_quality", question: "How would you describe {name}'s friendships?", type: "choice", options: ["Has many close friends", "Has a few close friends", "Mostly acquaintances", "Struggles to connect"], followUp: "The quality of friendships matters more than quantity." },
    { id: "conflict_handling", question: "How does {name} handle disagreements or conflicts with peers?", type: "choice", options: ["Resolves calmly", "Needs some guidance", "Gets upset easily", "Avoids conflict entirely"], followUp: "Healthy conflict resolution is a powerful life skill." },
    { id: "empathy_level", question: "Does {name} show empathy and concern for others' feelings?", type: "choice", options: ["Consistently", "Often", "Sometimes", "Rarely"], followUp: "Empathy is the foundation of all meaningful relationships." },
    { id: "group_participation", question: "How does {name} behave in group settings (school, teams, clubs)?", type: "choice", options: ["Natural leader", "Active participant", "Observer", "Withdraws"], followUp: "Understanding group dynamics helps us tailor the right activities." },
    { id: "social_goals", question: "What social skill would you most like {name} to build in the next 3 months?", type: "text", placeholder: "e.g., starting conversations, teamwork, expressing feelings...", followUp: "Wonderful focus! Social skills open doors throughout life." }
  ]
};

// Keep backward compatibility
const lifeAmbitionQuestions = areaQuestions.life_ambition;

function answerLooksFilled(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function buildRecommendationsProgressPayload({
  step,
  selectedArea,
  selectedActivity,
  parentLiked,
  wantChildActivity,
  feedback,
  currentAreaIndex,
  interactiveStep,
  interactiveAnswers,
  currentAnswer,
  generatedActivity,
  showGame,
  childActivitySelections,
  aiRecommendations,
}) {
  const cq =
    step === 'interactive_activity' && selectedArea
      ? (areaQuestions[selectedArea.id] || areaQuestions.life_ambition)[interactiveStep]
      : null;
  const interactive_draft =
    cq?.type === 'text' ? { question_id: cq.id, text: currentAnswer ?? '' } : null;

  return {
    step,
    selected_area: selectedArea
      ? {
          id: selectedArea.id,
          name: selectedArea.name,
          color: selectedArea.color,
          description: selectedArea.description,
        }
      : null,
    selected_activity: selectedActivity,
    parent_liked: parentLiked,
    want_child_activity: wantChildActivity,
    feedback,
    current_area_index: currentAreaIndex,
    interactive_step: interactiveStep,
    interactive_answers: interactiveAnswers,
    interactive_draft,
    generated_activity: generatedActivity,
    show_game: showGame,
    child_activity_by_area: selectedArea && Array.isArray(childActivitySelections) && childActivitySelections.length > 0
      ? { [selectedArea.id]: { selections: childActivitySelections } }
      : {},
    ai_three_month_recommendations:
      selectedArea &&
      Array.isArray(aiRecommendations) &&
      aiRecommendations.length > 0
        ? { area_id: selectedArea.id, items: aiRecommendations }
        : null,
  };
}

/** Keep only answers whose keys belong to this growth area (avoids mixed-area blobs). */
function answersForArea(areaId, rawAnswers) {
  const qs = areaQuestions[areaId] || areaQuestions.life_ambition;
  const allowed = new Set(qs.map((q) => q.id));
  const src = rawAnswers && typeof rawAnswers === 'object' ? rawAnswers : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (!allowed.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function choiceAnswersEqual(saved, option) {
  if (saved === undefined || saved === null) return false;
  return String(saved).trim() === String(option).trim();
}

/** Root selections from a child_activity_by_area entry. */
function coalesceChildActivitySelections(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const root = Array.isArray(entry.selections) ? entry.selections : [];
  return [...root];
}

function extractAnswersFromCompletedGrowthAreas(completedList, areaId) {
  if (!Array.isArray(completedList)) return {};
  const entry = completedList.find((e) => e && typeof e === 'object' && e.area_id === areaId);
  const ans = entry?.answers;
  return ans && typeof ans === 'object' ? { ...ans } : {};
}

/** 3-month AI bullets saved on completed growth area records. */
function extractAiRecommendationsFromCompleted(completedList, areaId) {
  if (!Array.isArray(completedList)) return null;
  const entry = completedList.find((e) => e && typeof e === 'object' && e.area_id === areaId);
  const recs = entry?.recommendations;
  if (!Array.isArray(recs) || recs.length === 0) return null;
  return recs;
}

/** Restore questionnaire UI from progress + completed_growth_areas for one growth area. */
function deriveInteractiveUiFromProgress(area, p, completedGrowthAreas = []) {
  if (!area) {
    return {
      mergedAnswers: {},
      step: 'interactive_activity',
      interactiveStep: 0,
      currentAnswer: '',
    };
  }

  const qs = areaQuestions[area.id] || areaQuestions.life_ambition;
  const rawProgress =
    p.interactive_answers && typeof p.interactive_answers === 'object' ? { ...p.interactive_answers } : {};
  const fromCompleted = extractAnswersFromCompletedGrowthAreas(completedGrowthAreas, area.id);
  const mergedRaw = { ...fromCompleted, ...rawProgress };
  const mergedAnswers = answersForArea(area.id, mergedRaw);

  const areaMatchesPersisted = p.selected_area?.id === area.id;
  const stepVal = p.step || 'intro';

  const completedHasArea = Array.isArray(completedGrowthAreas)
    ? completedGrowthAreas.some((e) => e && typeof e === 'object' && e.area_id === area.id)
    : false;

  const hasAnswersForArea = qs.some((q) => answerLooksFilled(mergedAnswers[q.id]));

  const blobBelongsToArea = areaMatchesPersisted || hasAnswersForArea || completedHasArea;

  if (!blobBelongsToArea) {
    return {
      mergedAnswers: {},
      step: 'interactive_activity',
      interactiveStep: 0,
      currentAnswer: '',
    };
  }

  const effectiveStep =
    areaMatchesPersisted && stepVal === 'activity_summary'
      ? 'activity_summary'
      : areaMatchesPersisted && stepVal === 'interactive_activity'
        ? 'interactive_activity'
        : hasAnswersForArea
          ? 'interactive_activity'
          : stepVal === 'activity_summary'
            ? 'activity_summary'
            : 'interactive_activity';

  if (effectiveStep === 'activity_summary') {
    return {
      mergedAnswers,
      step: 'activity_summary',
      interactiveStep: Math.max(0, qs.length - 1),
      currentAnswer: '',
    };
  }

  if (effectiveStep === 'interactive_activity') {
    if (!qs.length) {
      return {
        mergedAnswers,
        step: 'interactive_activity',
        interactiveStep: typeof p.interactive_step === 'number' ? p.interactive_step : 0,
        currentAnswer: '',
      };
    }
    const firstIncomplete = qs.findIndex((q) => !answerLooksFilled(mergedAnswers[q.id]));
    if (firstIncomplete === -1) {
      return {
        mergedAnswers,
        step: 'activity_summary',
        interactiveStep: Math.max(0, qs.length - 1),
        currentAnswer: '',
      };
    }

    let interactiveStepIx = firstIncomplete;
    if (areaMatchesPersisted && typeof p.interactive_step === 'number' && qs.length > 0) {
      interactiveStepIx = Math.max(0, Math.min(qs.length - 1, p.interactive_step));
    }

    const cq = qs[interactiveStepIx];
    const draft = p.interactive_draft;
    let currentAnswer = '';
    const useDraft =
      areaMatchesPersisted &&
      cq?.type === 'text' &&
      draft &&
      draft.question_id === cq.id &&
      typeof draft.text === 'string';

    if (useDraft) {
      currentAnswer = draft.text;
    } else if (
      cq?.type === 'text' &&
      mergedAnswers[cq.id] != null &&
      String(mergedAnswers[cq.id]).trim() !== ''
    ) {
      currentAnswer = String(mergedAnswers[cq.id]);
    }
    return {
      mergedAnswers,
      step: 'interactive_activity',
      interactiveStep: interactiveStepIx,
      currentAnswer,
    };
  }

  return {
    mergedAnswers,
    step: stepVal,
    interactiveStep: typeof p.interactive_step === 'number' ? p.interactive_step : 0,
    currentAnswer: '',
  };
}

/** Opening from grid: land on questionnaire when revisiting so choices/text show saved values (summary alone hides MC state). */
function applyTileEntryInteractivePreference(area, d) {
  const qs = areaQuestions[area.id] || areaQuestions.life_ambition;
  const anyFilled = qs.some((q) => answerLooksFilled(d.mergedAnswers[q.id]));

  if (d.step === 'activity_summary' && anyFilled) {
    const ixUse = 0;
    const cq = qs[ixUse];
    let caUse = '';
    if (cq?.type === 'text' && answerLooksFilled(d.mergedAnswers[cq?.id])) {
      caUse = String(d.mergedAnswers[cq.id]);
    }
    return { step: 'interactive_activity', interactiveStep: ixUse, currentAnswer: caUse };
  }

  return { step: d.step, interactiveStep: d.interactiveStep, currentAnswer: d.currentAnswer };
}

export default function RecommendationsPhase({ data, profile, recommendations, activeChildId, onFinish, onRegisterBack, onRegisterNext, onPhaseBack }) {
  const navigate = useNavigate();
  // voiceEnabledRef is a stable ref — safe to use with empty deps
  const speak = useCallback((text) => {
    if (typeof window === 'undefined' || !voiceEnabledRef.current) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[🌟💪😊🎉👋✨🚀🌱]/g, '').replace(/\n/g, ' ');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1;
    const voice = pickPreferredVoice();
    if (voice) utterance.voice = voice;
    // iOS Safari sometimes pauses synthesis; resume before speaking
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  }, []); // voiceEnabledRef and window are stable across renders — empty deps is intentional

  const [step, setStep] = useState('intro');
  const [qaAnimKey, setQaAnimKey] = useState(0);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (step === 'activity_summary') {
      setQaAnimKey(k => k + 1);
    }
  }, [step]);
  const [selectedArea, setSelectedArea] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [parentLiked, setParentLiked] = useState(null);
  const [wantChildActivity, setWantChildActivity] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [currentAreaIndex, setCurrentAreaIndex] = useState(0);
  const [interactiveStep, setInteractiveStep] = useState(0);
  const [interactiveAnswers, setInteractiveAnswers] = useState({});
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [generatedActivity, setGeneratedActivity] = useState(null);
  const [showGame, setShowGame] = useState(false);
  const [childGameResults, setChildGameResults] = useState(null);
  const [childActivitySelections, setChildActivitySelections] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [aiRecommendations, setAiRecommendations] = useState(null);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [completedAreaIds, setCompletedAreaIds] = useState(new Set());

  // Load saved progress from server once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        debouncedPersistRecommendationsProgress.cancel();
        const [p, completedData, prefs] = await Promise.all([
          api.recommendationsProgress.get(activeChildId),
          api.completedGrowthAreas.list(activeChildId),
          api.preferences.get(),
        ]);
        if (cancelled) return;

        if (typeof prefs.tts_enabled === 'boolean') {
          voiceEnabledRef.current = prefs.tts_enabled;
          setVoiceEnabled(prefs.tts_enabled);
        }

        const completedList = Array.isArray(completedData?.areas) ? completedData.areas : [];

        if (completedList.length > 0) {
          setCompletedAreaIds(new Set(completedList.map((a) => a.area_id)));
        }

        if (!p || p.step === 'intro') return;

        let areaObj = null;
        if (p.selected_area?.id) {
          areaObj = growthAreas.find((a) => a.id === p.selected_area.id) || null;
          if (areaObj) setSelectedArea(areaObj);
        }

        if (p.selected_activity) setSelectedActivity(p.selected_activity);
        if (p.parent_liked != null) setParentLiked(p.parent_liked);
        if (p.want_child_activity != null) setWantChildActivity(p.want_child_activity);
        if (typeof p.feedback === 'string') setFeedback(p.feedback);
        if (typeof p.current_area_index === 'number') setCurrentAreaIndex(p.current_area_index);

        if (areaObj) {
          const d = deriveInteractiveUiFromProgress(areaObj, p, completedList);
          setInteractiveAnswers(d.mergedAnswers);
          setStep(d.step);
          setInteractiveStep(d.interactiveStep);
          setCurrentAnswer(d.currentAnswer);

          // Restore child game state from completed area record (source of truth)
          const completedArea = completedList.find((a) => a.area_id === areaObj.id);
          const ca = completedArea?.child_activity;
          if (ca) {
            const sels = Array.isArray(ca.selections) ? ca.selections : [];
            setChildActivitySelections(sels);
            if (ca.results && d.step === 'activity_summary') {
              setChildGameResults(ca.results);
              setShowGame(false);
              setParentLiked(true);
            }
          } else {
            const savedSels = p.child_activity_by_area?.[areaObj.id]?.selections;
            if (Array.isArray(savedSels)) setChildActivitySelections(savedSels);
          }

          const air = p.ai_three_month_recommendations;
          let aiRec =
            air?.area_id === areaObj.id && Array.isArray(air.items) && air.items.length > 0
              ? air.items
              : null;
          if (!aiRec) aiRec = extractAiRecommendationsFromCompleted(completedList, areaObj.id);
          setAiRecommendations(aiRec);
        } else {
          const mergedAnswers =
            p.interactive_answers && typeof p.interactive_answers === 'object'
              ? { ...p.interactive_answers }
              : {};
          setInteractiveAnswers(mergedAnswers);
          setStep(p.step || 'intro');
          if (typeof p.interactive_step === 'number') setInteractiveStep(p.interactive_step);
        }

        if (p.generated_activity) setGeneratedActivity(p.generated_activity);
        if (typeof p.show_game === 'boolean') setShowGame(p.show_game);
      } catch (err) {
        console.warn('[RecommendationsPhase] Resume load failed, keeping defaults:', err);
      } finally {
        if (!cancelled) setResumeLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const debouncedPersistRecommendationsProgress = useMemo(
    () =>
      debounce((progress) => {
        api.recommendationsProgress.patch(activeChildId, progress).catch(() => {});
      }, 400),
    [activeChildId]
  );

  useEffect(() => {
    return () => debouncedPersistRecommendationsProgress.cancel();
  }, [debouncedPersistRecommendationsProgress]);

  // Register back handler with parent
  useEffect(() => {
    if (onRegisterBack) {
      onRegisterBack(() => {
        if (step === 'intro') {
          onPhaseBack?.();
        } else if (step === 'area_selection') {
          setStep('intro');
        } else if (step === 'interactive_activity') {
          setStep('area_selection');
        } else if (step === 'activity_summary') {
          const qs = areaQuestions[selectedArea?.id] || areaQuestions.life_ambition;
          const firstIncomplete = qs.findIndex((q) => !answerLooksFilled(interactiveAnswers[q.id]));
          if (firstIncomplete === -1) {
            setInteractiveStep(Math.max(0, qs.length - 1));
          } else {
            setInteractiveStep(firstIncomplete);
          }
          setStep('interactive_activity');
        } else {
          setStep('area_selection');
        }
      });
    }
  }, [step, selectedArea, interactiveAnswers, interactiveStep, onRegisterBack, onPhaseBack]);


  // Refs for voice control
  const introHasSpoken = useRef(false);
  const summaryHasSpoken = useRef(false);
  const growthAreaSaveChainRef = useRef(Promise.resolve());
  const resultsRef = useRef(null);
  // Always-current ref so the onRegisterNext effect can register a stable wrapper
  // without re-firing on every render (which would cause a dispatch loop).
  const handleFinishRef = useRef(null);

  // Scroll to "Recommendations for {name}" heading when childGameResults first appears.
  // Delay must exceed the game's AnimatePresence exit animation (400ms) so the layout
  // has fully settled before we measure — otherwise the game is still in the DOM and
  // shifts the anchor position after exit, landing the scroll too far down.
  useEffect(() => {
    if (!childGameResults || !resultsRef.current) return;
    const t = setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 600);
    return () => clearTimeout(t);
  }, [!!childGameResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-persist recommendations wizard progress to server
  useEffect(() => {
    if (!resumeLoaded) return;

    const progress = buildRecommendationsProgressPayload({
      step,
      selectedArea,
      selectedActivity,
      parentLiked,
      wantChildActivity,
      feedback,
      currentAreaIndex,
      interactiveStep,
      interactiveAnswers,
      currentAnswer,
      generatedActivity,
      showGame,
      childActivitySelections,
      aiRecommendations,
    });
    debouncedPersistRecommendationsProgress(progress);
  }, [
    resumeLoaded,
    step,
    selectedArea,
    selectedActivity,
    parentLiked,
    wantChildActivity,
    feedback,
    currentAreaIndex,
    interactiveStep,
    interactiveAnswers,
    currentAnswer,
    generatedActivity,
    showGame,
    childActivitySelections,
    childGameResults,
    aiRecommendations,
    debouncedPersistRecommendationsProgress,
  ]);

  useEffect(() => {
    if (!resumeLoaded || step !== 'interactive_activity' || !selectedArea) return;
    const questions = areaQuestions[selectedArea.id] || areaQuestions.life_ambition;
    const cq = questions[interactiveStep];
    if (!cq || cq.type !== 'text') return;

    const saved = interactiveAnswers[cq.id];
    const savedStr =
      saved === undefined || saved === null ? '' : typeof saved === 'string' ? saved : String(saved);

    if (savedStr.trim() !== '') {
      setCurrentAnswer(savedStr);
    }
  }, [resumeLoaded, step, selectedArea?.id, interactiveStep, interactiveAnswers]);

  const saveCompletedGrowthArea = async (area, answers, recs, childActivity = undefined) => {
    debouncedPersistRecommendationsProgress.flush?.();
    const payload = {
      area_id: area.id,
      area_name: area.name,
      area_color: area.color,
      answers,
      recommendations: recs,
      ...(childActivity ? { child_activity: childActivity } : {}),
    };
    const task = growthAreaSaveChainRef.current.then(() => api.completedGrowthAreas.append(activeChildId, payload));
    growthAreaSaveChainRef.current = task.catch(() => {});
    try {
      await task;
      setInteractiveAnswers({});
      setAiRecommendations(null);
      setChildActivitySelections([]);
      setCompletedAreaIds((prev) => { const n = new Set(prev); n.add(area.id); return n; });
    } catch (err) {
      console.error('[RecommendationsPhase] Could not save progress:', err);
      toast.error('Could not save progress');
    }
  };

  // Updated every render so the stable ref wrapper always runs with current state.
  handleFinishRef.current = async () => {
    if (selectedArea && step !== 'area_selection') {
      const recs = childGameResults ? aiRecommendations : null;
      const childActivity = childGameResults
        ? { selections: childActivitySelections, results: childGameResults }
        : undefined;
      await saveCompletedGrowthArea(selectedArea, interactiveAnswers, recs, childActivity);
    }
    if (onFinish) await onFinish();
    else navigate(createPageUrl('LifePathway'), { replace: true });
  };

  // Register/unregister the Finish handler with the parent nav bar.
  // Uses a stable ref wrapper to avoid re-registering (and re-dispatching) on every render.
  useEffect(() => {
    if (!onRegisterNext) return;
    if ((step === 'area_selection' && completedAreaIds.size > 0) || step === 'activity_summary') {
      onRegisterNext(() => handleFinishRef.current?.());
    } else {
      onRegisterNext(null);
    }
    return () => { onRegisterNext?.(null); };
  }, [step, completedAreaIds, onRegisterNext]);

  /** Fetch completed area from DB and restore child game UI state. */
  const mergeChildGameFromServer = async (areaId, { reopenGame } = {}) => {
    if (!areaId) return;
    try {
      debouncedPersistRecommendationsProgress.flush?.();
      const [completedData, progressData] = await Promise.all([
        api.completedGrowthAreas.list(activeChildId),
        api.recommendationsProgress.get(activeChildId),
      ]);
      const completedArea = completedData?.areas?.find((a) => a.area_id === areaId);
      const ca = completedArea?.child_activity;
      if (ca) {
        setChildActivitySelections(Array.isArray(ca.selections) ? ca.selections : []);
        if (!reopenGame) {
          if (ca.results) {
            setChildGameResults(ca.results);
            setShowGame(false);
            setParentLiked(true);
          } else {
            setChildGameResults(null);
          }
        }
      } else {
        // Fall back to partial selections saved in the progress blob (pre-submit state)
        const savedSels = progressData?.child_activity_by_area?.[areaId]?.selections;
        setChildActivitySelections(Array.isArray(savedSels) ? savedSels : []);
        if (!reopenGame) setChildGameResults(null);
      }
    } catch (err) {
      console.warn('[RecommendationsPhase] Area open failed:', err);
    }
  };

  // Speak full profile on intro — gated on resumeLoaded so tts_enabled is fetched from DB first
  useEffect(() => {
    if (!resumeLoaded) return;
    if (step === 'intro' && !introHasSpoken.current && profile) {
      const strengthsText = profile.top_strengths?.map((s, i) => `Strength ${i + 1}: ${s}`).join('. ') || '';
      const primaryType = profile.personality_type?.split(' - ')[1] || profile.personality_type || '';
      const summaryAlreadyContainsType = primaryType && profile.summary?.toLowerCase().includes(primaryType.toLowerCase());
      const fullText = summaryAlreadyContainsType
        ? `${data.name}'s profile. ${profile.summary}. Emerging strengths: ${strengthsText}`
        : `${data.name}'s personality type is ${primaryType}. ${profile.summary}. Emerging strengths: ${strengthsText}`;
      speak(fullText);
      introHasSpoken.current = true;
    }
  }, [step, profile, resumeLoaded, speak]);

  const renderIntro = () => {
    const sectionAnim = (delay) => ({
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 1.0, delay, ease: 'easeOut' },
    });

    return (
      <div className="space-y-8">
        {/* Section 1 — Header */}
        <motion.div {...sectionAnim(0.1)} className="text-center">
          <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
            <Sparkles className="w-12 h-12 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Your Personalized Journey</h2>
          <p className="text-slate-400">Here's what we've discovered about {data.name}</p>
        </motion.div>

        {/* Section 2 — Profile Summary Card */}
        {profile && (
          <motion.div
            {...sectionAnim(0.8)}
            className="bg-card rounded-2xl p-6 border-edge"
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center flex-shrink-0 glow-teal-sm">
                <Star className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{data.name}'s Profile</h3>
                <p className="text-teal-400 text-sm font-medium">{profile.personality_type?.split(' - ')[1] || profile.personality_type}</p>
              </div>
            </div>

            <p className="text-slate-400 mb-5 leading-relaxed text-sm">{profile.summary}</p>

            {/* Top Strengths */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-widest mb-3">Emerging Strengths</p>
              {profile.top_strengths?.map((strength, index) => (
                <motion.div
                  key={strength}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.8, delay: 1.1 + index * 0.25 }}
                  className="flex items-start gap-3 bg-surface-input rounded-xl p-3 border-edge-faint"
                >
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-400 font-bold text-xs">{index + 1}</span>
                  </div>
                  <p className="font-semibold text-white text-sm">{strength}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Section 3 — Explore Growth Areas Prompt */}
        <motion.div
          {...sectionAnim(1.8)}
          className="bg-card rounded-2xl p-6 border border-purple-500/20"
        >
          <div className="text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Compass className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-lg font-bold text-white">
              Do you want to explore the specific growth areas for {data.name} to become their best version?
            </h3>
            <p className="text-slate-400 text-sm">
              Discover personalized activities to help {data.name} develop key life skills
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button
                onClick={() => setStep('area_selection')}
                className="h-12 px-8 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white"
              >
                <Zap className="w-4 h-4 mr-2" />
                Continue Now
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(createPageUrl('Home'))}
                className="h-12 px-8 rounded-2xl border-edge-strong bg-transparent text-slate-300 hover:bg-subtle"
              >
                <Clock className="w-4 h-4 mr-2" />
                Catch Up Later
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  const renderAreaSelection = () => {
    const sectionAnim = (delay) => ({
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 1.0, delay, ease: 'easeOut' },
    });

    return (
      <div className="space-y-6">
        <motion.div {...sectionAnim(0.5)} className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Growth Areas</h2>
          <p className="text-slate-400">Choose an area to explore for {data.name}</p>
        </motion.div>

        <div className="grid grid-cols-2 gap-3">
          {growthAreas.map((area, i) => {
            const Icon = area.icon;
            return (
              <motion.button
                key={area.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileTap={{ scale: 0.97 }}
                transition={{
                  opacity: { duration: 1.0, delay: 0.5 + i * 0.5, ease: 'easeOut' },
                  y: { duration: 1.0, delay: 0.5 + i * 0.5, ease: 'easeOut' },
                  scale: { duration: 0.15, delay: 0 },
                }}
                onClick={async () => {
                  debouncedPersistRecommendationsProgress.flush?.();
                  setSelectedArea(area);
                  setCurrentAreaIndex(i);

                  try {
                    const [p, completedData] = await Promise.all([
                      api.recommendationsProgress.get(activeChildId),
                      api.completedGrowthAreas.list(activeChildId),
                    ]);
                    const completedList = Array.isArray(completedData?.areas) ? completedData.areas : [];
                    const areaMatchesPersisted = p?.selected_area?.id === area.id;

                    const d = deriveInteractiveUiFromProgress(area, p || {}, completedList);
                    const nav = applyTileEntryInteractivePreference(area, d);

                    setInteractiveAnswers(d.mergedAnswers);
                    setInteractiveStep(nav.interactiveStep);
                    setCurrentAnswer(nav.currentAnswer);
                    setStep(nav.step);

                    const airMerged =
                      p?.ai_three_month_recommendations &&
                      typeof p.ai_three_month_recommendations === 'object' &&
                      p.ai_three_month_recommendations.area_id === area.id &&
                      Array.isArray(p.ai_three_month_recommendations.items) &&
                      p.ai_three_month_recommendations.items.length > 0
                        ? p.ai_three_month_recommendations.items
                        : extractAiRecommendationsFromCompleted(completedList, area.id);
                    setAiRecommendations(
                      airMerged && Array.isArray(airMerged) && airMerged.length > 0 ? airMerged : null,
                    );

                    if (areaMatchesPersisted) {
                      if (p.selected_activity) setSelectedActivity(p.selected_activity);
                      else setSelectedActivity(null);
                      if (p.parent_liked != null) setParentLiked(p.parent_liked);
                      if (p.want_child_activity != null) setWantChildActivity(p.want_child_activity);
                      if (typeof p.feedback === 'string') setFeedback(p.feedback);

                      if (p.generated_activity) setGeneratedActivity(p.generated_activity);
                      else setGeneratedActivity(null);
                      if (typeof p.show_game === 'boolean') setShowGame(p.show_game);

                      // Restore child game state from DB for this area
                      const matchedArea = completedList.find((a) => a.area_id === area.id);
                      const ca = matchedArea?.child_activity;
                      if (ca) {
                        setChildActivitySelections(Array.isArray(ca.selections) ? ca.selections : []);
                        if (ca.results && nav.step === 'activity_summary') {
                          setChildGameResults(ca.results);
                          setShowGame(false);
                          setParentLiked(true);
                        }
                      } else {
                        const savedSels = p.child_activity_by_area?.[area.id]?.selections;
                        setChildActivitySelections(Array.isArray(savedSels) ? savedSels : []);
                      }
                      return;
                    }

                    setSelectedActivity(null);
                    setParentLiked(null);
                    setChildGameResults(null);
                    setShowGame(false);
                    setGeneratedActivity(null);
                    setWantChildActivity(null);
                    setFeedback('');

                    // Restore saved selections for this area from DB
                    const freshArea = completedList.find((a) => a.area_id === area.id);
                    const freshCa = freshArea?.child_activity;
                    if (freshCa) {
                      setChildActivitySelections(Array.isArray(freshCa.selections) ? freshCa.selections : []);
                    } else {
                      const savedSels = p.child_activity_by_area?.[area.id]?.selections;
                      setChildActivitySelections(Array.isArray(savedSels) ? savedSels : []);
                    }
                  } catch (err) {
                    console.warn('[RecommendationsPhase] Game load failed:', err);
                    setInteractiveStep(0);
                    setInteractiveAnswers({});
                    setCurrentAnswer('');
                    setParentLiked(null);
                    setChildGameResults(null);
                    setChildActivitySelections([]);
                    setShowGame(false);
                    setSelectedActivity(null);
                    setGeneratedActivity(null);
                    setWantChildActivity(null);
                    setFeedback('');
                    setStep('interactive_activity');
                  }
                }}
                className="p-4 rounded-2xl border-edge text-left transition-colors bg-card hover:border-c-bright hover:bg-surface-elevated"
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${area.color} flex items-center justify-center mb-3`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h4 className="font-semibold text-white text-sm">{area.name}</h4>
                <p className="text-xs text-slate-500 mt-1">{area.description}</p>
              </motion.button>
            );
          })}
        </div>

      </div>
    );
  };

  const renderActivitySelection = () => {
    const activities = sampleActivities[selectedArea?.id] || [];
    const Icon = selectedArea?.icon || Target;

    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.1, ease: 'easeOut' }}
          className="text-center"
        >
          <div className={`w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br ${selectedArea?.color} flex items-center justify-center mb-4`}>
            <Icon className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{selectedArea?.name}</h2>
          <p className="text-slate-400">Choose an activity to try with {data.name}</p>
        </motion.div>

        <div className="space-y-3">
          {activities.map((activity, i) => (
            <motion.button
              key={activity.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              whileTap={{ scale: 0.98 }}
              transition={{
                opacity: { duration: 1.0, delay: 0.5 + i * 0.3, ease: 'easeOut' },
                y: { duration: 1.0, delay: 0.5 + i * 0.3, ease: 'easeOut' },
                scale: { duration: 0.15, delay: 0 },
              }}
              type="button"
              onClick={() => {
                setSelectedActivity(activity);
                setStep('parent_activity');
              }}
              className={`w-full p-4 rounded-2xl border text-left transition-all duration-150 ${
                selectedActivity?.title === activity.title
                  ? 'border-purple-500/50 bg-purple-500/10'
                  : 'border-c-edge bg-card hover:border-c-bright hover:bg-surface-elevated'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h4 className="font-semibold text-white text-sm">{activity.title}</h4>
                  <p className="text-xs text-slate-500 mt-1">{activity.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 bg-ghost-light rounded-full text-slate-400">
                      ⏱ {activity.duration}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-purple-500/15 rounded-full text-purple-400 capitalize">
                      {activity.type}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
              </div>
            </motion.button>
          ))}
        </div>

        <div className="text-center pt-2">
          <Button variant="ghost" onClick={() => setStep('area_selection')} className="text-slate-500 hover:text-white">
            ← Back to Growth Areas
          </Button>
        </div>
      </div>
    );
  };

  const renderParentActivity = () => {
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.1, ease: 'easeOut' }}
          className={`bg-gradient-to-br ${selectedArea?.color} rounded-2xl p-6 text-white`}
        >
          <div className="text-center space-y-3">
            <Award className="w-10 h-10 mx-auto" />
            <h2 className="text-xl font-bold">{selectedActivity?.title}</h2>
            <p className="text-white/80 text-sm">{selectedActivity?.description}</p>
            <div className="flex justify-center gap-4 pt-1">
              <span className="px-3 py-1 bg-white/20 rounded-full text-xs">
                ⏱ {selectedActivity?.duration}
              </span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.8, ease: 'easeOut' }}
          className="bg-card rounded-2xl p-6 border-edge space-y-5"
        >
          <h3 className="font-bold text-white text-center text-sm">Did you like this activity suggestion?</h3>

        <div className="flex justify-center gap-4">
          <Button
            onClick={() => {
              setParentLiked(true);
              setStep('child_activity_prompt');
            }}
            className="h-12 px-8 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white"
          >
            <ThumbsUp className="w-4 h-4 mr-2" />
            Yes, I like it!
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setParentLiked(false);
              setStep('feedback');
            }}
            className="h-12 px-8 rounded-2xl border-edge-strong bg-transparent text-slate-300 hover:bg-subtle"
          >
            <ThumbsDown className="w-4 h-4 mr-2" />
            Not quite
          </Button>
        </div>
      </motion.div>

      <div className="text-center">
        <Button variant="ghost" onClick={() => setStep('activity_selection')} className="text-slate-500 hover:text-white">
          ← Choose Different Activity
        </Button>
      </div>
    </div>
    );
  };

  const renderFeedback = () => {
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.1, ease: 'easeOut' }}
          className="text-center"
        >
          <h2 className="text-2xl font-bold text-white mb-2">We'd love your feedback</h2>
          <p className="text-slate-400">What kind of activity would you like for {data.name}?</p>
        </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.8, ease: 'easeOut' }}
        className="bg-card rounded-2xl p-6 border-edge space-y-4"
      >
        <TextareaWithVoice
          placeholder="Tell us what you're looking for... (e.g., more interactive, shorter duration, different topic)"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="min-h-[120px] rounded-xl pr-14 bg-surface-input border-c-md text-white placeholder:text-slate-600"
        />

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setStep('activity_selection')} className="border-edge-strong bg-transparent text-slate-300 hover:bg-subtle">
            Go Back
          </Button>
          <Button
            onClick={() => {
              debouncedPersistRecommendationsProgress.flush?.();
              setStep('activity_selection');
            }}
            className="bg-purple-500 hover:bg-purple-400 text-white"
          >
            Submit & Try Another
          </Button>
        </div>
      </motion.div>
    </div>
    );
  };

  const renderChildActivityPrompt = () => {
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.1, ease: 'easeOut' }}
          className="bg-card rounded-2xl p-6 border border-emerald-500/20"
        >
          <div className="text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Zap className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-lg font-bold text-white">
              Do you want {data.name} to take a fun activity on {selectedArea?.name}?
            </h2>
          <p className="text-slate-400 text-sm">
            {data.name} can complete this as a game on their device
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button
              onClick={() => setStep('results')}
              className="h-12 px-8 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white"
            >
              Yes, Start Activity
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(createPageUrl('Home'))}
              className="h-12 px-8 rounded-2xl border-edge-strong bg-transparent text-slate-300 hover:bg-subtle"
            >
              Catch Up Later
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
    );
  };

  const renderResults = () => (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.1, ease: 'easeOut' }}
        className="text-center"
      >
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
          <Award className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Activity Results Preview</h2>
        <p className="text-slate-400">Here's what you'll see after {data.name} completes activities</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.8, ease: 'easeOut' }}
        className="bg-card rounded-2xl p-6 border-edge space-y-4"
      >
        <div className="text-center">
          <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">{selectedArea?.name} Quotient</p>
          <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-emerald-400">
            --
          </div>
          <p className="text-sm text-slate-600 mt-1">Score will appear after activity</p>
        </div>

        <div className="border-t-edge-faint pt-4">
          <h4 className="font-semibold text-white text-sm mb-3">Personalized Recommendations</h4>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-surface-input rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-ghost-light animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-ghost-light rounded animate-pulse w-3/4" />
                  <div className="h-2.5 bg-ghost-md rounded animate-pulse w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 1.6, ease: 'easeOut' }}
        className="text-center py-4"
      >
        <p className="text-slate-400 text-sm">
          🎉 You're all set! Click <span className="font-semibold text-teal-400">"Start the Journey"</span> to go to your dashboard.
        </p>
      </motion.div>
    </div>
  );

  const renderInteractiveActivity = () => {
    const questions = areaQuestions[selectedArea?.id] || areaQuestions.life_ambition;
    const currentQuestion = questions[interactiveStep];
    const questionText = currentQuestion?.question.replace('{name}', data.name);
    const isLastQuestion = interactiveStep === questions.length - 1;
    const isFirstQuestion = interactiveStep === 0;
    const AreaIcon = selectedArea?.icon || Rocket;

    const handlePreviousQuestion = () => {
      if (currentQuestion?.type === 'text' && currentAnswer.trim()) {
        setInteractiveAnswers({ ...interactiveAnswers, [currentQuestion.id]: currentAnswer });
      }
      const prevStep = interactiveStep - 1;
      const prevQuestion = questions[prevStep];
      const savedAns = interactiveAnswers[prevQuestion?.id];
      setCurrentAnswer(prevQuestion?.type === 'text' && typeof savedAns === 'string' ? savedAns : '');
      setInteractiveStep(prevStep);
    };

    return (
      <div className="space-y-6">
        {/* Progress */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.3, ease: 'easeOut' }}
          className="text-center"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-4 bg-teal-500/10 border border-teal-500/20">
            <AreaIcon className="w-4 h-4 text-teal-400" />
            <span className="text-sm font-medium text-teal-400">{selectedArea?.name} Activity</span>
          </div>
          <div className="flex justify-center gap-1 mb-2">
            {questions.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 w-8 rounded-full transition-all ${
                  i === interactiveStep ? 'bg-teal-400' : i < interactiveStep ? 'bg-emerald-500' : 'bg-ghost-strong'
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-slate-500">Question {interactiveStep + 1} of {questions.length}</p>
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={interactiveStep}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16, transition: { duration: 0.4, ease: 'easeIn' } }}
            transition={{
              opacity: { duration: 1.0, ease: 'easeOut' },
              y: { duration: 0.9, ease: 'easeOut' },
            }}
            className="bg-card rounded-2xl p-6 border-edge"
          >
            {/* Question */}
            <div className="mb-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">{questionText}</h3>
            </div>

            {/* Answer Input */}
            <div className="space-y-3">
              {currentQuestion?.type === 'text' ? (
                <TextareaWithVoice
                  value={currentAnswer}
                  onChange={(e) => setCurrentAnswer(e.target.value)}
                  placeholder={currentQuestion?.placeholder}
                  className="min-h-[100px] rounded-xl pr-14 bg-surface-input border-c-md text-white placeholder:text-slate-600"
                />
              ) : (
                <>
                  <div className="space-y-2">
                    {currentQuestion?.options?.map((option) => {
                      const selected = choiceAnswersEqual(interactiveAnswers[currentQuestion.id], option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            setInteractiveAnswers({ ...interactiveAnswers, [currentQuestion.id]: option });
                          }}
                          className={`w-full p-3.5 rounded-xl text-left transition-all border text-sm ${
                            selected
                              ? 'border-teal-500/50 bg-teal-500/10 text-teal-300'
                              : 'bg-surface-input border-c-edge text-slate-300 hover:border-teal-500/30 hover:bg-teal-500/[0.05]'
                          }`}
                        >
                          <span className="font-medium">{option}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    {!isFirstQuestion && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handlePreviousQuestion}
                        className="h-11 rounded-2xl border-edge-strong bg-transparent text-slate-300 hover:bg-subtle w-full sm:w-auto"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() => {
                        const ans = interactiveAnswers[currentQuestion.id];
                        if (!answerLooksFilled(ans)) return;
                        if (isLastQuestion) {
                          setChildGameResults(null);
                          setShowGame(false);
                          setStep('activity_summary');
                        } else {
                          setInteractiveStep(interactiveStep + 1);
                        }
                      }}
                      disabled={!answerLooksFilled(interactiveAnswers[currentQuestion.id])}
                      className={`h-11 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-primary-foreground font-semibold disabled:opacity-40 w-full ${!isFirstQuestion ? 'sm:w-auto sm:ml-auto' : ''}`}
                    >
                      {isLastQuestion ? 'See Summary' : 'Next Question'}
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </>
              )}
              {currentQuestion?.type === 'text' && (
                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  {!isFirstQuestion && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handlePreviousQuestion}
                      className="h-11 rounded-2xl border-edge-strong bg-transparent text-slate-300 hover:bg-subtle w-full sm:w-auto"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Previous
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      if (currentAnswer.trim()) {
                        setInteractiveAnswers({ ...interactiveAnswers, [currentQuestion.id]: currentAnswer });
                        setCurrentAnswer('');
                        if (isLastQuestion) {
                          setChildGameResults(null);
                          setShowGame(false);
                          setStep('activity_summary');
                        } else {
                          setInteractiveStep(interactiveStep + 1);
                        }
                      }
                    }}
                    disabled={!currentAnswer.trim()}
                    className={`h-11 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-primary-foreground font-semibold disabled:opacity-40 w-full ${!isFirstQuestion ? 'sm:w-auto sm:ml-auto' : ''}`}
                  >
                    {isLastQuestion ? 'See Summary' : 'Next Question'}
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <div />
      </div>
    );
  };

  const generateAiRecommendations = async (childResults) => {
    try {
      // Check completed area record first (most durable), then progress blob
      const completedData = await api.completedGrowthAreas.list(activeChildId);
      const existing = completedData?.areas?.find((a) => a.area_id === selectedArea?.id);
      if (existing?.recommendations?.length > 0) {
        setAiRecommendations(existing.recommendations);
        return;
      }
      const p = await api.recommendationsProgress.get(activeChildId);
      const air = p?.ai_three_month_recommendations;
      if (
        selectedArea?.id &&
        air?.area_id === selectedArea.id &&
        Array.isArray(air.items) &&
        air.items.length > 0
      ) {
        setAiRecommendations(air.items);
        return;
      }
    } catch (err) {
      console.warn('[RecommendationsPhase] Could not load cached recommendations, regenerating:', err);
    }

    setLoadingRecommendations(true);
    try {
      const questions = areaQuestions[selectedArea?.id] || areaQuestions.life_ambition;
      const qaContext = questions
        .filter(q => interactiveAnswers[q.id])
        .map(q => `Q: ${q.question.replace('{name}', data.name)}\nA: ${interactiveAnswers[q.id]}`)
        .join('\n\n');

      const childContext = childResults
        ? (() => {
            const gr = normalizeChildGameRecommendations(childResults);
            const sug = gr?.suggested_activities || [];
            return `\n\nChild's game responses:\nSummary: ${gr?.summary || ''}\nStrengths observed: ${(gr?.strengths || []).join(', ')}\nSuggested activities from game: ${sug.join(', ')}`;
          })()
        : '';

      const feedbackContext = feedback?.trim()
        ? `\n\nParent's feedback on suggested activities: "${feedback}"`
        : '';

      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Based on the following parent responses and child's game activity responses about "${data.name}" in the growth area "${selectedArea?.name}", generate 5 practical 3-month recommendations that synthesize both perspectives.\n\nParent responses:\n${qaContext}${childContext}${feedbackContext}\n\nReturn ONLY a JSON object with a "recommendations" array of 5 short, actionable bullet points (1-2 sentences each) specific to the "${selectedArea?.name}" growth area.`,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });
      const list = result && typeof result === 'object' && Array.isArray(result.recommendations) ? result.recommendations : [];
      setAiRecommendations(list);
    } catch (err) {
      console.error('[RecommendationsPhase] Failed to generate recommendations:', err);
      toast.error('Could not generate recommendations');
    } finally {
      setLoadingRecommendations(false);
    }
  };

  // Summary is displayed visually, no TTS needed for summary page

  const renderActivitySummary = () => {
    const questions = areaQuestions[selectedArea?.id] || areaQuestions.life_ambition;
    const AreaIcon = selectedArea?.icon || Award;

    const sectionAnim = (delay) => ({
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.8, delay, ease: 'easeOut' },
    });

    return (
      <div className="space-y-6">
      <motion.div {...sectionAnim(0.1)} className="text-center">
        <div className={`w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br ${selectedArea?.color || 'from-emerald-400 to-teal-500'} flex items-center justify-center`}>
          <AreaIcon className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Great Insights!</h2>
        <p className="text-slate-400">Here's what we learned about {data.name}'s {selectedArea?.name}</p>
      </motion.div>

      <motion.div {...sectionAnim(0.3)} className="bg-card rounded-2xl p-6 border-edge space-y-3">
        {questions.map((q, i) => {
          const answer = interactiveAnswers[q.id];
          if (!answer) return null;
          return (
            <motion.div
              key={`${qaAnimKey}-${q.id}`}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 1.1 + i * 0.15, ease: 'easeOut' }}
              className="border-b-edge-faint pb-3 last:border-0"
            >
              <p className="text-xs text-slate-500 mb-1">{q.question.replace('{name}', data.name)}</p>
              <p className="text-white text-sm font-medium">{answer}</p>
            </motion.div>
          );
        })}
      </motion.div>

      {selectedActivity && !childGameResults && (
        <motion.div {...sectionAnim(1.4)} className="bg-card rounded-2xl p-5 border border-purple-500/20 space-y-4">
          <p className="text-xs font-semibold text-purple-400 uppercase tracking-widest">Your selected activity</p>
          <div>
            <h3 className="text-base font-bold text-white">{selectedActivity.title}</h3>
            <p className="text-sm text-slate-400 mt-1">{selectedActivity.description}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-xs px-2 py-0.5 bg-ghost-light rounded-full text-slate-400">⏱ {selectedActivity.duration}</span>
              <span className="text-xs px-2 py-0.5 bg-purple-500/15 rounded-full text-purple-400 capitalize">{selectedActivity.type}</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              onClick={() => setStep('parent_activity')}
              className="rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white"
            >
              Open activity details
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep('activity_selection')} className="rounded-2xl border-edge-strong bg-transparent text-slate-300 hover:bg-subtle">
              Pick a different activity
            </Button>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {!parentLiked && !showGame && !childGameResults && (
        <motion.div
          key="no-parent-liked-buttons"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16, transition: { duration: 0.6, ease: 'easeIn' } }}
          transition={{ duration: 0.8, delay: 1.4, ease: 'easeOut' }}
          className="flex flex-col gap-3"
        >
          <div className="flex gap-3">
            <Button
              onClick={async () => {
                if (!selectedArea) return;
                await mergeChildGameFromServer(selectedArea.id, { reopenGame: true });
                setParentLiked(true);
              }}
              className="flex-1 h-11 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-primary-foreground font-semibold"
            >
              Explore Child Activity
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!selectedArea) return;
                await saveCompletedGrowthArea(selectedArea, interactiveAnswers, null);
                setStep('area_selection');
                setParentLiked(null);
                setChildActivitySelections([]);
                setChildGameResults(null);
                setShowGame(false);
              }}
              className="flex-1 h-11 rounded-2xl border-edge-strong bg-transparent text-slate-300 hover:bg-subtle"
            >
              Next Growth Area
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => handleFinishRef.current?.()}
            className="w-full h-11 rounded-2xl border border-teal-500/30 bg-transparent text-teal-400 hover:bg-teal-500/10"
          >
            <ChevronRight className="w-4 h-4 mr-2" />
            Go to Life Journey
          </Button>
        </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {parentLiked === true && !showGame && !childGameResults && (
          <motion.div
            key="parent-liked-buttons"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16, transition: { duration: 0.6, ease: 'easeIn' } }}
            transition={{ duration: 1.0, delay: 0.3, ease: 'easeOut' }}
            className="flex flex-col gap-3"
          >
            <Button
              onClick={async () => {
                if (!selectedArea) return;
                await mergeChildGameFromServer(selectedArea.id, { reopenGame: true });
                setShowGame(true);
              }}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              Present a fun game to {data.name} on the same topic
            </Button>
            <Button
              onClick={async () => {
                if (!selectedArea) return;
                await saveCompletedGrowthArea(selectedArea, interactiveAnswers, null);
                setStep('area_selection');
                setParentLiked(null);
                setChildActivitySelections([]);
                setChildGameResults(null);
                setShowGame(false);
              }}
              variant="outline"
              className="w-full h-12 rounded-2xl border-2"
            >
              Explore Later
            </Button>
            <Button
              variant="outline"
              onClick={() => handleFinishRef.current?.()}
              className="w-full h-12 rounded-2xl border border-teal-500/30 text-teal-400 bg-transparent hover:bg-teal-500/10"
            >
              <ChevronRight className="w-5 h-5 mr-2" />
              Go to Life Journey
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Child Game */}
      <AnimatePresence>
        {showGame && !childGameResults && selectedArea?.id && (
        <motion.div
          key="child-game"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeIn' } }}
          transition={{ duration: 1.0, ease: 'easeOut' }}
          className="bg-card rounded-3xl p-6 border border-emerald-500/20">
          <ChildActivityGame
            key={selectedArea.id}
            childName={data.name}
            areaId={selectedArea.id}
            activeChildId={activeChildId}
            selectedIds={childActivitySelections}
            onSelectedIdsChange={setChildActivitySelections}
            onComplete={async (results) => {
              const area = selectedArea;
              if (!area?.id) return;

              debouncedPersistRecommendationsProgress.cancel();

              const child_activity = {
                selections: Array.isArray(results.selections) ? [...results.selections] : [],
                results: results.recommendations ?? null,
              };

              try {
                await api.completedGrowthAreas.append(activeChildId, {
                  area_id: area.id,
                  area_name: area.name,
                  area_color: area.color,
                  answers: interactiveAnswers,
                  recommendations: aiRecommendations ?? null,
                  child_activity,
                });
              } catch (err) {
                console.error('[RecommendationsPhase] Could not save game results:', err);
                toast.error('Could not save game results. Try again or check your connection.');
              }

              setChildActivitySelections(child_activity.selections);
              setChildGameResults(results.recommendations);
              setShowGame(false);
            }}
          />
        </motion.div>
        )}
      </AnimatePresence>

      {/* Results Display */}
      {childGameResults && (
            <div className="space-y-4">

              {/* Section 2 — delays are relative to when childGameResults first mounts
                  so they work correctly both on resume (page load) and after game submit */}
              {/* Plain div anchor for scroll target — not affected by framer transforms */}
              <div ref={resultsRef} />
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
                className="bg-card rounded-3xl p-6 border border-emerald-500/20"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
                  className="text-center mb-4"
                >
                  <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-3">
                    <Sparkles className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white">Recommendations for {data.name}</h3>
                </motion.div>

                {/* What This Reveals */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.5, ease: 'easeOut' }}
                  className="bg-surface-elevated rounded-2xl p-4 mb-4"
                >
                  <h4 className="font-semibold text-white mb-2">What This Reveals</h4>
                  <p className="text-slate-400 text-sm">{childGameResults?.summary ?? ''}</p>
                </motion.div>

                {/* Suggested Activities */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.9, ease: 'easeOut' }}
                  className="bg-surface-elevated rounded-2xl p-4 mb-4"
                >
                  <h4 className="font-semibold text-white mb-2">Suggested Activities</h4>
                  <ul className="space-y-2">
                    {suggestedActivitiesFromGameRecommendations(childGameResults).map((activity, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 1.0 + i * 0.13, ease: 'easeOut' }}
                        className="flex items-start gap-2 text-sm text-slate-400"
                      >
                        <span className="text-emerald-500 mt-1">✓</span>
                        <span>{activity}</span>
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>

                {/* Strengths */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 1.5, ease: 'easeOut' }}
                  className="bg-surface-elevated rounded-2xl p-4"
                >
                  <h4 className="font-semibold text-white mb-2">Strengths to Encourage</h4>
                  <ul className="space-y-2">
                    {(Array.isArray(childGameResults?.strengths) ? childGameResults.strengths : []).map((strength, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 1.65 + i * 0.13, ease: 'easeOut' }}
                        className="flex items-start gap-2 text-sm text-slate-400"
                      >
                        <span className="text-emerald-500 mt-1">★</span>
                        <span>{strength}</span>
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              </motion.div>

              {/* Section 3 — last strength: 1.65 + 2*0.13 = 1.91, + 0.6 = 2.51 → delay 2.5 */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 2.5, ease: 'easeOut' }}
                className="bg-card rounded-3xl p-6 border border-emerald-500/15"
              >
                <h3 className="font-bold text-white mb-3 flex items-center gap-2">
                  <Target className="w-5 h-5 text-emerald-600" />
                  3-Month Recommendations for {selectedArea?.name}
                </h3>

                {!aiRecommendations && !loadingRecommendations && (
                  <Button
                    onClick={() => generateAiRecommendations(childGameResults)}
                    className="w-full h-11 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Recommendations
                  </Button>
                )}

                {loadingRecommendations && (
                  <div className="flex flex-col items-center justify-center py-10 gap-5">
                    <div className="relative w-16 h-16">
                      <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20" />
                      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-emerald-500 animate-spin" />
                      <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-teal-400 animate-spin" style={{ animationDuration: '0.7s', animationDirection: 'reverse' }} />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-white font-semibold text-sm">Building your 3-Month Plan</p>
                      <p className="text-slate-500 text-xs">Personalising recommendations for {data?.name}…</p>
                    </div>
                  </div>
                )}

                {Array.isArray(aiRecommendations) && aiRecommendations.length > 0 && (
                  <ul className="space-y-3">
                    {aiRecommendations.map((rec, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.7, delay: i * 0.15, ease: 'easeOut' }}
                        className="flex items-start gap-3 text-sm text-slate-300"
                      >
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500 text-white text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                        <span>{rec}</span>
                      </motion.li>
                    ))}
                  </ul>
                )}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 2.5, ease: 'easeOut' }}
                className="flex flex-col gap-3"
              >
              <Button
                onClick={async () => {
                  if (!selectedArea) return;
                  await saveCompletedGrowthArea(selectedArea, interactiveAnswers, aiRecommendations, {
                    selections: childActivitySelections,
                    results: childGameResults,
                  });
                  if (currentAreaIndex < growthAreas.length - 1) {
                    setCurrentAreaIndex(currentAreaIndex + 1);
                    setStep('area_selection');
                    setShowGame(false);
                    setChildGameResults(null);
                    setChildActivitySelections([]);
                    setAiRecommendations(null);
                    setParentLiked(null);
                  } else {
                    navigate(createPageUrl('LifePathway'), {
              replace: true,
            });
                  }
                }}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
              >
                {currentAreaIndex < growthAreas.length - 1 ? 'Explore More Growth Areas' : 'Explore Life Journey'}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleFinishRef.current?.()}
                className="w-full h-12 rounded-2xl border border-teal-500/30 text-teal-400 bg-transparent hover:bg-teal-500/10"
              >
                <ChevronRight className="w-5 h-5 mr-2" />
                Go to Life Journey
              </Button>
              </motion.div>
            </div>
          )}
    </div>
    );
  };

  const renderSkip = () => (
    <div className="space-y-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.1, ease: 'easeOut' }}
        className="flex flex-col items-center gap-6"
      >
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-white">Ready for the Next Step!</h2>
        <p className="text-slate-400">
          Let's explore the Life Journey designed for {data.name}.
        </p>
        <Button
          onClick={() => {
            navigate(createPageUrl('LifePathway'), { replace: true });
          }}
          className="h-12 px-8 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
        >
          Continue to Life Journey
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
      </motion.div>
    </div>
  );

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.3 }}
      >
        {step === 'intro' && renderIntro()}
        {step === 'area_selection' && renderAreaSelection()}
        {step === 'activity_selection' && renderActivitySelection()}
        {step === 'interactive_activity' && renderInteractiveActivity()}
        {step === 'activity_summary' && renderActivitySummary()}
        {step === 'parent_activity' && renderParentActivity()}
        {step === 'feedback' && renderFeedback()}
        {step === 'child_activity_prompt' && renderChildActivityPrompt()}
        {step === 'results' && renderResults()}
        {step === 'skip' && renderSkip()}
      </motion.div>
    </AnimatePresence>
  );
}