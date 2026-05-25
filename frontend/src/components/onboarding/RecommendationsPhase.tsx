import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { debounce } from 'lodash';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Star,
  Rocket,
  Clock,
  ThumbsUp,
  ThumbsDown,
  ChevronLeft,
  ChevronRight,
  Brain,
  Heart,
  Dumbbell,
  Palette,
  Target,
  Compass,
  Zap,
  Award,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { api } from '@/api/client';
import { toast } from 'sonner';
import ChildActivityGame, { normalizeChildGameRecommendations } from './ChildActivityGame';
import { createPageUrl } from '@/utils';
import { pickPreferredVoice } from '@/lib/tts';

// ── types ─────────────────────────────────────────────────────────────────────

interface AreaDef {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  description: string;
}

interface ActivityDef {
  title: string;
  description: string;
  duration: string;
  type: string;
}

interface RecommendationsPhaseProps {
  data: Record<string, unknown>;
  profile: Record<string, unknown>;
  recommendations?: unknown;
  activeChildId?: string;
  onFinish?: () => Promise<void> | void;
  onRegisterBack?: (fn: () => void) => void;
  onPhaseBack?: () => void;
}

interface ChildGameResults {
  summary?: string;
  strengths?: string[];
  suggested_activities?: string[];
  [key: string]: unknown;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function suggestedActivitiesFromGameRecommendations(rec: unknown): string[] {
  if (!rec || typeof rec !== 'object') return [];
  const n = normalizeChildGameRecommendations(rec);
  return Array.isArray(n.suggested_activities) ? (n.suggested_activities as string[]) : [];
}

const growthAreas = [
  {
    id: 'life_ambition',
    name: 'Life Ambition',
    icon: Rocket,
    color: 'from-purple-500 to-indigo-600',
    description: 'Discovering purpose and future goals',
  },
  {
    id: 'self_care',
    name: 'Self Care',
    icon: Heart,
    color: 'from-rose-500 to-pink-600',
    description: 'Building healthy habits and emotional wellness',
  },
  {
    id: 'critical_thinking',
    name: 'Critical Thinking',
    icon: Brain,
    color: 'from-blue-500 to-cyan-600',
    description: 'Problem solving and analytical skills',
  },
  {
    id: 'creativity',
    name: 'Creativity',
    icon: Palette,
    color: 'from-amber-500 to-orange-600',
    description: 'Imagination and creative expression',
  },
  {
    id: 'physical_wellness',
    name: 'Physical Wellness',
    icon: Dumbbell,
    color: 'from-emerald-500 to-teal-600',
    description: 'Body awareness and physical health',
  },
  {
    id: 'social_skills',
    name: 'Social Skills',
    icon: MessageSquare,
    color: 'from-violet-500 to-purple-600',
    description: 'Communication and relationship building',
  },
];

const sampleActivities = {
  life_ambition: [
    {
      title: 'Dream Board Creation',
      description: 'Create a visual board of future dreams and goals',
      duration: '20 mins',
      type: 'creative',
    },
    {
      title: 'Career Explorer Quiz',
      description: 'Fun quiz to discover interests and potential paths',
      duration: '10 mins',
      type: 'game',
    },
    {
      title: 'Future Self Letter',
      description: 'Write a letter to yourself 10 years from now',
      duration: '15 mins',
      type: 'reflection',
    },
  ],
  self_care: [
    {
      title: 'Emotion Detective',
      description: 'Identify and name different emotions through scenarios',
      duration: '10 mins',
      type: 'game',
    },
    {
      title: 'Mindful Breathing Adventure',
      description: 'Learn calming techniques through a fun story',
      duration: '8 mins',
      type: 'activity',
    },
    {
      title: 'Gratitude Treasure Hunt',
      description: 'Find 5 things to be grateful for today',
      duration: '10 mins',
      type: 'challenge',
    },
  ],
  critical_thinking: [
    {
      title: 'Mystery Solver',
      description: 'Solve fun logic puzzles and riddles',
      duration: '15 mins',
      type: 'game',
    },
    {
      title: 'What Would You Do?',
      description: 'Decision-making scenarios with multiple outcomes',
      duration: '12 mins',
      type: 'interactive',
    },
    {
      title: 'Pattern Detective',
      description: 'Find patterns and predict what comes next',
      duration: '10 mins',
      type: 'puzzle',
    },
  ],
  creativity: [
    {
      title: 'Story Remix',
      description: 'Take a familiar story and give it a creative twist',
      duration: '15 mins',
      type: 'creative',
    },
    {
      title: 'Invention Challenge',
      description: 'Design a solution for an everyday problem',
      duration: '20 mins',
      type: 'challenge',
    },
    {
      title: 'Music & Mood',
      description: 'Create sounds that match different emotions',
      duration: '10 mins',
      type: 'interactive',
    },
  ],
  physical_wellness: [
    {
      title: 'Body Scan Adventure',
      description: 'Fun guided body awareness activity',
      duration: '8 mins',
      type: 'activity',
    },
    {
      title: 'Movement Challenge',
      description: 'Quick fun physical challenges to try',
      duration: '10 mins',
      type: 'game',
    },
    {
      title: 'Healthy Habits Hero',
      description: 'Track and celebrate healthy daily habits',
      duration: '5 mins',
      type: 'tracker',
    },
  ],
  social_skills: [
    {
      title: 'Conversation Starter',
      description: 'Practice starting and maintaining conversations',
      duration: '10 mins',
      type: 'interactive',
    },
    {
      title: 'Empathy Explorer',
      description: 'Understand how others might feel in situations',
      duration: '12 mins',
      type: 'game',
    },
    {
      title: 'Teamwork Challenge',
      description: 'Activities that require collaboration',
      duration: '15 mins',
      type: 'challenge',
    },
  ],
};

const areaQuestions = {
  life_ambition: [
    {
      id: 'dream_career',
      question: 'What does {name} dream of becoming when he/she grows up?',
      type: 'text',
      placeholder: 'e.g., Doctor, Teacher, Astronaut, Artist...',
      followUp: "That's wonderful! Dreams are the seeds of future achievements.",
    },
    {
      id: 'interests_alignment',
      question: 'Are his/her interests & hobbies in line with his/her dream?',
      type: 'choice',
      options: ['Yes', 'No', 'Not Sure at this point'],
      followUp: 'Understanding this helps us guide their journey better.',
    },
    {
      id: 'support_type',
      question:
        'What kind of support are you willing to give to support his/her dream at this point?',
      type: 'choice',
      options: ['In every aspect', 'Financially', 'Moral support', 'Not sure at this point'],
      followUp: 'Your support is crucial in nurturing their aspirations.',
    },
    {
      id: 'explore_options',
      question: 'Do you think {name} should explore other career options as well?',
      type: 'choice',
      options: ['Yes', 'No', 'Not sure at this point'],
      followUp: 'Exploration helps children discover their true passions.',
    },
    {
      id: 'revisit_timeline',
      question: "When do you want to re-visit {name}'s life aspirations?",
      type: 'choice',
      options: ['After 1 year', 'After 3 years', 'After 5 years', 'Not sure at this point'],
      followUp: 'Regular check-ins help keep dreams aligned with growth.',
    },
  ],
  self_care: [
    {
      id: 'emotional_awareness',
      question: 'How well does {name} recognize and name their own emotions?',
      type: 'choice',
      options: ['Very well', 'Somewhat', 'Needs support', 'Not sure'],
      followUp: 'Emotional awareness is the first step to self-care.',
    },
    {
      id: 'stress_response',
      question: 'How does {name} typically respond when stressed or overwhelmed?',
      type: 'text',
      placeholder: 'e.g., withdraws, cries, talks about it...',
      followUp: 'Understanding stress responses helps us build better coping strategies.',
    },
    {
      id: 'sleep_habits',
      question: "How would you describe {name}'s sleep habits?",
      type: 'choice',
      options: ['Very consistent', 'Somewhat consistent', 'Irregular', 'Problematic'],
      followUp: 'Good sleep is fundamental to emotional and physical well-being.',
    },
    {
      id: 'self_soothing',
      question: 'Does {name} have any self-soothing or relaxation activities?',
      type: 'choice',
      options: ['Yes, several', 'One or two', 'Not really', 'Not sure'],
      followUp: 'Self-soothing skills are important tools for lifelong wellness.',
    },
    {
      id: 'self_care_goals',
      question: 'What self-care habit would you most like {name} to develop?',
      type: 'text',
      placeholder: 'e.g., morning routine, mindfulness, journaling...',
      followUp: 'Great goal! Small daily habits create lasting change.',
    },
  ],
  critical_thinking: [
    {
      id: 'problem_approach',
      question: "How does {name} typically approach a problem they can't solve immediately?",
      type: 'choice',
      options: ['Tries different strategies', 'Asks for help', 'Gets frustrated', 'Gives up'],
      followUp: 'Problem-solving persistence is a key thinking skill.',
    },
    {
      id: 'curiosity_level',
      question: 'How curious is {name} about how things work?',
      type: 'choice',
      options: [
        'Very curious',
        'Moderately curious',
        'Not particularly curious',
        'Depends on the topic',
      ],
      followUp: 'Curiosity is the engine of critical thinking!',
    },
    {
      id: 'decision_making',
      question: 'Can {name} make decisions independently, weighing pros and cons?',
      type: 'choice',
      options: ['Yes, quite well', 'Sometimes', 'Rarely', 'Not yet'],
      followUp: 'Decision-making is a skill that grows with practice.',
    },
    {
      id: 'question_asking',
      question: "Does {name} ask a lot of 'why' or 'how' questions?",
      type: 'choice',
      options: ['All the time', 'Often', 'Occasionally', 'Rarely'],
      followUp: 'Asking questions is a sign of an active, thinking mind.',
    },
    {
      id: 'thinking_goals',
      question: 'What critical thinking skill would you most like {name} to strengthen?',
      type: 'text',
      placeholder: 'e.g., logical reasoning, creative solutions, evaluating information...',
      followUp: "Excellent focus area! We'll build activities around this.",
    },
  ],
  creativity: [
    {
      id: 'creative_outlets',
      question: 'What creative activities does {name} enjoy most?',
      type: 'text',
      placeholder: 'e.g., drawing, storytelling, building, music...',
      followUp: 'Wonderful! Creative outlets are essential for expression and growth.',
    },
    {
      id: 'imagination_use',
      question: 'How often does {name} engage in imaginative play or storytelling?',
      type: 'choice',
      options: ['Daily', 'Several times a week', 'Occasionally', 'Rarely'],
      followUp: 'Imagination is the birthplace of all creativity.',
    },
    {
      id: 'creative_confidence',
      question: 'Does {name} feel confident sharing their creative work with others?',
      type: 'choice',
      options: ['Very confident', 'Somewhat confident', 'Hesitant', 'Avoids sharing'],
      followUp: 'Building creative confidence takes a supportive environment.',
    },
    {
      id: 'open_ended_play',
      question: 'Does {name} prefer structured activities or open-ended creative play?',
      type: 'choice',
      options: ['Prefers structured', 'Prefers open-ended', 'Enjoys both equally', 'Not sure'],
      followUp: 'Both styles have value — balance is key.',
    },
    {
      id: 'creativity_goals',
      question: "How would you like to nurture {name}'s creativity in the next 3 months?",
      type: 'text',
      placeholder: 'e.g., art classes, music lessons, creative writing...',
      followUp: "We'll use this to craft the perfect creative missions!",
    },
  ],
  physical_wellness: [
    {
      id: 'activity_level',
      question: 'How physically active is {name} on a typical day?',
      type: 'choice',
      options: ['Very active', 'Moderately active', 'Somewhat sedentary', 'Very sedentary'],
      followUp: 'Physical activity is a cornerstone of holistic wellness.',
    },
    {
      id: 'preferred_activities',
      question: 'What physical activities does {name} enjoy most?',
      type: 'text',
      placeholder: 'e.g., swimming, cycling, football, dancing...',
      followUp: 'Linking movement to enjoyment makes it sustainable.',
    },
    {
      id: 'body_awareness',
      question: "Is {name} aware of their body's signals (hunger, tiredness, discomfort)?",
      type: 'choice',
      options: ['Very aware', 'Somewhat aware', 'Not very aware', 'Not sure'],
      followUp: 'Body awareness is the foundation of physical self-care.',
    },
    {
      id: 'screen_time',
      question: 'How much screen time does {name} typically have per day?',
      type: 'choice',
      options: ['Less than 1 hour', '1-2 hours', '3-4 hours', 'More than 4 hours'],
      followUp: 'Balancing screen time with physical activity is a key wellness goal.',
    },
    {
      id: 'wellness_goals',
      question: 'What physical wellness goal would you set for {name} over the next 3 months?',
      type: 'text',
      placeholder: 'e.g., learn to swim, improve stamina, develop a sport...',
      followUp: 'A clear physical goal gives movement real purpose!',
    },
  ],
  social_skills: [
    {
      id: 'friendship_quality',
      question: "How would you describe {name}'s friendships?",
      type: 'choice',
      options: [
        'Has many close friends',
        'Has a few close friends',
        'Mostly acquaintances',
        'Struggles to connect',
      ],
      followUp: 'The quality of friendships matters more than quantity.',
    },
    {
      id: 'conflict_handling',
      question: 'How does {name} handle disagreements or conflicts with peers?',
      type: 'choice',
      options: [
        'Resolves calmly',
        'Needs some guidance',
        'Gets upset easily',
        'Avoids conflict entirely',
      ],
      followUp: 'Healthy conflict resolution is a powerful life skill.',
    },
    {
      id: 'empathy_level',
      question: "Does {name} show empathy and concern for others' feelings?",
      type: 'choice',
      options: ['Consistently', 'Often', 'Sometimes', 'Rarely'],
      followUp: 'Empathy is the foundation of all meaningful relationships.',
    },
    {
      id: 'group_participation',
      question: 'How does {name} behave in group settings (school, teams, clubs)?',
      type: 'choice',
      options: ['Natural leader', 'Active participant', 'Observer', 'Withdraws'],
      followUp: 'Understanding group dynamics helps us tailor the right activities.',
    },
    {
      id: 'social_goals',
      question: 'What social skill would you most like {name} to build in the next 3 months?',
      type: 'text',
      placeholder: 'e.g., starting conversations, teamwork, expressing feelings...',
      followUp: 'Wonderful focus! Social skills open doors throughout life.',
    },
  ],
};

// Type the question map to allow string indexing
const areaQuestionsMap: Record<string, typeof areaQuestions.life_ambition> = areaQuestions;

// Type the activity map to allow string indexing
const sampleActivitiesMap: Record<string, ActivityDef[]> = sampleActivities;

function answerLooksFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Build the per-area wizard state payload for in-progress saves to growth_areas. */
function buildAreaProgressPayload({
  area,
  step,
  selectedActivity,
  parentLiked,
  wantChildActivity,
  feedback,
  interactiveStep,
  interactiveAnswers,
  currentAnswer,
  generatedActivity,
  showGame,
  childActivitySelections,
  aiRecommendations,
  childGameResults,
}: {
  area: AreaDef;
  step: string;
  selectedActivity: ActivityDef | null;
  parentLiked: boolean | null;
  wantChildActivity: boolean | null;
  feedback: string;
  interactiveStep: number;
  interactiveAnswers: Record<string, unknown>;
  currentAnswer: string;
  generatedActivity: unknown;
  showGame: boolean;
  childActivitySelections: string[];
  aiRecommendations: unknown[] | null;
  childGameResults: ChildGameResults | null;
}): Record<string, unknown> {
  const cq =
    step === 'interactive_activity' && area
      ? (areaQuestionsMap[area.id] ?? areaQuestions.life_ambition)[interactiveStep]
      : null;
  const interactive_draft =
    cq?.type === 'text' ? { question_id: cq.id, text: currentAnswer ?? '' } : null;

  return {
    area_id: area.id,
    area_name: area.name,
    area_color: area.color,
    answers: interactiveAnswers || {},
    recommendations: null,
    status: 'in_progress',
    step,
    selected_activity: selectedActivity,
    parent_liked: parentLiked,
    want_child_activity: wantChildActivity,
    feedback,
    interactive_step: interactiveStep,
    interactive_answers: interactiveAnswers,
    interactive_draft,
    generated_activity: generatedActivity,
    show_game: showGame,
    // Preserve game results in every auto-save. Without this, the backend $set would write
    // child_activity: null (Pydantic default) and overwrite previously saved results.
    child_activity: childGameResults
      ? {
          selections: Array.isArray(childActivitySelections) ? childActivitySelections : [],
          results: childGameResults,
        }
      : null,
    child_activity_selections: Array.isArray(childActivitySelections)
      ? childActivitySelections
      : [],
    ai_three_month_recommendations:
      Array.isArray(aiRecommendations) && aiRecommendations.length > 0 ? aiRecommendations : null,
  };
}

/** Keep only answers whose keys belong to this growth area (avoids mixed-area blobs). */
function answersForArea(areaId: string, rawAnswers: unknown): Record<string, unknown> {
  const qs = areaQuestionsMap[areaId] ?? areaQuestions.life_ambition;
  const allowed = new Set(qs.map((q) => q.id));
  const src =
    rawAnswers && typeof rawAnswers === 'object' ? (rawAnswers as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!allowed.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function choiceAnswersEqual(saved: unknown, option: string): boolean {
  if (saved === undefined || saved === null) return false;
  const savedStr =
    typeof saved === 'string'
      ? saved
      : typeof saved === 'number' || typeof saved === 'boolean'
        ? String(saved)
        : '';
  return savedStr.trim() === String(option).trim();
}

function extractAnswersFromCompletedGrowthAreas(
  completedList: unknown[],
  areaId: string,
): Record<string, unknown> {
  if (!Array.isArray(completedList)) return {};
  const entry = completedList.find(
    (e) => e && typeof e === 'object' && (e as Record<string, unknown>)['area_id'] === areaId,
  ) as Record<string, unknown> | undefined;
  const ans = entry?.['answers'];
  return ans && typeof ans === 'object' ? { ...(ans as Record<string, unknown>) } : {};
}

/** 3-month AI bullets saved on completed growth area records. */
function extractAiRecommendationsFromCompleted(
  completedList: unknown[],
  areaId: string,
): unknown[] | null {
  if (!Array.isArray(completedList)) return null;
  const entry = completedList.find(
    (e) => e && typeof e === 'object' && (e as Record<string, unknown>)['area_id'] === areaId,
  ) as Record<string, unknown> | undefined;
  const recs = entry?.['recommendations'];
  if (!Array.isArray(recs) || recs.length === 0) return null;
  return recs as unknown[];
}

/** Restore questionnaire UI from progress + completed_growth_areas for one growth area. */
function deriveInteractiveUiFromProgress(
  area: AreaDef | null,
  p: Record<string, unknown>,
  completedGrowthAreas: unknown[] = [],
): {
  mergedAnswers: Record<string, unknown>;
  step: string;
  interactiveStep: number;
  currentAnswer: string;
} {
  if (!area) {
    return {
      mergedAnswers: {},
      step: 'interactive_activity',
      interactiveStep: 0,
      currentAnswer: '',
    };
  }

  const qs = areaQuestionsMap[area.id] ?? areaQuestions.life_ambition;
  const rawProgress =
    p['interactive_answers'] && typeof p['interactive_answers'] === 'object'
      ? { ...(p['interactive_answers'] as Record<string, unknown>) }
      : {};
  const fromCompleted = extractAnswersFromCompletedGrowthAreas(completedGrowthAreas, area.id);
  const mergedRaw = { ...fromCompleted, ...rawProgress };
  const mergedAnswers = answersForArea(area.id, mergedRaw);

  const areaMatchesPersisted = p['area_id'] === area.id;
  const stepVal = typeof p['step'] === 'string' ? p['step'] : 'intro';

  const completedHasArea = Array.isArray(completedGrowthAreas)
    ? completedGrowthAreas.some(
        (e) => e && typeof e === 'object' && (e as Record<string, unknown>)['area_id'] === area.id,
      )
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
        interactiveStep: typeof p['interactive_step'] === 'number' ? p['interactive_step'] : 0,
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
    const draft =
      p['interactive_draft'] && typeof p['interactive_draft'] === 'object'
        ? (p['interactive_draft'] as Record<string, unknown>)
        : null;
    let currentAnswer = '';
    const useDraft =
      areaMatchesPersisted &&
      cq?.type === 'text' &&
      draft?.['question_id'] === cq?.id &&
      typeof draft['text'] === 'string';

    if (useDraft && draft) {
      currentAnswer = draft['text'] as string;
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
    interactiveStep: typeof p['interactive_step'] === 'number' ? p['interactive_step'] : 0,
    currentAnswer: '',
  };
}

/** Opening from grid: land on questionnaire when revisiting so choices/text show saved values (summary alone hides MC state). */
function applyTileEntryInteractivePreference(
  area: AreaDef,
  d: {
    mergedAnswers: Record<string, unknown>;
    step: string;
    interactiveStep: number;
    currentAnswer: string;
  },
): { step: string; interactiveStep: number; currentAnswer: string } {
  const qs = areaQuestionsMap[area.id] ?? areaQuestions.life_ambition;
  const anyFilled = qs.some((q) => answerLooksFilled(d.mergedAnswers[q.id]));

  if (d.step === 'activity_summary' && anyFilled) {
    const ixUse = 0;
    const cq = qs[ixUse];
    let caUse = '';
    if (cq?.type === 'text' && answerLooksFilled(d.mergedAnswers[cq?.id ?? ''])) {
      caUse = String(d.mergedAnswers[cq.id]);
    }
    return { step: 'interactive_activity', interactiveStep: ixUse, currentAnswer: caUse };
  }

  return { step: d.step, interactiveStep: d.interactiveStep, currentAnswer: d.currentAnswer };
}

export default function RecommendationsPhase({
  data,
  profile,
  activeChildId,
  onFinish,
  onRegisterBack,
  onPhaseBack,
}: RecommendationsPhaseProps) {
  const navigate = useNavigate();
  // voiceEnabledRef is a stable ref — safe to use with empty deps
  const speak = useCallback((text: string) => {
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
      setQaAnimKey((k) => k + 1);
    }
  }, [step]);
  const [selectedArea, setSelectedArea] = useState<AreaDef | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityDef | null>(null);
  const [parentLiked, setParentLiked] = useState<boolean | null>(null);
  const [wantChildActivity, setWantChildActivity] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState('');
  const [currentAreaIndex, setCurrentAreaIndex] = useState(0);
  const [interactiveStep, setInteractiveStep] = useState(0);
  const [interactiveAnswers, setInteractiveAnswers] = useState<Record<string, unknown>>({});
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [generatedActivity, setGeneratedActivity] = useState<unknown>(null);
  const [showGame, setShowGame] = useState(false);
  const [childGameResults, setChildGameResults] = useState<ChildGameResults | null>(null);
  const [childActivitySelections, setChildActivitySelections] = useState<string[]>([]);
  const [_voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [aiRecommendations, setAiRecommendations] = useState<unknown[] | null>(null);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const completedAreaIdsRef = useRef(new Set<string>());

  // Debounced save of per-area wizard state to growth_areas (status: 'in_progress')
  const debouncedSaveAreaProgress = useMemo(
    () =>
      debounce((payload: Record<string, unknown>) => {
        api.completedGrowthAreas.append(activeChildId ?? '', payload).catch(() => {});
      }, 400),
    [activeChildId],
  );

  // Load saved progress from server once
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        debouncedSaveAreaProgress.cancel();
        const [_childFresh, completedDataRaw, prefsRaw] = await Promise.all([
          api.entities.Child.get(activeChildId ?? ''),
          api.completedGrowthAreas.list(activeChildId ?? ''),
          api.preferences.get(),
        ]);
        if (cancelled) return;

        const prefs = prefsRaw as Record<string, unknown>;
        if (typeof prefs['tts_enabled'] === 'boolean') {
          voiceEnabledRef.current = prefs['tts_enabled'];
          setVoiceEnabled(prefs['tts_enabled']);
        }

        const completedData = completedDataRaw as Record<string, unknown>;
        const allDocsRaw = Array.isArray(completedData['areas']) ? completedData['areas'] : [];
        const allDocs = allDocsRaw as Record<string, unknown>[];

        // Build completedAreaIds from docs that are finalised (status === 'completed' or legacy docs with no status)
        const completedDocs = allDocs.filter((a) => a.status === 'completed' || !a.status);
        if (completedDocs.length > 0) {
          completedAreaIdsRef.current = new Set(completedDocs.map((a) => a.area_id as string));
        }

        // Restore from in-progress area doc (wizard_step / wizard_area_index removed;
        // navigation state now lives in the URL via last_visited_path)
        const inProgressDoc = allDocs.find((a) => a.status === 'in_progress') ?? null;
        if (!inProgressDoc?.area_id) return;

        const areaObj = growthAreas.find((a) => a.id === inProgressDoc.area_id) ?? null;
        const areaIdx = growthAreas.findIndex((a) => a.id === inProgressDoc.area_id);
        if (typeof areaIdx === 'number' && areaIdx >= 0) setCurrentAreaIndex(areaIdx);

        if (areaObj) {
          setSelectedArea(areaObj);
          const p = inProgressDoc;

          if (p.selected_activity) setSelectedActivity(p.selected_activity as ActivityDef);
          if (p.parent_liked != null) setParentLiked(p.parent_liked as boolean);
          if (p.want_child_activity != null) setWantChildActivity(p.want_child_activity as boolean);
          if (typeof p.feedback === 'string') setFeedback(p.feedback);

          const d = deriveInteractiveUiFromProgress(areaObj, p, allDocs);
          setInteractiveAnswers(d.mergedAnswers);
          setStep(d.step);
          setInteractiveStep(d.interactiveStep);
          setCurrentAnswer(d.currentAnswer);

          const ca = p.child_activity as
            | { selections?: unknown; results?: ChildGameResults }
            | null
            | undefined;
          if (ca) {
            const sels = Array.isArray(ca.selections) ? (ca.selections as string[]) : [];
            setChildActivitySelections(sels);
            if (ca.results && d.step === 'activity_summary') {
              setChildGameResults(ca.results);
              setShowGame(false);
              setParentLiked(true);
            }
          } else {
            const savedSels = p.child_activity_selections;
            if (Array.isArray(savedSels)) setChildActivitySelections(savedSels);
          }

          if (p.generated_activity) setGeneratedActivity(p.generated_activity);
          if (typeof p.show_game === 'boolean') setShowGame(p.show_game);

          let aiRec =
            Array.isArray(p.ai_three_month_recommendations) &&
            p.ai_three_month_recommendations.length > 0
              ? p.ai_three_month_recommendations
              : null;
          aiRec ??= extractAiRecommendationsFromCompleted(completedDocs, areaObj.id);
          setAiRecommendations(aiRec);
        }
      } catch (err) {
        console.warn('[RecommendationsPhase] Resume load failed, keeping defaults:', err);
      } finally {
        if (!cancelled) setResumeLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChildId, debouncedSaveAreaProgress]);

  useEffect(() => {
    const flushOnUnload = () => {
      debouncedSaveAreaProgress.flush?.();
    };
    window.addEventListener('beforeunload', flushOnUnload);
    return () => {
      window.removeEventListener('beforeunload', flushOnUnload);
      debouncedSaveAreaProgress.cancel();
    };
  }, [debouncedSaveAreaProgress]);

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
          const qs = areaQuestionsMap[selectedArea?.id ?? ''] ?? areaQuestions.life_ambition;
          const firstIncomplete = qs.findIndex(
            (q: { id: string }) => !answerLooksFilled(interactiveAnswers[q.id]),
          );
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
  const growthAreaSaveChainRef = useRef(Promise.resolve());
  const resultsRef = useRef<HTMLDivElement | null>(null);
  // Always-current ref — "Go to Life Journey" buttons call this so they always
  // have the latest closure state without needing to re-bind on every render.
  const handleFinishRef = useRef<(() => Promise<void>) | null>(null);

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
  }, [childGameResults]);

  // Auto-persist per-area wizard state to growth_areas (in_progress)
  useEffect(() => {
    if (!resumeLoaded || !selectedArea) return;

    const payload = buildAreaProgressPayload({
      area: selectedArea,
      step,
      selectedActivity,
      parentLiked,
      wantChildActivity,
      feedback,
      interactiveStep,
      interactiveAnswers,
      currentAnswer,
      generatedActivity,
      showGame,
      childActivitySelections,
      aiRecommendations,
      childGameResults,
    });
    debouncedSaveAreaProgress(payload);
  }, [
    resumeLoaded,
    selectedArea,
    step,
    selectedActivity,
    parentLiked,
    wantChildActivity,
    feedback,
    interactiveStep,
    interactiveAnswers,
    currentAnswer,
    generatedActivity,
    showGame,
    childActivitySelections,
    childGameResults,
    aiRecommendations,
    debouncedSaveAreaProgress,
  ]);

  useEffect(() => {
    if (!resumeLoaded || step !== 'interactive_activity' || !selectedArea) return;
    const questions = areaQuestionsMap[selectedArea.id] ?? areaQuestions.life_ambition;
    const cq = questions[interactiveStep];
    if (cq?.type !== 'text') return;

    const saved = interactiveAnswers[cq.id];
    const savedStr =
      saved === undefined || saved === null
        ? ''
        : typeof saved === 'string'
          ? saved
          : typeof saved === 'number' || typeof saved === 'boolean'
            ? String(saved)
            : '';

    if (savedStr.trim() !== '') {
      setCurrentAnswer(savedStr);
    }
  }, [resumeLoaded, step, selectedArea, interactiveStep, interactiveAnswers]);

  const saveCompletedGrowthArea = async (
    area: AreaDef,
    answers: Record<string, unknown>,
    recs: unknown[] | null,
    childActivity: { selections: string[]; results: ChildGameResults } | undefined = undefined,
  ) => {
    // Cancel (not flush) the in-progress debounce — the completion payload supersedes it.
    // Flushing would race the completion call on the wire and could overwrite status:'completed'
    // with status:'in_progress' if the debounced request arrives last.
    debouncedSaveAreaProgress.cancel?.();
    const payload = {
      area_id: area.id,
      area_name: area.name,
      area_color: area.color,
      answers,
      recommendations: recs,
      status: 'completed',
      // Clear wizard state fields on completion
      step: null,
      selected_activity: null,
      parent_liked: null,
      want_child_activity: null,
      feedback: null,
      interactive_step: null,
      interactive_answers: null,
      interactive_draft: null,
      generated_activity: null,
      show_game: null,
      child_activity_selections: null,
      ai_three_month_recommendations: null,
      ...(childActivity ? { child_activity: childActivity } : {}),
    };
    const task = growthAreaSaveChainRef.current.then(() =>
      api.completedGrowthAreas.append(activeChildId ?? '', payload),
    );
    growthAreaSaveChainRef.current = task.then(
      () => {},
      () => {},
    );
    try {
      await task;
      // Clear selectedArea first so the auto-save effect's guard (if (!selectedArea) return)
      // blocks any in_progress write that would otherwise overwrite status:'completed'.
      setSelectedArea(null);
      debouncedSaveAreaProgress.cancel?.(); // belt-and-suspenders: cancel any debounce queued during the await
      setInteractiveAnswers({});
      setAiRecommendations(null);
      setChildActivitySelections([]);
      completedAreaIdsRef.current = new Set([...completedAreaIdsRef.current, area.id]);
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

  /** Fetch area doc from DB and restore child game UI state. */
  const mergeChildGameFromServer = async (
    areaId: string,
    { reopenGame }: { reopenGame?: boolean } = {},
  ) => {
    if (!areaId) return;
    try {
      debouncedSaveAreaProgress.flush?.();
      const completedDataRaw = await api.completedGrowthAreas.list(activeChildId ?? '');
      const completedData = completedDataRaw as { areas?: Record<string, unknown>[] } | null;
      const areaDoc = completedData?.areas?.find((a) => a['area_id'] === areaId);
      const ca = areaDoc
        ? (areaDoc['child_activity'] as
            | { selections?: unknown; results?: ChildGameResults }
            | null
            | undefined)
        : null;
      if (ca) {
        setChildActivitySelections(Array.isArray(ca.selections) ? (ca.selections as string[]) : []);
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
        // Fall back to in-progress selections stored on the growth_areas doc
        const savedSels = areaDoc ? areaDoc['child_activity_selections'] : undefined;
        setChildActivitySelections(Array.isArray(savedSels) ? (savedSels as string[]) : []);
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
      const topStrengths = Array.isArray(profile['top_strengths'])
        ? (profile['top_strengths'] as unknown[])
        : [];
      const strengthsText =
        topStrengths.map((s, i) => `Strength ${i + 1}: ${String(s)}`).join('. ') || '';
      const personalityType =
        typeof profile['personality_type'] === 'string' ? profile['personality_type'] : '';
      const primaryType = personalityType.split(' - ')[1] ?? personalityType;
      const summaryStr = typeof profile['summary'] === 'string' ? profile['summary'] : '';
      const summaryAlreadyContainsType =
        primaryType && summaryStr.toLowerCase().includes(primaryType.toLowerCase());
      const fullText = summaryAlreadyContainsType
        ? `${String(data['name'])}'s profile. ${summaryStr}. Emerging strengths: ${strengthsText}`
        : `${String(data['name'])}'s personality type is ${primaryType}. ${summaryStr}. Emerging strengths: ${strengthsText}`;
      speak(fullText);
      introHasSpoken.current = true;
    }
  }, [step, profile, resumeLoaded, speak, data]);

  const renderIntro = () => {
    const sectionAnim = (delay: number) => ({
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 1.0, delay, ease: 'easeOut' },
    });

    return (
      <div className="space-y-8">
        {/* Section 1 — Header */}
        <motion.div {...sectionAnim(0.1)} className="text-center">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-teal-400 to-emerald-500">
            <Sparkles className="h-12 w-12 text-white" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-white">Your Personalized Journey</h2>
          <p className="text-slate-400">
            Here's what we've discovered about {String(data['name'])}
          </p>
        </motion.div>

        {/* Section 2 — Profile Summary Card */}
        {profile && (
          <motion.div {...sectionAnim(0.8)} className="border-edge rounded-2xl bg-card p-6">
            <div className="mb-4 flex items-start gap-4">
              <div className="glow-teal-sm flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-600">
                <Star className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{String(data['name'])}'s Profile</h3>
                <p className="text-sm font-medium text-teal-400">
                  {(() => {
                    const pt =
                      typeof profile['personality_type'] === 'string'
                        ? profile['personality_type']
                        : '';
                    return pt.split(' - ')[1] ?? pt;
                  })()}
                </p>
              </div>
            </div>

            <p className="mb-5 text-sm leading-relaxed text-slate-400">
              {typeof profile['summary'] === 'string' ? profile['summary'] : ''}
            </p>

            {/* Top Strengths */}
            <div className="space-y-2">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-600">
                Emerging Strengths
              </p>
              {(Array.isArray(profile['top_strengths'])
                ? (profile['top_strengths'] as unknown[])
                : []
              ).map((strength, index) => (
                <motion.div
                  key={String(strength)}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.8, delay: 1.1 + index * 0.25 }}
                  className="border-edge-faint flex items-start gap-3 rounded-xl bg-surface-input p-3"
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
                    <span className="text-xs font-bold text-amber-400">{index + 1}</span>
                  </div>
                  <p className="text-sm font-semibold text-white">{String(strength)}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Section 3 — Explore Growth Areas Prompt */}
        <motion.div
          {...sectionAnim(1.8)}
          className="rounded-2xl border border-purple-500/20 bg-card p-6"
        >
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600">
              <Compass className="h-7 w-7 text-white" />
            </div>
            <h3 className="text-lg font-bold text-white">
              Do you want to explore the specific growth areas for {String(data['name'])} to become
              their best version?
            </h3>
            <p className="text-sm text-slate-400">
              Discover personalized activities to help {String(data['name'])} develop key life
              skills
            </p>

            <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
              <Button
                onClick={() => setStep('area_selection')}
                className="h-12 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 px-8 text-white hover:from-purple-400 hover:to-indigo-500"
              >
                <Zap className="mr-2 h-4 w-4" />
                Continue Now
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(createPageUrl('Home'))}
                className="border-edge-strong hover:bg-subtle h-12 rounded-2xl bg-transparent px-8 text-slate-300"
              >
                <Clock className="mr-2 h-4 w-4" />
                Catch Up Later
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  const renderAreaSelection = () => {
    const sectionAnim = (delay: number) => ({
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 1.0, delay, ease: 'easeOut' },
    });

    return (
      <div className="space-y-6">
        <motion.div {...sectionAnim(0.5)} className="text-center">
          <h2 className="mb-2 text-2xl font-bold text-white">Growth Areas</h2>
          <p className="text-slate-400">Choose an area to explore for {String(data['name'])}</p>
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
                onClick={() => {
                  void (async () => {
                    debouncedSaveAreaProgress.flush?.();
                    setSelectedArea(area);
                    setCurrentAreaIndex(i);

                    try {
                      const completedDataRaw = await api.completedGrowthAreas.list(
                        activeChildId ?? '',
                      );
                      const completedDataObj = completedDataRaw as {
                        areas?: Record<string, unknown>[];
                      } | null;
                      const allDocs: Record<string, unknown>[] = Array.isArray(
                        completedDataObj?.areas,
                      )
                        ? completedDataObj.areas
                        : [];
                      // Per-area doc: in-progress takes priority over completed
                      const p: Record<string, unknown> =
                        allDocs.find(
                          (a) => a['area_id'] === area.id && a['status'] === 'in_progress',
                        ) ??
                        allDocs.find((a) => a['area_id'] === area.id) ??
                        {};
                      const isInProgress = p.status === 'in_progress';

                      const d = deriveInteractiveUiFromProgress(area, p, allDocs);
                      const nav = applyTileEntryInteractivePreference(area, d);

                      setInteractiveAnswers(d.mergedAnswers);
                      setInteractiveStep(nav.interactiveStep);
                      setCurrentAnswer(nav.currentAnswer);
                      setStep(nav.step);

                      // AI recommendations: prefer in-progress cached recs, fall back to completed doc recommendations.
                      // Also fall back to current in-memory state when re-opening the SAME area — guards against
                      // the flush→list race where the debounced append hasn't reached the DB by the time list returns.
                      const isSameArea = area.id === selectedArea?.id;
                      const completedDocs = allDocs.filter(
                        (a: Record<string, unknown>) => a['status'] === 'completed' || !a['status'],
                      );
                      const dbRecs =
                        Array.isArray(p.ai_three_month_recommendations) &&
                        p.ai_three_month_recommendations.length > 0
                          ? p.ai_three_month_recommendations
                          : extractAiRecommendationsFromCompleted(completedDocs, area.id);
                      const airMerged =
                        Array.isArray(dbRecs) && dbRecs.length > 0
                          ? dbRecs
                          : isSameArea &&
                              Array.isArray(aiRecommendations) &&
                              aiRecommendations.length > 0
                            ? aiRecommendations
                            : null;
                      setAiRecommendations(airMerged);

                      if (isInProgress) {
                        if (p['selected_activity'])
                          setSelectedActivity(p['selected_activity'] as ActivityDef);
                        else setSelectedActivity(null);
                        if (p['parent_liked'] != null) setParentLiked(p['parent_liked'] as boolean);
                        if (p['want_child_activity'] != null)
                          setWantChildActivity(p['want_child_activity'] as boolean);
                        if (typeof p['feedback'] === 'string') setFeedback(p['feedback']);

                        if (p['generated_activity']) setGeneratedActivity(p['generated_activity']);
                        else setGeneratedActivity(null);
                        if (typeof p['show_game'] === 'boolean') setShowGame(p['show_game']);

                        // Restore child game state — child_activity (finalised) takes priority
                        const ca2 = p['child_activity'] as
                          | { selections?: unknown; results?: ChildGameResults }
                          | null
                          | undefined;
                        if (ca2) {
                          setChildActivitySelections(
                            Array.isArray(ca2.selections) ? (ca2.selections as string[]) : [],
                          );
                          if (ca2.results && nav.step === 'activity_summary') {
                            setChildGameResults(ca2.results);
                            setShowGame(false);
                            setParentLiked(true);
                          }
                        } else {
                          setChildActivitySelections(
                            Array.isArray(p['child_activity_selections'])
                              ? (p['child_activity_selections'] as string[])
                              : [],
                          );
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

                      // Restore saved selections from any existing doc for this area
                      const ca3 = p['child_activity'] as
                        | { selections?: unknown }
                        | null
                        | undefined;
                      if (ca3) {
                        setChildActivitySelections(
                          Array.isArray(ca3.selections) ? (ca3.selections as string[]) : [],
                        );
                      } else {
                        setChildActivitySelections(
                          Array.isArray(p['child_activity_selections'])
                            ? (p['child_activity_selections'] as string[])
                            : [],
                        );
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
                  })();
                }}
                className="border-edge hover:border-c-bright rounded-2xl bg-card p-4 text-left transition-colors hover:bg-surface-elevated"
              >
                <div
                  className={`h-11 w-11 rounded-xl bg-gradient-to-br ${area.color} mb-3 flex items-center justify-center`}
                >
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <h4 className="text-sm font-semibold text-white">{area.name}</h4>
                <p className="mt-1 text-xs text-slate-500">{area.description}</p>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderActivitySelection = () => {
    const activities = sampleActivitiesMap[selectedArea?.id ?? ''] ?? [];
    const Icon = selectedArea?.icon ?? Target;

    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.1, ease: 'easeOut' }}
          className="text-center"
        >
          <div
            className={`mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br ${selectedArea?.color} mb-4 flex items-center justify-center`}
          >
            <Icon className="h-8 w-8 text-white" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-white">{selectedArea?.name}</h2>
          <p className="text-slate-400">Choose an activity to try with {String(data['name'])}</p>
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
              className={`w-full rounded-2xl border p-4 text-left transition-all duration-150 ${
                selectedActivity?.title === activity.title
                  ? 'border-purple-500/50 bg-purple-500/10'
                  : 'border-c-edge hover:border-c-bright bg-card hover:bg-surface-elevated'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-white">{activity.title}</h4>
                  <p className="mt-1 text-xs text-slate-500">{activity.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="bg-ghost-light rounded-full px-2 py-0.5 text-xs text-slate-400">
                      ⏱ {activity.duration}
                    </span>
                    <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs capitalize text-purple-400">
                      {activity.type}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-600" />
              </div>
            </motion.button>
          ))}
        </div>

        <div className="pt-2 text-center">
          <Button
            variant="ghost"
            onClick={() => setStep('area_selection')}
            className="text-slate-500 hover:text-white"
          >
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
          <div className="space-y-3 text-center">
            <Award className="mx-auto h-10 w-10" />
            <h2 className="text-xl font-bold">{selectedActivity?.title}</h2>
            <p className="text-sm text-white/80">{selectedActivity?.description}</p>
            <div className="flex justify-center gap-4 pt-1">
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs">
                ⏱ {selectedActivity?.duration}
              </span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.8, ease: 'easeOut' }}
          className="border-edge space-y-5 rounded-2xl bg-card p-6"
        >
          <h3 className="text-center text-sm font-bold text-white">
            Did you like this activity suggestion?
          </h3>

          <div className="flex justify-center gap-4">
            <Button
              onClick={() => {
                setParentLiked(true);
                setStep('child_activity_prompt');
              }}
              className="h-12 rounded-2xl bg-emerald-500 px-8 text-white hover:bg-emerald-400"
            >
              <ThumbsUp className="mr-2 h-4 w-4" />
              Yes, I like it!
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setParentLiked(false);
                setStep('feedback');
              }}
              className="border-edge-strong hover:bg-subtle h-12 rounded-2xl bg-transparent px-8 text-slate-300"
            >
              <ThumbsDown className="mr-2 h-4 w-4" />
              Not quite
            </Button>
          </div>
        </motion.div>

        <div className="text-center">
          <Button
            variant="ghost"
            onClick={() => setStep('activity_selection')}
            className="text-slate-500 hover:text-white"
          >
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
          <h2 className="mb-2 text-2xl font-bold text-white">We'd love your feedback</h2>
          <p className="text-slate-400">
            What kind of activity would you like for {String(data['name'])}?
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.8, ease: 'easeOut' }}
          className="border-edge space-y-4 rounded-2xl bg-card p-6"
        >
          <TextareaWithVoice
            placeholder="Tell us what you're looking for... (e.g., more interactive, shorter duration, different topic)"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="border-c-md min-h-[120px] rounded-xl bg-surface-input pr-14 text-white placeholder:text-slate-600"
          />

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setStep('activity_selection')}
              className="border-edge-strong hover:bg-subtle bg-transparent text-slate-300"
            >
              Go Back
            </Button>
            <Button
              onClick={() => {
                debouncedSaveAreaProgress.flush?.();
                setStep('activity_selection');
              }}
              className="bg-purple-500 text-white hover:bg-purple-400"
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
          className="rounded-2xl border border-emerald-500/20 bg-card p-6"
        >
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600">
              <Zap className="h-7 w-7 text-white" />
            </div>
            <h2 className="text-lg font-bold text-white">
              Do you want {String(data['name'])} to take a fun activity on {selectedArea?.name}?
            </h2>
            <p className="text-sm text-slate-400">
              {String(data['name'])} can complete this as a game on their device
            </p>

            <div className="flex flex-col justify-center gap-3 pt-4 sm:flex-row">
              <Button
                onClick={() => setStep('results')}
                className="h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-8 text-white hover:from-emerald-400 hover:to-teal-500"
              >
                Yes, Start Activity
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(createPageUrl('Home'))}
                className="border-edge-strong hover:bg-subtle h-12 rounded-2xl bg-transparent px-8 text-slate-300"
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
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500">
          <Award className="h-10 w-10 text-white" />
        </div>
        <h2 className="mb-2 text-2xl font-bold text-white">Activity Results Preview</h2>
        <p className="text-slate-400">
          Here's what you'll see after {String(data['name'])} completes activities
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.0, delay: 0.8, ease: 'easeOut' }}
        className="border-edge space-y-4 rounded-2xl bg-card p-6"
      >
        <div className="text-center">
          <p className="mb-2 text-xs uppercase tracking-widest text-slate-500">
            {selectedArea?.name} Quotient
          </p>
          <div className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-5xl font-bold text-transparent">
            --
          </div>
          <p className="mt-1 text-sm text-slate-600">Score will appear after activity</p>
        </div>

        <div className="border-t-edge-faint pt-4">
          <h4 className="mb-3 text-sm font-semibold text-white">Personalized Recommendations</h4>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-surface-input p-3">
                <div className="bg-ghost-light h-8 w-8 animate-pulse rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="bg-ghost-light h-3 w-3/4 animate-pulse rounded" />
                  <div className="bg-ghost-md h-2.5 w-1/2 animate-pulse rounded" />
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
        className="py-4 text-center"
      >
        <p className="text-sm text-slate-400">
          🎉 You're all set! Click{' '}
          <span className="font-semibold text-teal-400">"Start the Journey"</span> to go to your
          dashboard.
        </p>
      </motion.div>
    </div>
  );

  const renderInteractiveActivity = () => {
    const questions = areaQuestionsMap[selectedArea?.id ?? ''] ?? areaQuestions.life_ambition;
    const currentQuestion = questions[interactiveStep];
    const questionText = currentQuestion?.question.replace('{name}', String(data['name']));
    const isLastQuestion = interactiveStep === questions.length - 1;
    const isFirstQuestion = interactiveStep === 0;
    const AreaIcon = selectedArea?.icon ?? Rocket;

    const handlePreviousQuestion = () => {
      if (currentQuestion?.type === 'text' && currentAnswer.trim()) {
        setInteractiveAnswers({ ...interactiveAnswers, [currentQuestion.id]: currentAnswer });
      }
      const prevStep = interactiveStep - 1;
      const prevQuestion = questions[prevStep];
      const savedAns = prevQuestion ? interactiveAnswers[prevQuestion.id] : undefined;
      setCurrentAnswer(
        prevQuestion?.type === 'text' && typeof savedAns === 'string' ? savedAns : '',
      );
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
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/10 px-4 py-2">
            <AreaIcon className="h-4 w-4 text-teal-400" />
            <span className="text-sm font-medium text-teal-400">{selectedArea?.name} Activity</span>
          </div>
          <div className="mb-2 flex justify-center gap-1">
            {questions.map((_: unknown, i: number) => (
              <div
                key={i}
                className={`h-1.5 w-8 rounded-full transition-all ${
                  i === interactiveStep
                    ? 'bg-teal-400'
                    : i < interactiveStep
                      ? 'bg-emerald-500'
                      : 'bg-ghost-strong'
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Question {interactiveStep + 1} of {questions.length}
          </p>
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
            className="border-edge rounded-2xl bg-card p-6"
          >
            {/* Question */}
            <div className="mb-5">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700">
                <MessageSquare className="h-5 w-5 text-white" />
              </div>
              <h3 className="mb-1 text-lg font-bold text-white">{questionText}</h3>
            </div>

            {/* Answer Input */}
            <div className="space-y-3">
              {currentQuestion?.type === 'text' ? (
                <TextareaWithVoice
                  value={currentAnswer}
                  onChange={(e) => setCurrentAnswer(e.target.value)}
                  placeholder={currentQuestion?.placeholder}
                  className="border-c-md min-h-[100px] rounded-xl bg-surface-input pr-14 text-white placeholder:text-slate-600"
                />
              ) : (
                <>
                  <div className="space-y-2">
                    {currentQuestion?.options?.map((option: string) => {
                      const selected = choiceAnswersEqual(
                        interactiveAnswers[currentQuestion.id],
                        option,
                      );
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            setInteractiveAnswers({
                              ...interactiveAnswers,
                              [currentQuestion.id]: option,
                            });
                          }}
                          className={`w-full rounded-xl border p-3.5 text-left text-sm transition-all ${
                            selected
                              ? 'border-teal-500/50 bg-teal-500/10 text-teal-300'
                              : 'border-c-edge bg-surface-input text-slate-300 hover:border-teal-500/30 hover:bg-teal-500/[0.05]'
                          }`}
                        >
                          <span className="font-medium">{option}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                    {!isFirstQuestion && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handlePreviousQuestion}
                        className="border-edge-strong hover:bg-subtle h-11 w-full rounded-2xl bg-transparent text-slate-300 sm:w-auto"
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Previous
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() => {
                        if (!currentQuestion) return;
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
                      disabled={
                        !currentQuestion ||
                        !answerLooksFilled(interactiveAnswers[currentQuestion.id])
                      }
                      className={`h-11 w-full rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 font-semibold text-primary-foreground hover:from-teal-400 hover:to-teal-300 disabled:opacity-40 ${!isFirstQuestion ? 'sm:ml-auto sm:w-auto' : ''}`}
                    >
                      {isLastQuestion ? 'See Summary' : 'Next Question'}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
              {currentQuestion?.type === 'text' && (
                <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                  {!isFirstQuestion && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handlePreviousQuestion}
                      className="border-edge-strong hover:bg-subtle h-11 w-full rounded-2xl bg-transparent text-slate-300 sm:w-auto"
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Previous
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      if (currentAnswer.trim()) {
                        setInteractiveAnswers({
                          ...interactiveAnswers,
                          [currentQuestion.id]: currentAnswer,
                        });
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
                    className={`h-11 w-full rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 font-semibold text-primary-foreground hover:from-teal-400 hover:to-teal-300 disabled:opacity-40 ${!isFirstQuestion ? 'sm:ml-auto sm:w-auto' : ''}`}
                  >
                    {isLastQuestion ? 'See Summary' : 'Next Question'}
                    <ChevronRight className="ml-1 h-4 w-4" />
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

  const generateAiRecommendations = async (childResults: ChildGameResults | null) => {
    try {
      // Check the area doc first: prefer finalised recommendations, then in-progress cached recs
      const completedDataRaw = await api.completedGrowthAreas.list(activeChildId ?? '');
      const completedDataObj = completedDataRaw as { areas?: Record<string, unknown>[] } | null;
      const existing = completedDataObj?.areas?.find(
        (a: Record<string, unknown>) => a['area_id'] === selectedArea?.id,
      );
      const existingRecs = existing
        ? (existing['recommendations'] as unknown[] | undefined)
        : undefined;
      if (Array.isArray(existingRecs) && existingRecs.length > 0) {
        setAiRecommendations(existingRecs);
        return;
      }
      const existingAiRecs = existing
        ? (existing['ai_three_month_recommendations'] as unknown[] | undefined)
        : undefined;
      if (Array.isArray(existingAiRecs) && existingAiRecs.length > 0) {
        setAiRecommendations(existingAiRecs);
        return;
      }
    } catch (err) {
      console.warn(
        '[RecommendationsPhase] Could not load cached recommendations, regenerating:',
        err,
      );
    }

    setLoadingRecommendations(true);
    try {
      const questions = areaQuestionsMap[selectedArea?.id ?? ''] ?? areaQuestions.life_ambition;
      const qaContext = questions
        .filter((q: { id: string }) => interactiveAnswers[q.id])
        .map((q: { id: string; question: string }) => {
          const ans = interactiveAnswers[q.id];
          return `Q: ${q.question.replace('{name}', String(data['name']))}\nA: ${typeof ans === 'string' ? ans : typeof ans === 'number' || typeof ans === 'boolean' ? String(ans) : ''}`;
        })
        .join('\n\n');

      const childContext = childResults
        ? (() => {
            const gr = normalizeChildGameRecommendations(childResults);
            const sug: string[] = Array.isArray(gr['suggested_activities'])
              ? (gr['suggested_activities'] as string[])
              : [];
            const strengths: string[] = Array.isArray(gr['strengths'])
              ? (gr['strengths'] as string[])
              : [];
            return `\n\nChild's game responses:\nSummary: ${typeof gr['summary'] === 'string' ? gr['summary'] : ''}\nStrengths observed: ${strengths.join(', ')}\nSuggested activities from game: ${sug.join(', ')}`;
          })()
        : '';

      const feedbackContext = feedback?.trim()
        ? `\n\nParent's feedback on suggested activities: "${feedback}"`
        : '';

      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Based on the following parent responses and child's game activity responses about "${String(data['name'])}" in the growth area "${selectedArea?.name ?? ''}", generate 5 practical 3-month recommendations that synthesize both perspectives.\n\nParent responses:\n${qaContext}${childContext}${feedbackContext}\n\nReturn ONLY a JSON object with a "recommendations" array of 5 short, actionable bullet points (1-2 sentences each) specific to the "${selectedArea?.name ?? ''}" growth area.`,
        response_json_schema: {
          type: 'object',
          properties: {
            recommendations: { type: 'array', items: { type: 'string' } },
          },
        },
      });
      const resultObj = result as Record<string, unknown>;
      const list: unknown[] =
        result && typeof result === 'object' && Array.isArray(resultObj['recommendations'])
          ? (resultObj['recommendations'] as unknown[])
          : [];
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
    const questions = areaQuestionsMap[selectedArea?.id ?? ''] ?? areaQuestions.life_ambition;
    const AreaIcon = selectedArea?.icon ?? Award;

    const sectionAnim = (delay: number) => ({
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.8, delay, ease: 'easeOut' },
    });

    return (
      <div className="space-y-6">
        <motion.div {...sectionAnim(0.1)} className="text-center">
          <div
            className={`mx-auto mb-4 h-20 w-20 rounded-2xl bg-gradient-to-br ${selectedArea?.color ?? 'from-emerald-400 to-teal-500'} flex items-center justify-center`}
          >
            <AreaIcon className="h-10 w-10 text-white" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-white">Great Insights!</h2>
          <p className="text-slate-400">
            Here's what we learned about {String(data['name'])}'s {selectedArea?.name}
          </p>
        </motion.div>

        <motion.div {...sectionAnim(0.3)} className="border-edge space-y-3 rounded-2xl bg-card p-6">
          {questions.map((q: { id: string; question: string }, i: number) => {
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
                <p className="mb-1 text-xs text-slate-500">
                  {q.question.replace('{name}', String(data['name']))}
                </p>
                <p className="text-sm font-medium text-white">
                  {typeof answer === 'string'
                    ? answer
                    : typeof answer === 'number' || typeof answer === 'boolean'
                      ? String(answer)
                      : ''}
                </p>
              </motion.div>
            );
          })}
        </motion.div>

        {selectedActivity && !childGameResults && (
          <motion.div
            {...sectionAnim(1.4)}
            className="space-y-4 rounded-2xl border border-purple-500/20 bg-card p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-purple-400">
              Your selected activity
            </p>
            <div>
              <h3 className="text-base font-bold text-white">{selectedActivity.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{selectedActivity.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="bg-ghost-light rounded-full px-2 py-0.5 text-xs text-slate-400">
                  ⏱ {selectedActivity.duration}
                </span>
                <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs capitalize text-purple-400">
                  {selectedActivity.type}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={() => setStep('parent_activity')}
                className="rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:from-purple-400 hover:to-indigo-500"
              >
                Open activity details
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('activity_selection')}
                className="border-edge-strong hover:bg-subtle rounded-2xl bg-transparent text-slate-300"
              >
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
                  onClick={() => {
                    void (async () => {
                      if (!selectedArea) return;
                      await mergeChildGameFromServer(selectedArea.id, { reopenGame: true });
                      setParentLiked(true);
                    })();
                  }}
                  className="h-11 flex-1 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 font-semibold text-primary-foreground hover:from-teal-400 hover:to-teal-300"
                >
                  Explore Child Activity
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void (async () => {
                      if (!selectedArea) return;
                      await saveCompletedGrowthArea(selectedArea, interactiveAnswers, null);
                      setStep('area_selection');
                      setParentLiked(null);
                      setChildActivitySelections([]);
                      setChildGameResults(null);
                      setShowGame(false);
                    })();
                  }}
                  className="border-edge-strong hover:bg-subtle h-11 flex-1 rounded-2xl bg-transparent text-slate-300"
                >
                  Next Growth Area
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  void handleFinishRef.current?.();
                }}
                className="h-11 w-full rounded-2xl border border-teal-500/30 bg-transparent text-teal-400 hover:bg-teal-500/10"
              >
                <ChevronRight className="mr-2 h-4 w-4" />
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
                onClick={() => {
                  void (async () => {
                    if (!selectedArea) return;
                    await mergeChildGameFromServer(selectedArea.id, { reopenGame: true });
                    setShowGame(true);
                  })();
                }}
                className="h-12 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
              >
                Present a fun game to {String(data['name'])} on the same topic
              </Button>
              <Button
                onClick={() => {
                  void (async () => {
                    if (!selectedArea) return;
                    await saveCompletedGrowthArea(selectedArea, interactiveAnswers, null);
                    setStep('area_selection');
                    setParentLiked(null);
                    setChildActivitySelections([]);
                    setChildGameResults(null);
                    setShowGame(false);
                  })();
                }}
                variant="outline"
                className="h-12 w-full rounded-2xl border-2"
              >
                Explore Later
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void handleFinishRef.current?.();
                }}
                className="h-12 w-full rounded-2xl border border-teal-500/30 bg-transparent text-teal-400 hover:bg-teal-500/10"
              >
                <ChevronRight className="mr-2 h-5 w-5" />
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
              className="rounded-3xl border border-emerald-500/20 bg-card p-6"
            >
              <ChildActivityGame
                key={selectedArea.id}
                childName={typeof data['name'] === 'string' ? data['name'] : String(data['name'])}
                areaId={selectedArea.id}
                activeChildId={activeChildId}
                selectedIds={childActivitySelections}
                onSelectedIdsChange={setChildActivitySelections}
                onComplete={async (results) => {
                  const area = selectedArea;
                  if (!area?.id) return;

                  debouncedSaveAreaProgress.cancel();

                  const child_activity = {
                    selections: Array.isArray(results.selections) ? [...results.selections] : [],
                    results: results.recommendations ?? null,
                  };

                  try {
                    await api.completedGrowthAreas.append(activeChildId ?? '', {
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
              className="rounded-3xl border border-emerald-500/20 bg-card p-6"
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
                className="mb-4 text-center"
              >
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600">
                  <Sparkles className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white">
                  Recommendations for {String(data['name'])}
                </h3>
              </motion.div>

              {/* What This Reveals */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.5, ease: 'easeOut' }}
                className="mb-4 rounded-2xl bg-surface-elevated p-4"
              >
                <h4 className="mb-2 font-semibold text-white">What This Reveals</h4>
                <p className="text-sm text-slate-400">{childGameResults?.summary ?? ''}</p>
              </motion.div>

              {/* Suggested Activities */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.9, ease: 'easeOut' }}
                className="mb-4 rounded-2xl bg-surface-elevated p-4"
              >
                <h4 className="mb-2 font-semibold text-white">Suggested Activities</h4>
                <ul className="space-y-2">
                  {suggestedActivitiesFromGameRecommendations(childGameResults).map(
                    (activity, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 1.0 + i * 0.13, ease: 'easeOut' }}
                        className="flex items-start gap-2 text-sm text-slate-400"
                      >
                        <span className="mt-1 text-emerald-500">✓</span>
                        <span>{activity}</span>
                      </motion.li>
                    ),
                  )}
                </ul>
              </motion.div>

              {/* Strengths */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 1.5, ease: 'easeOut' }}
                className="rounded-2xl bg-surface-elevated p-4"
              >
                <h4 className="mb-2 font-semibold text-white">Strengths to Encourage</h4>
                <ul className="space-y-2">
                  {(Array.isArray(childGameResults?.strengths)
                    ? childGameResults.strengths
                    : []
                  ).map((strength, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.6, delay: 1.65 + i * 0.13, ease: 'easeOut' }}
                      className="flex items-start gap-2 text-sm text-slate-400"
                    >
                      <span className="mt-1 text-emerald-500">★</span>
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
              className="rounded-3xl border border-emerald-500/15 bg-card p-6"
            >
              <h3 className="mb-3 flex items-center gap-2 font-bold text-white">
                <Target className="h-5 w-5 text-emerald-600" />
                3-Month Recommendations for {selectedArea?.name}
              </h3>

              {!aiRecommendations && !loadingRecommendations && (
                <Button
                  onClick={() => {
                    void generateAiRecommendations(childGameResults);
                  }}
                  className="h-11 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Recommendations
                </Button>
              )}

              {loadingRecommendations && (
                <div className="flex flex-col items-center justify-center gap-5 py-10">
                  <div className="relative h-16 w-16">
                    <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20" />
                    <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-emerald-500" />
                    <div
                      className="absolute inset-2 animate-spin rounded-full border-4 border-transparent border-t-teal-400"
                      style={{ animationDuration: '0.7s', animationDirection: 'reverse' }}
                    />
                  </div>
                  <div className="space-y-1 text-center">
                    <p className="text-sm font-semibold text-white">Building your 3-Month Plan</p>
                    <p className="text-xs text-slate-500">
                      Personalising recommendations for{' '}
                      {typeof data?.['name'] === 'string' ? data['name'] : ''}…
                    </p>
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
                      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                        {i + 1}
                      </span>
                      <span>{typeof rec === 'string' ? rec : ''}</span>
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
                onClick={() => {
                  void (async () => {
                    if (!selectedArea) return;
                    await saveCompletedGrowthArea(
                      selectedArea,
                      interactiveAnswers,
                      aiRecommendations,
                      { selections: childActivitySelections, results: childGameResults },
                    );
                    if (currentAreaIndex < growthAreas.length - 1) {
                      setCurrentAreaIndex(currentAreaIndex + 1);
                      setStep('area_selection');
                      setShowGame(false);
                      setChildGameResults(null);
                      setChildActivitySelections([]);
                      setAiRecommendations(null);
                      setParentLiked(null);
                    } else {
                      navigate(createPageUrl('LifePathway'), { replace: true });
                    }
                  })();
                }}
                className="h-12 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
              >
                {currentAreaIndex < growthAreas.length - 1
                  ? 'Explore More Growth Areas'
                  : 'Explore Life Journey'}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void handleFinishRef.current?.();
                }}
                className="h-12 w-full rounded-2xl border border-teal-500/30 bg-transparent text-teal-400 hover:bg-teal-500/10"
              >
                <ChevronRight className="mr-2 h-5 w-5" />
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
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-emerald-500">
          <Sparkles className="h-10 w-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-white">Ready for the Next Step!</h2>
        <p className="text-slate-400">
          Let's explore the Life Journey designed for {String(data['name'])}.
        </p>
        <Button
          onClick={() => {
            navigate(createPageUrl('LifePathway'), { replace: true });
          }}
          className="h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-8"
        >
          Continue to Life Journey
          <ChevronRight className="ml-2 h-5 w-5" />
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
