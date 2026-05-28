import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '@/navigation';
import { debounce } from 'lodash';
import { Button } from '@/components/ui/Button';
import TextareaWithVoice from '@/components/shared/TextareaWithVoice';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';
import ChildActivityGame, { normalizeChildGameRecommendations } from './ChildActivityGame';
import { useSlideUp } from '@/lib/animations';

// ── types ─────────────────────────────────────────────────────────────────────

interface AreaDef {
  id: string;
  name: string;
  emoji: string;
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

const growthAreas: AreaDef[] = [
  { id: 'life_ambition', name: 'Life Ambition', emoji: '🚀', color: 'bg-purple-500', description: 'Discovering purpose and future goals' },
  { id: 'self_care', name: 'Self Care', emoji: '❤️', color: 'bg-rose-500', description: 'Building healthy habits and emotional wellness' },
  { id: 'critical_thinking', name: 'Critical Thinking', emoji: '🧠', color: 'bg-blue-500', description: 'Problem solving and analytical skills' },
  { id: 'creativity', name: 'Creativity', emoji: '🎨', color: 'bg-amber-500', description: 'Imagination and creative expression' },
  { id: 'physical_wellness', name: 'Physical Wellness', emoji: '💪', color: 'bg-emerald-500', description: 'Body awareness and physical health' },
  { id: 'social_skills', name: 'Social Skills', emoji: '💬', color: 'bg-violet-500', description: 'Communication and relationship building' },
];

const sampleActivities: Record<string, ActivityDef[]> = {
  life_ambition: [
    { title: 'Dream Board Creation', description: 'Create a visual board of future dreams and goals', duration: '20 mins', type: 'creative' },
    { title: 'Career Explorer Quiz', description: 'Fun quiz to discover interests and potential paths', duration: '10 mins', type: 'game' },
    { title: 'Future Self Letter', description: 'Write a letter to yourself 10 years from now', duration: '15 mins', type: 'reflection' },
  ],
  self_care: [
    { title: 'Emotion Detective', description: 'Identify and name different emotions through scenarios', duration: '10 mins', type: 'game' },
    { title: 'Mindful Breathing Adventure', description: 'Learn calming techniques through a fun story', duration: '8 mins', type: 'activity' },
    { title: 'Gratitude Treasure Hunt', description: 'Find 5 things to be grateful for today', duration: '10 mins', type: 'challenge' },
  ],
  critical_thinking: [
    { title: 'Mystery Solver', description: 'Solve fun logic puzzles and riddles', duration: '15 mins', type: 'game' },
    { title: 'What Would You Do?', description: 'Decision-making scenarios with multiple outcomes', duration: '12 mins', type: 'interactive' },
    { title: 'Pattern Detective', description: 'Find patterns and predict what comes next', duration: '10 mins', type: 'puzzle' },
  ],
  creativity: [
    { title: 'Story Remix', description: 'Take a familiar story and give it a creative twist', duration: '15 mins', type: 'creative' },
    { title: 'Invention Challenge', description: 'Design a solution for an everyday problem', duration: '20 mins', type: 'challenge' },
    { title: 'Music & Mood', description: 'Create sounds that match different emotions', duration: '10 mins', type: 'interactive' },
  ],
  physical_wellness: [
    { title: 'Body Scan Adventure', description: 'Fun guided body awareness activity', duration: '8 mins', type: 'activity' },
    { title: 'Movement Challenge', description: 'Quick fun physical challenges to try', duration: '10 mins', type: 'game' },
    { title: 'Healthy Habits Hero', description: 'Track and celebrate healthy daily habits', duration: '5 mins', type: 'tracker' },
  ],
  social_skills: [
    { title: 'Conversation Starter', description: 'Practice starting and maintaining conversations', duration: '10 mins', type: 'interactive' },
    { title: 'Empathy Explorer', description: 'Understand how others might feel in situations', duration: '12 mins', type: 'game' },
    { title: 'Teamwork Challenge', description: 'Activities that require collaboration', duration: '15 mins', type: 'challenge' },
  ],
};

type AreaQuestion = { id: string; question: string; type: 'text' | 'choice'; options?: string[]; placeholder?: string; followUp: string };

const areaQuestions: Record<string, AreaQuestion[]> = {
  life_ambition: [
    { id: 'dream_career', question: 'What does {name} dream of becoming when he/she grows up?', type: 'text', placeholder: 'e.g., Doctor, Teacher, Astronaut, Artist...', followUp: "That's wonderful! Dreams are the seeds of future achievements." },
    { id: 'interests_alignment', question: 'Are his/her interests & hobbies in line with his/her dream?', type: 'choice', options: ['Yes', 'No', 'Not Sure at this point'], followUp: 'Understanding this helps us guide their journey better.' },
    { id: 'support_type', question: 'What kind of support are you willing to give to support his/her dream at this point?', type: 'choice', options: ['In every aspect', 'Financially', 'Moral support', 'Not sure at this point'], followUp: 'Your support is crucial in nurturing their aspirations.' },
    { id: 'explore_options', question: 'Do you think {name} should explore other career options as well?', type: 'choice', options: ['Yes', 'No', 'Not sure at this point'], followUp: 'Exploration helps children discover their true passions.' },
    { id: 'revisit_timeline', question: "When do you want to re-visit {name}'s life aspirations?", type: 'choice', options: ['After 1 year', 'After 3 years', 'After 5 years', 'Not sure at this point'], followUp: 'Regular check-ins help keep dreams aligned with growth.' },
  ],
  self_care: [
    { id: 'emotional_awareness', question: 'How well does {name} recognize and name their own emotions?', type: 'choice', options: ['Very well', 'Somewhat', 'Needs support', 'Not sure'], followUp: 'Emotional awareness is the first step to self-care.' },
    { id: 'stress_response', question: 'How does {name} typically respond when stressed or overwhelmed?', type: 'text', placeholder: 'e.g., withdraws, cries, talks about it...', followUp: 'Understanding stress responses helps us build better coping strategies.' },
    { id: 'sleep_habits', question: "How would you describe {name}'s sleep habits?", type: 'choice', options: ['Very consistent', 'Somewhat consistent', 'Irregular', 'Problematic'], followUp: 'Good sleep is fundamental to emotional and physical well-being.' },
    { id: 'self_soothing', question: 'Does {name} have any self-soothing or relaxation activities?', type: 'choice', options: ['Yes, several', 'One or two', 'Not really', 'Not sure'], followUp: 'Self-soothing skills are important tools for lifelong wellness.' },
    { id: 'self_care_goals', question: 'What self-care habit would you most like {name} to develop?', type: 'text', placeholder: 'e.g., morning routine, mindfulness, journaling...', followUp: 'Great goal! Small daily habits create lasting change.' },
  ],
  critical_thinking: [
    { id: 'problem_approach', question: "How does {name} typically approach a problem they can't solve immediately?", type: 'choice', options: ['Tries different strategies', 'Asks for help', 'Gets frustrated', 'Gives up'], followUp: 'Problem-solving persistence is a key thinking skill.' },
    { id: 'curiosity_level', question: 'How curious is {name} about how things work?', type: 'choice', options: ['Very curious', 'Moderately curious', 'Not particularly curious', 'Depends on the topic'], followUp: 'Curiosity is the engine of critical thinking!' },
    { id: 'decision_making', question: 'Can {name} make decisions independently, weighing pros and cons?', type: 'choice', options: ['Yes, quite well', 'Sometimes', 'Rarely', 'Not yet'], followUp: 'Decision-making is a skill that grows with practice.' },
    { id: 'question_asking', question: "Does {name} ask a lot of 'why' or 'how' questions?", type: 'choice', options: ['All the time', 'Often', 'Occasionally', 'Rarely'], followUp: 'Asking questions is a sign of an active, thinking mind.' },
    { id: 'thinking_goals', question: 'What critical thinking skill would you most like {name} to strengthen?', type: 'text', placeholder: 'e.g., logical reasoning, creative solutions, evaluating information...', followUp: "Excellent focus area! We'll build activities around this." },
  ],
  creativity: [
    { id: 'creative_outlets', question: 'What creative activities does {name} enjoy most?', type: 'text', placeholder: 'e.g., drawing, storytelling, building, music...', followUp: 'Wonderful! Creative outlets are essential for expression and growth.' },
    { id: 'imagination_use', question: 'How often does {name} engage in imaginative play or storytelling?', type: 'choice', options: ['Daily', 'Several times a week', 'Occasionally', 'Rarely'], followUp: 'Imagination is the birthplace of all creativity.' },
    { id: 'creative_confidence', question: 'Does {name} feel confident sharing their creative work with others?', type: 'choice', options: ['Very confident', 'Somewhat confident', 'Hesitant', 'Avoids sharing'], followUp: 'Building creative confidence takes a supportive environment.' },
    { id: 'open_ended_play', question: 'Does {name} prefer structured activities or open-ended creative play?', type: 'choice', options: ['Prefers structured', 'Prefers open-ended', 'Enjoys both equally', 'Not sure'], followUp: 'Both styles have value — balance is key.' },
    { id: 'creativity_goals', question: "How would you like to nurture {name}'s creativity in the next 3 months?", type: 'text', placeholder: 'e.g., art classes, music lessons, creative writing...', followUp: "We'll use this to craft the perfect creative missions!" },
  ],
  physical_wellness: [
    { id: 'activity_level', question: 'How physically active is {name} on a typical day?', type: 'choice', options: ['Very active', 'Moderately active', 'Somewhat sedentary', 'Very sedentary'], followUp: 'Physical activity is a cornerstone of holistic wellness.' },
    { id: 'preferred_activities', question: 'What physical activities does {name} enjoy most?', type: 'text', placeholder: 'e.g., swimming, cycling, football, dancing...', followUp: 'Linking movement to enjoyment makes it sustainable.' },
    { id: 'body_awareness', question: "Is {name} aware of their body's signals (hunger, tiredness, discomfort)?", type: 'choice', options: ['Very aware', 'Somewhat aware', 'Not very aware', 'Not sure'], followUp: 'Body awareness is the foundation of physical self-care.' },
    { id: 'screen_time', question: 'How much screen time does {name} typically have per day?', type: 'choice', options: ['Less than 1 hour', '1-2 hours', '3-4 hours', 'More than 4 hours'], followUp: 'Balancing screen time with physical activity is a key wellness goal.' },
    { id: 'wellness_goals', question: 'What physical wellness goal would you set for {name} over the next 3 months?', type: 'text', placeholder: 'e.g., learn to swim, improve stamina, develop a sport...', followUp: 'A clear physical goal gives movement real purpose!' },
  ],
  social_skills: [
    { id: 'friendship_quality', question: "How would you describe {name}'s friendships?", type: 'choice', options: ['Has many close friends', 'Has a few close friends', 'Mostly acquaintances', 'Struggles to connect'], followUp: 'The quality of friendships matters more than quantity.' },
    { id: 'conflict_handling', question: 'How does {name} handle disagreements or conflicts with peers?', type: 'choice', options: ['Resolves calmly', 'Needs some guidance', 'Gets upset easily', 'Avoids conflict entirely'], followUp: 'Healthy conflict resolution is a powerful life skill.' },
    { id: 'empathy_level', question: "Does {name} show empathy and concern for others' feelings?", type: 'choice', options: ['Consistently', 'Often', 'Sometimes', 'Rarely'], followUp: 'Empathy is the foundation of all meaningful relationships.' },
    { id: 'group_participation', question: 'How does {name} behave in group settings (school, teams, clubs)?', type: 'choice', options: ['Natural leader', 'Active participant', 'Observer', 'Withdraws'], followUp: 'Understanding group dynamics helps us tailor the right activities.' },
    { id: 'social_goals', question: 'What social skill would you most like {name} to build in the next 3 months?', type: 'text', placeholder: 'e.g., starting conversations, teamwork, expressing feelings...', followUp: 'Wonderful focus! Social skills open doors throughout life.' },
  ],
};

function answerLooksFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function buildAreaProgressPayload(args: {
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
  const { area, step, selectedActivity, parentLiked, wantChildActivity, feedback,
    interactiveStep, interactiveAnswers, currentAnswer, generatedActivity, showGame,
    childActivitySelections, aiRecommendations, childGameResults } = args;
  const qs = areaQuestions[area.id] ?? areaQuestions['life_ambition']!;
  const cq = step === 'interactive_activity' ? qs[interactiveStep] : null;
  const interactive_draft = cq?.type === 'text' ? { question_id: cq.id, text: currentAnswer ?? '' } : null;

  return {
    area_id: area.id, area_name: area.name, area_color: area.color,
    answers: interactiveAnswers || {}, recommendations: null, status: 'in_progress', step,
    selected_activity: selectedActivity, parent_liked: parentLiked, want_child_activity: wantChildActivity,
    feedback, interactive_step: interactiveStep, interactive_answers: interactiveAnswers,
    interactive_draft, generated_activity: generatedActivity, show_game: showGame,
    child_activity: childGameResults
      ? { selections: Array.isArray(childActivitySelections) ? childActivitySelections : [], results: childGameResults }
      : null,
    child_activity_selections: Array.isArray(childActivitySelections) ? childActivitySelections : [],
    ai_three_month_recommendations:
      Array.isArray(aiRecommendations) && aiRecommendations.length > 0 ? aiRecommendations : null,
  };
}

function answersForArea(areaId: string, rawAnswers: unknown): Record<string, unknown> {
  const qs = areaQuestions[areaId] ?? areaQuestions['life_ambition']!;
  const allowed = new Set(qs.map((q) => q.id));
  const src = rawAnswers && typeof rawAnswers === 'object' ? (rawAnswers as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) { if (allowed.has(k)) out[k] = v; }
  return out;
}

function choiceAnswersEqual(saved: unknown, option: string): boolean {
  if (saved === undefined || saved === null) return false;
  const s = typeof saved === 'string' ? saved : typeof saved === 'number' || typeof saved === 'boolean' ? String(saved) : '';
  return s.trim() === String(option).trim();
}

function extractAnswersFromCompletedGrowthAreas(completedList: unknown[], areaId: string): Record<string, unknown> {
  if (!Array.isArray(completedList)) return {};
  const entry = completedList.find((e) => e && typeof e === 'object' && (e as Record<string, unknown>)['area_id'] === areaId) as Record<string, unknown> | undefined;
  const ans = entry?.['answers'];
  return ans && typeof ans === 'object' ? { ...(ans as Record<string, unknown>) } : {};
}

function extractAiRecommendationsFromCompleted(completedList: unknown[], areaId: string): unknown[] | null {
  if (!Array.isArray(completedList)) return null;
  const entry = completedList.find((e) => e && typeof e === 'object' && (e as Record<string, unknown>)['area_id'] === areaId) as Record<string, unknown> | undefined;
  const recs = entry?.['recommendations'];
  if (!Array.isArray(recs) || recs.length === 0) return null;
  return recs as unknown[];
}

function deriveInteractiveUiFromProgress(
  area: AreaDef | null,
  p: Record<string, unknown>,
  completedGrowthAreas: unknown[] = [],
): { mergedAnswers: Record<string, unknown>; step: string; interactiveStep: number; currentAnswer: string } {
  if (!area) return { mergedAnswers: {}, step: 'interactive_activity', interactiveStep: 0, currentAnswer: '' };

  const qs = areaQuestions[area.id] ?? areaQuestions['life_ambition']!;
  const rawProgress = p['interactive_answers'] && typeof p['interactive_answers'] === 'object'
    ? { ...(p['interactive_answers'] as Record<string, unknown>) } : {};
  const fromCompleted = extractAnswersFromCompletedGrowthAreas(completedGrowthAreas, area.id);
  const mergedAnswers = answersForArea(area.id, { ...fromCompleted, ...rawProgress });

  const areaMatchesPersisted = p['area_id'] === area.id;
  const stepVal = typeof p['step'] === 'string' ? p['step'] : 'intro';
  const completedHasArea = Array.isArray(completedGrowthAreas)
    ? completedGrowthAreas.some((e) => e && typeof e === 'object' && (e as Record<string, unknown>)['area_id'] === area.id)
    : false;
  const hasAnswersForArea = qs.some((q) => answerLooksFilled(mergedAnswers[q.id]));
  const blobBelongsToArea = areaMatchesPersisted || hasAnswersForArea || completedHasArea;

  if (!blobBelongsToArea) return { mergedAnswers: {}, step: 'interactive_activity', interactiveStep: 0, currentAnswer: '' };

  const effectiveStep =
    areaMatchesPersisted && stepVal === 'activity_summary' ? 'activity_summary'
    : areaMatchesPersisted && stepVal === 'interactive_activity' ? 'interactive_activity'
    : hasAnswersForArea ? 'interactive_activity'
    : stepVal === 'activity_summary' ? 'activity_summary' : 'interactive_activity';

  if (effectiveStep === 'activity_summary') {
    return { mergedAnswers, step: 'activity_summary', interactiveStep: Math.max(0, qs.length - 1), currentAnswer: '' };
  }

  if (!qs.length) return { mergedAnswers, step: 'interactive_activity', interactiveStep: typeof p['interactive_step'] === 'number' ? p['interactive_step'] : 0, currentAnswer: '' };

  const firstIncomplete = qs.findIndex((q) => !answerLooksFilled(mergedAnswers[q.id]));
  if (firstIncomplete === -1) return { mergedAnswers, step: 'activity_summary', interactiveStep: Math.max(0, qs.length - 1), currentAnswer: '' };

  let interactiveStepIx = firstIncomplete;
  if (areaMatchesPersisted && typeof p.interactive_step === 'number' && qs.length > 0) {
    interactiveStepIx = Math.max(0, Math.min(qs.length - 1, p.interactive_step));
  }

  const cq = qs[interactiveStepIx];
  const draft = p['interactive_draft'] && typeof p['interactive_draft'] === 'object' ? (p['interactive_draft'] as Record<string, unknown>) : null;
  let currentAnswer = '';
  const useDraft = areaMatchesPersisted && cq?.type === 'text' && draft?.['question_id'] === cq?.id && typeof draft['text'] === 'string';
  if (useDraft && draft) { currentAnswer = draft['text'] as string; }
  else if (cq?.type === 'text' && mergedAnswers[cq.id] != null && String(mergedAnswers[cq.id]).trim() !== '') { currentAnswer = String(mergedAnswers[cq.id]); }

  return { mergedAnswers, step: 'interactive_activity', interactiveStep: interactiveStepIx, currentAnswer };
}

function applyTileEntryInteractivePreference(
  area: AreaDef,
  d: { mergedAnswers: Record<string, unknown>; step: string; interactiveStep: number; currentAnswer: string },
): { step: string; interactiveStep: number; currentAnswer: string } {
  const qs = areaQuestions[area.id] ?? areaQuestions['life_ambition']!;
  const anyFilled = qs.some((q) => answerLooksFilled(d.mergedAnswers[q.id]));
  if (d.step === 'activity_summary' && anyFilled) {
    const cq = qs[0];
    const caUse = cq?.type === 'text' && answerLooksFilled(d.mergedAnswers[cq?.id ?? '']) ? String(d.mergedAnswers[cq.id]) : '';
    return { step: 'interactive_activity', interactiveStep: 0, currentAnswer: caUse };
  }
  return { step: d.step, interactiveStep: d.interactiveStep, currentAnswer: d.currentAnswer };
}

// ── Shared state interface passed to sub-screens ──────────────────────────────

interface PhaseState {
  data: Record<string, unknown>;
  profile: Record<string, unknown>;
  activeChildId?: string;
  step: string;
  setStep: (s: string) => void;
  selectedArea: AreaDef | null;
  setSelectedArea: (a: AreaDef | null) => void;
  selectedActivity: ActivityDef | null;
  setSelectedActivity: (a: ActivityDef | null) => void;
  parentLiked: boolean | null;
  setParentLiked: (v: boolean | null) => void;
  wantChildActivity: boolean | null;
  setWantChildActivity: (v: boolean | null) => void;
  feedback: string;
  setFeedback: (v: string) => void;
  currentAreaIndex: number;
  setCurrentAreaIndex: (i: number) => void;
  interactiveStep: number;
  setInteractiveStep: (i: number) => void;
  interactiveAnswers: Record<string, unknown>;
  setInteractiveAnswers: (a: Record<string, unknown>) => void;
  currentAnswer: string;
  setCurrentAnswer: (s: string) => void;
  generatedActivity: unknown;
  setGeneratedActivity: (v: unknown) => void;
  showGame: boolean;
  setShowGame: (v: boolean) => void;
  childGameResults: ChildGameResults | null;
  setChildGameResults: (r: ChildGameResults | null) => void;
  childActivitySelections: string[];
  setChildActivitySelections: (s: string[]) => void;
  aiRecommendations: unknown[] | null;
  setAiRecommendations: (r: unknown[] | null) => void;
  loadingRecommendations: boolean;
  setLoadingRecommendations: (v: boolean) => void;
  qaAnimKey: number;
  debouncedSaveAreaProgress: ReturnType<typeof debounce>;
  saveCompletedGrowthArea: (
    area: AreaDef,
    answers: Record<string, unknown>,
    recs: unknown[] | null,
    childActivity?: { selections: string[]; results: ChildGameResults },
  ) => Promise<void>;
  mergeChildGameFromServer: (areaId: string, opts?: { reopenGame?: boolean }) => Promise<void>;
  generateAiRecommendations: (childResults: ChildGameResults | null) => Promise<void>;
  handleFinishRef: React.MutableRefObject<(() => Promise<void>) | null>;
  navigation: StackNavigationProp<RootStackParamList>;
}

// ── Sub-screen components (each can safely call hooks) ────────────────────────

function IntroScreen({ ps }: { ps: PhaseState }) {
  const headerAnim = useSlideUp(0.1, 1000);
  const profileAnim = useSlideUp(0.8, 1000);
  const exploreAnim = useSlideUp(1.8, 1000);
  const { data, profile, setStep, navigation } = ps;

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      <Animated.View style={headerAnim} className="items-center mb-8">
        <View className="mb-6 h-24 w-24 items-center justify-center rounded-3xl bg-teal-500">
          <Text className="text-4xl">✨</Text>
        </View>
        <Text className="mb-2 text-center text-2xl font-bold text-white">Your Personalized Journey</Text>
        <Text className="text-center text-slate-400">
          Here's what we've discovered about {String(data['name'])}
        </Text>
      </Animated.View>

      {profile && (
        <Animated.View style={profileAnim} className="mb-8 rounded-2xl bg-card border border-white/10 p-6">
          <View className="mb-4 flex-row items-start gap-4">
            <View className="h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-500">
              <Text className="text-xl">⭐</Text>
            </View>
            <View>
              <Text className="text-lg font-bold text-white">{String(data['name'])}'s Profile</Text>
              <Text className="text-sm font-medium text-teal-400">
                {(() => { const pt = typeof profile['personality_type'] === 'string' ? profile['personality_type'] : ''; return pt.split(' - ')[1] ?? pt; })()}
              </Text>
            </View>
          </View>
          <Text className="mb-5 text-sm leading-relaxed text-slate-400">
            {typeof profile['summary'] === 'string' ? profile['summary'] : ''}
          </Text>
          <View>
            <Text className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-600">Emerging Strengths</Text>
            {(Array.isArray(profile['top_strengths']) ? (profile['top_strengths'] as unknown[]) : []).map((strength, index) => (
              <View key={String(strength)} className="flex-row items-start gap-3 rounded-xl bg-surface-input p-3 border border-white/5 mb-2">
                <View className="h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
                  <Text className="text-xs font-bold text-amber-400">{index + 1}</Text>
                </View>
                <Text className="text-sm font-semibold text-white">{String(strength)}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      <Animated.View style={exploreAnim} className="rounded-2xl border border-purple-500/20 bg-card p-6">
        <View className="items-center">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-purple-500 mb-4">
            <Text className="text-2xl">🧭</Text>
          </View>
          <Text className="text-center text-lg font-bold text-white mb-2">
            Do you want to explore the specific growth areas for {String(data['name'])} to become their best version?
          </Text>
          <Text className="text-center text-sm text-slate-400 mb-6">
            Discover personalized activities to help {String(data['name'])} develop key life skills
          </Text>
          <Button onPress={() => setStep('area_selection')} className="h-12 w-full rounded-2xl bg-purple-500 items-center justify-center mb-3">
            <Text className="font-semibold text-white">Continue Now</Text>
          </Button>
          <Button onPress={() => navigation.navigate('Main' as never)} className="h-12 w-full rounded-2xl border border-white/10 bg-transparent items-center justify-center">
            <Text className="text-slate-300">Catch Up Later</Text>
          </Button>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

function AreaSelectionScreen({ ps }: { ps: PhaseState }) {
  const headerAnim = useSlideUp(0.5, 1000);
  const { data, setStep, setSelectedArea, setCurrentAreaIndex, selectedArea, aiRecommendations,
    setInteractiveAnswers, setInteractiveStep, setCurrentAnswer, setAiRecommendations,
    setSelectedActivity, setParentLiked, setWantChildActivity, setFeedback, setGeneratedActivity,
    setShowGame, setChildGameResults, setChildActivitySelections, debouncedSaveAreaProgress, activeChildId } = ps;

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      <Animated.View style={headerAnim} className="items-center mb-6">
        <Text className="mb-2 text-center text-2xl font-bold text-white">Growth Areas</Text>
        <Text className="text-center text-slate-400">Choose an area to explore for {String(data['name'])}</Text>
      </Animated.View>

      <View className="flex-row flex-wrap gap-3 justify-between">
        {growthAreas.map((area, i) => (
          <Pressable
            key={area.id}
            onPress={() => {
              void (async () => {
                debouncedSaveAreaProgress.flush?.();
                setSelectedArea(area);
                setCurrentAreaIndex(i);
                try {
                  const completedDataRaw = await api.completedGrowthAreas.list(activeChildId ?? '');
                  const completedDataObj = completedDataRaw as { areas?: Record<string, unknown>[] } | null;
                  const allDocs: Record<string, unknown>[] = Array.isArray(completedDataObj?.areas) ? completedDataObj.areas : [];
                  const p: Record<string, unknown> =
                    allDocs.find((a) => a['area_id'] === area.id && a['status'] === 'in_progress') ??
                    allDocs.find((a) => a['area_id'] === area.id) ?? {};
                  const isInProgress = p.status === 'in_progress';

                  const d = deriveInteractiveUiFromProgress(area, p, allDocs);
                  const nav = applyTileEntryInteractivePreference(area, d);
                  setInteractiveAnswers(d.mergedAnswers);
                  setInteractiveStep(nav.interactiveStep);
                  setCurrentAnswer(nav.currentAnswer);
                  setStep(nav.step);

                  const isSameArea = area.id === selectedArea?.id;
                  const completedDocs = allDocs.filter((a: Record<string, unknown>) => a['status'] === 'completed' || !a['status']);
                  const dbRecs = Array.isArray(p.ai_three_month_recommendations) && p.ai_three_month_recommendations.length > 0
                    ? p.ai_three_month_recommendations : extractAiRecommendationsFromCompleted(completedDocs, area.id);
                  const airMerged = Array.isArray(dbRecs) && dbRecs.length > 0 ? dbRecs
                    : isSameArea && Array.isArray(aiRecommendations) && aiRecommendations.length > 0 ? aiRecommendations : null;
                  setAiRecommendations(airMerged);

                  if (isInProgress) {
                    if (p['selected_activity']) setSelectedActivity(p['selected_activity'] as ActivityDef); else setSelectedActivity(null);
                    if (p['parent_liked'] != null) setParentLiked(p['parent_liked'] as boolean);
                    if (p['want_child_activity'] != null) setWantChildActivity(p['want_child_activity'] as boolean);
                    if (typeof p['feedback'] === 'string') setFeedback(p['feedback']);
                    if (p['generated_activity']) setGeneratedActivity(p['generated_activity']); else setGeneratedActivity(null);
                    if (typeof p['show_game'] === 'boolean') setShowGame(p['show_game']);
                    const ca2 = p['child_activity'] as | { selections?: unknown; results?: ChildGameResults } | null | undefined;
                    if (ca2) {
                      setChildActivitySelections(Array.isArray(ca2.selections) ? (ca2.selections as string[]) : []);
                      if (ca2.results && nav.step === 'activity_summary') { setChildGameResults(ca2.results); setShowGame(false); setParentLiked(true); }
                    } else {
                      setChildActivitySelections(Array.isArray(p['child_activity_selections']) ? (p['child_activity_selections'] as string[]) : []);
                    }
                    return;
                  }

                  setSelectedActivity(null); setParentLiked(null); setChildGameResults(null); setShowGame(false);
                  setGeneratedActivity(null); setWantChildActivity(null); setFeedback('');
                  const ca3 = p['child_activity'] as | { selections?: unknown } | null | undefined;
                  if (ca3) { setChildActivitySelections(Array.isArray(ca3.selections) ? (ca3.selections as string[]) : []); }
                  else { setChildActivitySelections(Array.isArray(p['child_activity_selections']) ? (p['child_activity_selections'] as string[]) : []); }
                } catch (err) {
                  console.warn('[RecommendationsPhase] Game load failed:', err);
                  setInteractiveStep(0); setInteractiveAnswers({}); setCurrentAnswer('');
                  setParentLiked(null); setChildGameResults(null); setChildActivitySelections([]);
                  setShowGame(false); setSelectedActivity(null); setGeneratedActivity(null);
                  setWantChildActivity(null); setFeedback(''); setStep('interactive_activity');
                }
              })();
            }}
            className="rounded-2xl bg-card border border-white/10 p-4 mb-1"
            style={{ width: '47%' }}
            android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
          >
            <View className={`h-11 w-11 rounded-xl ${area.color} mb-3 items-center justify-center`}>
              <Text className="text-lg">{area.emoji}</Text>
            </View>
            <Text className="text-sm font-semibold text-white">{area.name}</Text>
            <Text className="mt-1 text-xs text-slate-500">{area.description}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function ActivitySelectionScreen({ ps }: { ps: PhaseState }) {
  const headerAnim = useSlideUp(0.1, 1000);
  const { data, setStep, selectedArea, selectedActivity, setSelectedActivity } = ps;
  const activities = sampleActivities[selectedArea?.id ?? ''] ?? [];

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      <Animated.View style={headerAnim} className="items-center mb-6">
        <View className={`mx-auto h-16 w-16 rounded-2xl ${selectedArea?.color ?? 'bg-teal-500'} mb-4 items-center justify-center`}>
          <Text className="text-2xl">{selectedArea?.emoji}</Text>
        </View>
        <Text className="mb-2 text-center text-2xl font-bold text-white">{selectedArea?.name}</Text>
        <Text className="text-center text-slate-400">Choose an activity to try with {String(data['name'])}</Text>
      </Animated.View>

      <View>
        {activities.map((activity) => (
          <Pressable
            key={activity.title}
            onPress={() => { setSelectedActivity(activity); setStep('parent_activity'); }}
            className={`w-full rounded-2xl border p-4 mb-3 ${selectedActivity?.title === activity.title ? 'border-purple-500/50 bg-purple-500/10' : 'border-white/10 bg-card'}`}
            android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="text-sm font-semibold text-white">{activity.title}</Text>
                <Text className="mt-1 text-xs text-slate-500">{activity.description}</Text>
                <View className="mt-2 flex-row gap-2">
                  <View className="rounded-full bg-white/10 px-2 py-0.5">
                    <Text className="text-xs text-slate-400">⏱ {activity.duration}</Text>
                  </View>
                  <View className="rounded-full bg-purple-500/15 px-2 py-0.5">
                    <Text className="text-xs capitalize text-purple-400">{activity.type}</Text>
                  </View>
                </View>
              </View>
              <Text className="text-slate-600 ml-2 text-lg">›</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={() => setStep('area_selection')} className="items-center py-2">
        <Text className="text-slate-500">← Back to Growth Areas</Text>
      </Pressable>
    </ScrollView>
  );
}

function ParentActivityScreen({ ps }: { ps: PhaseState }) {
  const headerAnim = useSlideUp(0.1, 1000);
  const cardAnim = useSlideUp(0.8, 1000);
  const { selectedArea, selectedActivity, setParentLiked, setStep } = ps;

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      <Animated.View style={headerAnim} className={`${selectedArea?.color ?? 'bg-teal-500'} rounded-2xl p-6 mb-6`}>
        <View className="items-center">
          <Text className="text-4xl mb-3">🏆</Text>
          <Text className="text-center text-xl font-bold text-white">{selectedActivity?.title}</Text>
          <Text className="text-center text-sm text-white/80 mt-1">{selectedActivity?.description}</Text>
          <View className="rounded-full bg-white/20 px-3 py-1 mt-3">
            <Text className="text-xs text-white">⏱ {selectedActivity?.duration}</Text>
          </View>
        </View>
      </Animated.View>

      <Animated.View style={cardAnim} className="rounded-2xl border border-white/10 bg-card p-6 mb-6">
        <Text className="text-center text-sm font-bold text-white mb-5">Did you like this activity suggestion?</Text>
        <View className="flex-row justify-center gap-4">
          <Button onPress={() => { setParentLiked(true); setStep('child_activity_prompt'); }} className="h-12 rounded-2xl bg-emerald-500 px-8 items-center justify-center">
            <Text className="font-semibold text-white">Yes, I like it!</Text>
          </Button>
          <Button onPress={() => { setParentLiked(false); setStep('feedback'); }} className="h-12 rounded-2xl border border-white/10 bg-transparent px-8 items-center justify-center">
            <Text className="text-slate-300">Not quite</Text>
          </Button>
        </View>
      </Animated.View>

      <Pressable onPress={() => setStep('activity_selection')} className="items-center py-2">
        <Text className="text-slate-500">← Choose Different Activity</Text>
      </Pressable>
    </ScrollView>
  );
}

function FeedbackScreen({ ps }: { ps: PhaseState }) {
  const headerAnim = useSlideUp(0.1, 1000);
  const cardAnim = useSlideUp(0.8, 1000);
  const { data, feedback, setFeedback, setStep, debouncedSaveAreaProgress } = ps;

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      <Animated.View style={headerAnim} className="items-center mb-6">
        <Text className="mb-2 text-center text-2xl font-bold text-white">We'd love your feedback</Text>
        <Text className="text-center text-slate-400">What kind of activity would you like for {String(data['name'])}?</Text>
      </Animated.View>

      <Animated.View style={cardAnim} className="rounded-2xl border border-white/10 bg-card p-6">
        <TextareaWithVoice
          placeholder="Tell us what you're looking for... (e.g., more interactive, shorter duration, different topic)"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="min-h-[120px] rounded-xl bg-surface-input text-white p-3 border border-white/10 mb-4"
          placeholderTextColor="#475569"
        />
        <View className="flex-row justify-end gap-3">
          <Button onPress={() => setStep('activity_selection')} className="rounded-2xl border border-white/10 bg-transparent px-4 py-2 items-center justify-center">
            <Text className="text-slate-300">Go Back</Text>
          </Button>
          <Button onPress={() => { debouncedSaveAreaProgress.flush?.(); setStep('activity_selection'); }} className="rounded-2xl bg-purple-500 px-4 py-2 items-center justify-center">
            <Text className="text-white font-medium">Submit & Try Another</Text>
          </Button>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

function ChildActivityPromptScreen({ ps }: { ps: PhaseState }) {
  const cardAnim = useSlideUp(0.1, 1000);
  const { data, selectedArea, setStep, navigation } = ps;

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      <Animated.View style={cardAnim} className="rounded-2xl border border-emerald-500/20 bg-card p-6">
        <View className="items-center">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 mb-4">
            <Text className="text-2xl">⚡</Text>
          </View>
          <Text className="text-center text-lg font-bold text-white mb-2">
            Do you want {String(data['name'])} to take a fun activity on {selectedArea?.name}?
          </Text>
          <Text className="text-center text-sm text-slate-400 mb-6">
            {String(data['name'])} can complete this as a game on their device
          </Text>
          <Button onPress={() => setStep('results')} className="h-12 w-full rounded-2xl bg-emerald-500 items-center justify-center mb-3">
            <Text className="font-semibold text-white">Yes, Start Activity</Text>
          </Button>
          <Button onPress={() => navigation.navigate('Main' as never)} className="h-12 w-full rounded-2xl border border-white/10 bg-transparent items-center justify-center">
            <Text className="text-slate-300">Catch Up Later</Text>
          </Button>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

function ResultsPreviewScreen({ ps }: { ps: PhaseState }) {
  const headerAnim = useSlideUp(0.1, 1000);
  const cardAnim = useSlideUp(0.8, 1000);
  const ctaAnim = useSlideUp(1.6, 1000);
  const { selectedArea } = ps;

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      <Animated.View style={headerAnim} className="items-center mb-6">
        <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-emerald-500">
          <Text className="text-4xl">🏆</Text>
        </View>
        <Text className="mb-2 text-center text-2xl font-bold text-white">Activity Results Preview</Text>
      </Animated.View>

      <Animated.View style={cardAnim} className="rounded-2xl border border-white/10 bg-card p-6 mb-6">
        <View className="items-center mb-4">
          <Text className="mb-2 text-xs uppercase tracking-widest text-slate-500">{selectedArea?.name} Quotient</Text>
          <Text className="text-5xl font-bold text-teal-400">--</Text>
          <Text className="mt-1 text-sm text-slate-600">Score will appear after activity</Text>
        </View>
        <View className="border-t border-white/5 pt-4">
          <Text className="mb-3 text-sm font-semibold text-white">Personalized Recommendations</Text>
          {[1, 2, 3].map((i) => (
            <View key={i} className="flex-row items-center gap-3 rounded-xl bg-surface-input p-3 mb-2">
              <View className="h-8 w-8 rounded-lg bg-white/10" />
              <View className="flex-1">
                <View className="h-3 w-3/4 rounded bg-white/10 mb-2" />
                <View className="h-2.5 w-1/2 rounded bg-white/5" />
              </View>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View style={ctaAnim} className="py-4 items-center">
        <Text className="text-center text-sm text-slate-400">
          🎉 You're all set! Tap{' '}
          <Text className="font-semibold text-teal-400">"Start the Journey"</Text> to go to your dashboard.
        </Text>
      </Animated.View>
    </ScrollView>
  );
}

function InteractiveActivityScreen({ ps }: { ps: PhaseState }) {
  const progressAnim = useSlideUp(0.3, 1000);
  const questionAnim = useSlideUp(0, 900);
  const { data, selectedArea, interactiveStep, setInteractiveStep, interactiveAnswers, setInteractiveAnswers,
    currentAnswer, setCurrentAnswer, setStep, setChildGameResults, setShowGame } = ps;

  const questions = areaQuestions[selectedArea?.id ?? ''] ?? areaQuestions['life_ambition']!;
  const currentQuestion = questions[interactiveStep];
  const questionText = currentQuestion?.question.replace('{name}', String(data['name']));
  const isLastQuestion = interactiveStep === questions.length - 1;
  const isFirstQuestion = interactiveStep === 0;

  const handlePreviousQuestion = () => {
    if (currentQuestion?.type === 'text' && currentAnswer.trim()) {
      setInteractiveAnswers({ ...interactiveAnswers, [currentQuestion.id]: currentAnswer });
    }
    const prevStep = interactiveStep - 1;
    const prevQuestion = questions[prevStep];
    const savedAns = prevQuestion ? interactiveAnswers[prevQuestion.id] : undefined;
    setCurrentAnswer(prevQuestion?.type === 'text' && typeof savedAns === 'string' ? savedAns : '');
    setInteractiveStep(prevStep);
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      <Animated.View style={progressAnim} className="items-center mb-6">
        <View className="mb-4 flex-row items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/10 px-4 py-2">
          <Text className="text-sm">{selectedArea?.emoji}</Text>
          <Text className="text-sm font-medium text-teal-400">{selectedArea?.name} Activity</Text>
        </View>
        <View className="mb-2 flex-row justify-center gap-1">
          {questions.map((_: unknown, i: number) => (
            <View key={i} className={`h-1.5 w-8 rounded-full ${i === interactiveStep ? 'bg-teal-400' : i < interactiveStep ? 'bg-emerald-500' : 'bg-white/10'}`} />
          ))}
        </View>
        <Text className="text-xs text-slate-500">Question {interactiveStep + 1} of {questions.length}</Text>
      </Animated.View>

      <Animated.View key={interactiveStep} style={questionAnim} className="rounded-2xl border border-white/10 bg-card p-6">
        <View className="mb-5">
          <View className="mb-4 h-10 w-10 items-center justify-center rounded-xl bg-teal-500">
            <Text className="text-base">💬</Text>
          </View>
          <Text className="mb-1 text-lg font-bold text-white">{questionText}</Text>
        </View>

        {currentQuestion?.type === 'text' ? (
          <>
            <TextareaWithVoice
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder={currentQuestion?.placeholder}
              className="min-h-[100px] rounded-xl bg-surface-input text-white p-3 border border-white/10 mb-3"
              placeholderTextColor="#475569"
            />
            <View className="flex-row gap-3">
              {!isFirstQuestion && (
                <Button onPress={handlePreviousQuestion} className="h-11 flex-1 rounded-2xl border border-white/10 bg-transparent items-center justify-center">
                  <Text className="text-slate-300">‹ Previous</Text>
                </Button>
              )}
              <Button
                onPress={() => {
                  if (currentAnswer.trim()) {
                    setInteractiveAnswers({ ...interactiveAnswers, [currentQuestion.id]: currentAnswer });
                    setCurrentAnswer('');
                    if (isLastQuestion) { setChildGameResults(null); setShowGame(false); setStep('activity_summary'); }
                    else { setInteractiveStep(interactiveStep + 1); }
                  }
                }}
                disabled={!currentAnswer.trim()}
                className={`h-11 rounded-2xl bg-teal-500 items-center justify-center px-6 ${!isFirstQuestion ? '' : 'flex-1'}`}
              >
                <Text className="font-semibold text-white">{isLastQuestion ? 'See Summary' : 'Next ›'}</Text>
              </Button>
            </View>
          </>
        ) : (
          <>
            <View className="mb-3">
              {currentQuestion?.options?.map((option: string) => {
                const selected = choiceAnswersEqual(interactiveAnswers[currentQuestion.id], option);
                return (
                  <Pressable
                    key={option}
                    onPress={() => { setInteractiveAnswers({ ...interactiveAnswers, [currentQuestion.id]: option }); }}
                    className={`w-full rounded-xl border p-3.5 mb-2 ${selected ? 'border-teal-500/50 bg-teal-500/10' : 'border-white/10 bg-surface-input'}`}
                    android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
                  >
                    <Text className={`font-medium ${selected ? 'text-teal-300' : 'text-slate-300'}`}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View className="flex-row gap-3">
              {!isFirstQuestion && (
                <Button onPress={handlePreviousQuestion} className="h-11 flex-1 rounded-2xl border border-white/10 bg-transparent items-center justify-center">
                  <Text className="text-slate-300">‹ Previous</Text>
                </Button>
              )}
              <Button
                onPress={() => {
                  if (!currentQuestion) return;
                  if (!answerLooksFilled(interactiveAnswers[currentQuestion.id])) return;
                  if (isLastQuestion) { setChildGameResults(null); setShowGame(false); setStep('activity_summary'); }
                  else { setInteractiveStep(interactiveStep + 1); }
                }}
                disabled={!currentQuestion || !answerLooksFilled(interactiveAnswers[currentQuestion.id])}
                className={`h-11 rounded-2xl bg-teal-500 items-center justify-center px-6 ${!isFirstQuestion ? '' : 'flex-1'}`}
              >
                <Text className="font-semibold text-white">{isLastQuestion ? 'See Summary' : 'Next ›'}</Text>
              </Button>
            </View>
          </>
        )}
      </Animated.View>
    </ScrollView>
  );
}

function ActivitySummaryScreen({ ps }: { ps: PhaseState }) {
  const headerAnim = useSlideUp(0.1, 800);
  const qaAnim = useSlideUp(0.3, 800);
  const { data, selectedArea, selectedActivity, interactiveAnswers, parentLiked, showGame,
    childGameResults, childActivitySelections, aiRecommendations, loadingRecommendations,
    currentAreaIndex, qaAnimKey, setStep, setParentLiked, setShowGame, setChildGameResults,
    setChildActivitySelections, setAiRecommendations, setSelectedActivity: _setSelectedActivity,
    saveCompletedGrowthArea, mergeChildGameFromServer, generateAiRecommendations,
    handleFinishRef, debouncedSaveAreaProgress, activeChildId, navigation } = ps;
  const questions = areaQuestions[selectedArea?.id ?? ''] ?? areaQuestions['life_ambition']!;

  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4">
      {/* Header */}
      <Animated.View style={headerAnim} className="items-center mb-6">
        <View className={`mx-auto mb-4 h-20 w-20 rounded-2xl ${selectedArea?.color ?? 'bg-emerald-500'} items-center justify-center`}>
          <Text className="text-4xl">{selectedArea?.emoji}</Text>
        </View>
        <Text className="mb-2 text-center text-2xl font-bold text-white">Great Insights!</Text>
        <Text className="text-center text-slate-400">
          Here's what we learned about {String(data['name'])}'s {selectedArea?.name}
        </Text>
      </Animated.View>

      {/* Q&A summary */}
      <Animated.View style={qaAnim} className="rounded-2xl border border-white/10 bg-card p-6 mb-6">
        {questions.map((q: { id: string; question: string }, _i: number) => {
          const answer = interactiveAnswers[q.id];
          if (!answer) return null;
          return (
            <View key={`${qaAnimKey}-${q.id}`} className="pb-3 border-b border-white/5 mb-3 last:border-0 last:mb-0">
              <Text className="mb-1 text-xs text-slate-500">{q.question.replace('{name}', String(data['name']))}</Text>
              <Text className="text-sm font-medium text-white">
                {typeof answer === 'string' ? answer : typeof answer === 'number' || typeof answer === 'boolean' ? String(answer) : ''}
              </Text>
            </View>
          );
        })}
      </Animated.View>

      {/* Selected activity */}
      {selectedActivity && !childGameResults && (
        <View className="space-y-4 rounded-2xl border border-purple-500/20 bg-card p-5 mb-6">
          <Text className="text-xs font-semibold uppercase tracking-widest text-purple-400">Your selected activity</Text>
          <View>
            <Text className="text-base font-bold text-white">{selectedActivity.title}</Text>
            <Text className="mt-1 text-sm text-slate-400">{selectedActivity.description}</Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              <View className="rounded-full bg-white/10 px-2 py-0.5"><Text className="text-xs text-slate-400">⏱ {selectedActivity.duration}</Text></View>
              <View className="rounded-full bg-purple-500/15 px-2 py-0.5"><Text className="text-xs capitalize text-purple-400">{selectedActivity.type}</Text></View>
            </View>
          </View>
          <Button onPress={() => setStep('parent_activity')} className="rounded-2xl bg-purple-500 items-center justify-center py-2.5 mb-2">
            <Text className="text-white font-medium">Open activity details</Text>
          </Button>
          <Button onPress={() => setStep('activity_selection')} className="rounded-2xl border border-white/10 bg-transparent items-center justify-center py-2.5">
            <Text className="text-slate-300">Pick a different activity</Text>
          </Button>
        </View>
      )}

      {/* No parent liked yet */}
      {!parentLiked && !showGame && !childGameResults && (
        <View className="mb-6">
          <View className="flex-row gap-3 mb-3">
            <Button
              onPress={() => { void (async () => { if (!selectedArea) return; await mergeChildGameFromServer(selectedArea.id, { reopenGame: true }); setParentLiked(true); })(); }}
              className="h-11 flex-1 rounded-2xl bg-teal-500 items-center justify-center"
            >
              <Text className="font-semibold text-white">Explore Child Activity</Text>
            </Button>
            <Button
              onPress={() => { void (async () => { if (!selectedArea) return; await saveCompletedGrowthArea(selectedArea, interactiveAnswers, null); setStep('area_selection'); setParentLiked(null); setChildActivitySelections([]); setChildGameResults(null); setShowGame(false); })(); }}
              className="h-11 flex-1 rounded-2xl border border-white/10 bg-transparent items-center justify-center"
            >
              <Text className="text-slate-300">Next Growth Area</Text>
            </Button>
          </View>
          <Button onPress={() => { void handleFinishRef.current?.(); }} className="h-11 w-full rounded-2xl border border-teal-500/30 bg-transparent items-center justify-center">
            <Text className="text-teal-400">› Go to Life Journey</Text>
          </Button>
        </View>
      )}

      {/* Parent liked */}
      {parentLiked === true && !showGame && !childGameResults && (
        <View className="mb-6">
          <Button
            onPress={() => { void (async () => { if (!selectedArea) return; await mergeChildGameFromServer(selectedArea.id, { reopenGame: true }); setShowGame(true); })(); }}
            className="h-12 w-full rounded-2xl bg-emerald-500 items-center justify-center mb-3"
          >
            <Text className="font-semibold text-white">Present a fun game to {String(data['name'])} on the same topic</Text>
          </Button>
          <Button
            onPress={() => { void (async () => { if (!selectedArea) return; await saveCompletedGrowthArea(selectedArea, interactiveAnswers, null); setStep('area_selection'); setParentLiked(null); setChildActivitySelections([]); setChildGameResults(null); setShowGame(false); })(); }}
            className="h-12 w-full rounded-2xl border-2 border-white/10 bg-transparent items-center justify-center mb-3"
          >
            <Text className="text-slate-300">Explore Later</Text>
          </Button>
          <Button onPress={() => { void handleFinishRef.current?.(); }} className="h-12 w-full rounded-2xl border border-teal-500/30 bg-transparent items-center justify-center">
            <Text className="text-teal-400">› Go to Life Journey</Text>
          </Button>
        </View>
      )}

      {/* Child game */}
      {showGame && !childGameResults && selectedArea?.id && (
        <View className="rounded-3xl border border-emerald-500/20 bg-card p-6 mb-6">
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
                  area_id: area.id, area_name: area.name, area_color: area.color,
                  answers: interactiveAnswers, recommendations: aiRecommendations ?? null, child_activity,
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
        </View>
      )}

      {/* Results after game */}
      {childGameResults && (
        <View>
          <View className="rounded-3xl border border-emerald-500/20 bg-card p-6 mb-4">
            <View className="items-center mb-4">
              <View className="mb-3 h-16 w-16 items-center justify-center rounded-full bg-emerald-500">
                <Text className="text-3xl">✨</Text>
              </View>
              <Text className="text-center text-xl font-bold text-white">Recommendations for {String(data['name'])}</Text>
            </View>

            <View className="mb-4 rounded-2xl bg-surface-elevated p-4">
              <Text className="mb-2 font-semibold text-white">What This Reveals</Text>
              <Text className="text-sm text-slate-400">{childGameResults?.summary ?? ''}</Text>
            </View>

            <View className="mb-4 rounded-2xl bg-surface-elevated p-4">
              <Text className="mb-2 font-semibold text-white">Suggested Activities</Text>
              {suggestedActivitiesFromGameRecommendations(childGameResults).map((activity, i) => (
                <View key={i} className="flex-row items-start gap-2 mb-2">
                  <Text className="text-emerald-500 mt-0.5">✓</Text>
                  <Text className="flex-1 text-sm text-slate-400">{activity}</Text>
                </View>
              ))}
            </View>

            <View className="rounded-2xl bg-surface-elevated p-4">
              <Text className="mb-2 font-semibold text-white">Strengths to Encourage</Text>
              {(Array.isArray(childGameResults?.strengths) ? childGameResults.strengths : []).map((strength, i) => (
                <View key={i} className="flex-row items-start gap-2 mb-2">
                  <Text className="text-emerald-500 mt-0.5">★</Text>
                  <Text className="flex-1 text-sm text-slate-400">{strength}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="rounded-3xl border border-emerald-500/15 bg-card p-6 mb-4">
            <View className="flex-row items-center gap-2 mb-3">
              <Text className="text-emerald-600">🎯</Text>
              <Text className="font-bold text-white">3-Month Recommendations for {selectedArea?.name}</Text>
            </View>

            {!aiRecommendations && !loadingRecommendations && (
              <Button onPress={() => { void generateAiRecommendations(childGameResults); }} className="h-11 w-full rounded-2xl bg-emerald-500 items-center justify-center">
                <Text className="font-semibold text-white">✨ Generate Recommendations</Text>
              </Button>
            )}

            {loadingRecommendations && (
              <View className="items-center justify-center py-10">
                <ActivityIndicator size="large" color="#14b8a6" />
                <Text className="text-sm font-semibold text-white mt-4">Building your 3-Month Plan</Text>
                <Text className="text-xs text-slate-500 mt-1">Personalising recommendations for {typeof data?.['name'] === 'string' ? data['name'] : ''}…</Text>
              </View>
            )}

            {Array.isArray(aiRecommendations) && aiRecommendations.length > 0 && (
              <View>
                {aiRecommendations.map((rec, i) => (
                  <View key={i} className="flex-row items-start gap-3 mb-3">
                    <View className="h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500">
                      <Text className="text-xs font-bold text-white">{i + 1}</Text>
                    </View>
                    <Text className="flex-1 text-sm text-slate-300">{typeof rec === 'string' ? rec : ''}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View className="mb-3">
            <Button
              onPress={() => {
                void (async () => {
                  if (!selectedArea) return;
                  await saveCompletedGrowthArea(selectedArea, interactiveAnswers, aiRecommendations, { selections: childActivitySelections, results: childGameResults });
                  if (currentAreaIndex < growthAreas.length - 1) {
                    ps.setCurrentAreaIndex(currentAreaIndex + 1);
                    setStep('area_selection'); setShowGame(false); setChildGameResults(null);
                    setChildActivitySelections([]); setAiRecommendations(null); setParentLiked(null);
                  } else { navigation.navigate('Main' as never); }
                })();
              }}
              className="h-12 w-full rounded-2xl bg-emerald-500 items-center justify-center mb-3"
            >
              <Text className="font-semibold text-white">
                {currentAreaIndex < growthAreas.length - 1 ? 'Explore More Growth Areas' : 'Explore Life Journey'}
              </Text>
            </Button>
            <Button onPress={() => { void handleFinishRef.current?.(); }} className="h-12 w-full rounded-2xl border border-teal-500/30 bg-transparent items-center justify-center">
              <Text className="text-teal-400">› Go to Life Journey</Text>
            </Button>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function SkipScreen({ ps }: { ps: PhaseState }) {
  const anim = useSlideUp(0.1, 1000);
  const { data, navigation } = ps;
  return (
    <ScrollView className="flex-1" contentContainerClassName="pb-8 px-4 items-center">
      <Animated.View style={anim} className="items-center gap-6 pt-8">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-teal-500">
          <Text className="text-4xl">✨</Text>
        </View>
        <Text className="text-center text-2xl font-bold text-white">Ready for the Next Step!</Text>
        <Text className="text-center text-slate-400">Let's explore the Life Journey designed for {String(data['name'])}.</Text>
        <Button onPress={() => navigation.navigate('Main' as never)} className="h-12 rounded-2xl bg-emerald-500 px-8 items-center justify-center">
          <Text className="font-semibold text-white">Continue to Life Journey ›</Text>
        </Button>
      </Animated.View>
    </ScrollView>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RecommendationsPhase({
  data,
  profile,
  activeChildId,
  onFinish,
  onRegisterBack,
  onPhaseBack,
}: RecommendationsPhaseProps) {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const [step, setStep] = useState('intro');
  const [qaAnimKey, setQaAnimKey] = useState(0);

  useEffect(() => {
    if (step === 'activity_summary') setQaAnimKey((k) => k + 1);
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
  const [aiRecommendations, setAiRecommendations] = useState<unknown[] | null>(null);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const completedAreaIdsRef = useRef(new Set<string>());
  const growthAreaSaveChainRef = useRef(Promise.resolve());
  const handleFinishRef = useRef<(() => Promise<void>) | null>(null);

  const debouncedSaveAreaProgress = useMemo(
    () => debounce((payload: Record<string, unknown>) => {
      api.completedGrowthAreas.append(activeChildId ?? '', payload).catch(() => {});
    }, 400),
    [activeChildId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        debouncedSaveAreaProgress.cancel();
        const [completedDataRaw] = await Promise.all([
          api.completedGrowthAreas.list(activeChildId ?? ''),
          api.preferences.get(),
        ]);
        if (cancelled) return;
        const completedData = completedDataRaw as Record<string, unknown>;
        const allDocs = (Array.isArray(completedData['areas']) ? completedData['areas'] : []) as Record<string, unknown>[];
        const completedDocs = allDocs.filter((a) => a.status === 'completed' || !a.status);
        if (completedDocs.length > 0) completedAreaIdsRef.current = new Set(completedDocs.map((a) => a.area_id as string));

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
          setInteractiveAnswers(d.mergedAnswers); setStep(d.step); setInteractiveStep(d.interactiveStep); setCurrentAnswer(d.currentAnswer);
          const ca = p.child_activity as | { selections?: unknown; results?: ChildGameResults } | null | undefined;
          if (ca) {
            const sels = Array.isArray(ca.selections) ? (ca.selections as string[]) : [];
            setChildActivitySelections(sels);
            if (ca.results && d.step === 'activity_summary') { setChildGameResults(ca.results); setShowGame(false); setParentLiked(true); }
          } else { const savedSels = p.child_activity_selections; if (Array.isArray(savedSels)) setChildActivitySelections(savedSels); }
          if (p.generated_activity) setGeneratedActivity(p.generated_activity);
          if (typeof p.show_game === 'boolean') setShowGame(p.show_game);
          let aiRec = Array.isArray(p.ai_three_month_recommendations) && p.ai_three_month_recommendations.length > 0 ? p.ai_three_month_recommendations : null;
          aiRec ??= extractAiRecommendationsFromCompleted(completedDocs, areaObj.id);
          setAiRecommendations(aiRec);
        }
      } catch (err) {
        console.warn('[RecommendationsPhase] Resume load failed:', err);
      } finally {
        if (!cancelled) setResumeLoaded(true);
      }
    })();
    return () => { cancelled = true; debouncedSaveAreaProgress.cancel(); };
  }, [activeChildId, debouncedSaveAreaProgress]);

  useEffect(() => {
    if (onRegisterBack) {
      onRegisterBack(() => {
        if (step === 'intro') { onPhaseBack?.(); }
        else if (step === 'area_selection') { setStep('intro'); }
        else if (step === 'interactive_activity') { setStep('area_selection'); }
        else if (step === 'activity_summary') {
          const qs = areaQuestions[selectedArea?.id ?? ''] ?? areaQuestions['life_ambition']!;
          const firstIncomplete = qs.findIndex((q: { id: string }) => !answerLooksFilled(interactiveAnswers[q.id]));
          setInteractiveStep(firstIncomplete === -1 ? Math.max(0, qs.length - 1) : firstIncomplete);
          setStep('interactive_activity');
        } else { setStep('area_selection'); }
      });
    }
  }, [step, selectedArea, interactiveAnswers, interactiveStep, onRegisterBack, onPhaseBack]);

  useEffect(() => {
    if (!resumeLoaded || !selectedArea) return;
    const payload = buildAreaProgressPayload({
      area: selectedArea, step, selectedActivity, parentLiked, wantChildActivity, feedback,
      interactiveStep, interactiveAnswers, currentAnswer, generatedActivity, showGame,
      childActivitySelections, aiRecommendations, childGameResults,
    });
    debouncedSaveAreaProgress(payload);
  }, [resumeLoaded, selectedArea, step, selectedActivity, parentLiked, wantChildActivity, feedback,
    interactiveStep, interactiveAnswers, currentAnswer, generatedActivity, showGame,
    childActivitySelections, childGameResults, aiRecommendations, debouncedSaveAreaProgress]);

  useEffect(() => {
    if (!resumeLoaded || step !== 'interactive_activity' || !selectedArea) return;
    const questions = areaQuestions[selectedArea.id] ?? areaQuestions['life_ambition']!;
    const cq = questions[interactiveStep];
    if (cq?.type !== 'text') return;
    const saved = interactiveAnswers[cq.id];
    const savedStr = saved === undefined || saved === null ? '' : typeof saved === 'string' ? saved : typeof saved === 'number' || typeof saved === 'boolean' ? String(saved) : '';
    if (savedStr.trim() !== '') setCurrentAnswer(savedStr);
  }, [resumeLoaded, step, selectedArea, interactiveStep, interactiveAnswers]);

  const saveCompletedGrowthArea = useCallback(async (
    area: AreaDef, answers: Record<string, unknown>, recs: unknown[] | null,
    childActivity?: { selections: string[]; results: ChildGameResults },
  ) => {
    debouncedSaveAreaProgress.cancel?.();
    const payload = {
      area_id: area.id, area_name: area.name, area_color: area.color, answers, recommendations: recs,
      status: 'completed', step: null, selected_activity: null, parent_liked: null, want_child_activity: null,
      feedback: null, interactive_step: null, interactive_answers: null, interactive_draft: null,
      generated_activity: null, show_game: null, child_activity_selections: null, ai_three_month_recommendations: null,
      ...(childActivity ? { child_activity: childActivity } : {}),
    };
    const task = growthAreaSaveChainRef.current.then(() => api.completedGrowthAreas.append(activeChildId ?? '', payload));
    growthAreaSaveChainRef.current = task.then(() => {}, () => {});
    try {
      await task;
      setSelectedArea(null); debouncedSaveAreaProgress.cancel?.(); setInteractiveAnswers({});
      setAiRecommendations(null); setChildActivitySelections([]);
      completedAreaIdsRef.current = new Set([...completedAreaIdsRef.current, area.id]);
    } catch (err) {
      console.error('[RecommendationsPhase] Could not save progress:', err);
      toast.error('Could not save progress');
    }
  }, [activeChildId, debouncedSaveAreaProgress]);

  const mergeChildGameFromServer = useCallback(async (areaId: string, { reopenGame }: { reopenGame?: boolean } = {}) => {
    if (!areaId) return;
    try {
      debouncedSaveAreaProgress.flush?.();
      const completedDataRaw = await api.completedGrowthAreas.list(activeChildId ?? '');
      const completedData = completedDataRaw as { areas?: Record<string, unknown>[] } | null;
      const areaDoc = completedData?.areas?.find((a) => a['area_id'] === areaId);
      const ca = areaDoc ? (areaDoc['child_activity'] as | { selections?: unknown; results?: ChildGameResults } | null | undefined) : null;
      if (ca) {
        setChildActivitySelections(Array.isArray(ca.selections) ? (ca.selections as string[]) : []);
        if (!reopenGame) {
          if (ca.results) { setChildGameResults(ca.results); setShowGame(false); setParentLiked(true); }
          else { setChildGameResults(null); }
        }
      } else {
        const savedSels = areaDoc ? areaDoc['child_activity_selections'] : undefined;
        setChildActivitySelections(Array.isArray(savedSels) ? (savedSels as string[]) : []);
        if (!reopenGame) setChildGameResults(null);
      }
    } catch (err) { console.warn('[RecommendationsPhase] Area open failed:', err); }
  }, [activeChildId, debouncedSaveAreaProgress]);

  const generateAiRecommendations = useCallback(async (childResults: ChildGameResults | null) => {
    try {
      const completedDataRaw = await api.completedGrowthAreas.list(activeChildId ?? '');
      const completedDataObj = completedDataRaw as { areas?: Record<string, unknown>[] } | null;
      const existing = completedDataObj?.areas?.find((a: Record<string, unknown>) => a['area_id'] === selectedArea?.id);
      const existingRecs = existing ? (existing['recommendations'] as unknown[] | undefined) : undefined;
      if (Array.isArray(existingRecs) && existingRecs.length > 0) { setAiRecommendations(existingRecs); return; }
      const existingAiRecs = existing ? (existing['ai_three_month_recommendations'] as unknown[] | undefined) : undefined;
      if (Array.isArray(existingAiRecs) && existingAiRecs.length > 0) { setAiRecommendations(existingAiRecs); return; }
    } catch (err) { console.warn('[RecommendationsPhase] Could not load cached recommendations:', err); }

    setLoadingRecommendations(true);
    try {
      const questions = areaQuestions[selectedArea?.id ?? ''] ?? areaQuestions['life_ambition']!;
      const qaContext = questions.filter((q) => interactiveAnswers[q.id]).map((q) => {
        const ans = interactiveAnswers[q.id];
        return `Q: ${q.question.replace('{name}', String(data['name']))}\nA: ${typeof ans === 'string' ? ans : typeof ans === 'number' || typeof ans === 'boolean' ? String(ans) : ''}`;
      }).join('\n\n');

      const childContext = childResults ? (() => {
        const gr = normalizeChildGameRecommendations(childResults);
        const sug: string[] = Array.isArray(gr['suggested_activities']) ? (gr['suggested_activities'] as string[]) : [];
        const strengths: string[] = Array.isArray(gr['strengths']) ? (gr['strengths'] as string[]) : [];
        return `\n\nChild's game responses:\nSummary: ${typeof gr['summary'] === 'string' ? gr['summary'] : ''}\nStrengths observed: ${strengths.join(', ')}\nSuggested activities from game: ${sug.join(', ')}`;
      })() : '';
      const feedbackContext = feedback?.trim() ? `\n\nParent's feedback on suggested activities: "${feedback}"` : '';

      const result = await api.integrations.Core.InvokeLLM({
        prompt: `Based on the following parent responses and child's game activity responses about "${String(data['name'])}" in the growth area "${selectedArea?.name ?? ''}", generate 5 practical 3-month recommendations that synthesize both perspectives.\n\nParent responses:\n${qaContext}${childContext}${feedbackContext}\n\nReturn ONLY a JSON object with a "recommendations" array of 5 short, actionable bullet points (1-2 sentences each) specific to the "${selectedArea?.name ?? ''}" growth area.`,
        response_json_schema: { type: 'object', properties: { recommendations: { type: 'array', items: { type: 'string' } } } },
      });
      const resultObj = result as Record<string, unknown>;
      const list: unknown[] = result && typeof result === 'object' && Array.isArray(resultObj['recommendations']) ? (resultObj['recommendations'] as unknown[]) : [];
      setAiRecommendations(list);
    } catch (err) {
      console.error('[RecommendationsPhase] Failed to generate recommendations:', err);
      toast.error('Could not generate recommendations');
    } finally { setLoadingRecommendations(false); }
  }, [activeChildId, selectedArea, interactiveAnswers, feedback, data]);

  // Keep handleFinishRef current every render
  handleFinishRef.current = async () => {
    if (selectedArea && step !== 'area_selection') {
      const recs = childGameResults ? aiRecommendations : null;
      const childActivity = childGameResults ? { selections: childActivitySelections, results: childGameResults } : undefined;
      await saveCompletedGrowthArea(selectedArea, interactiveAnswers, recs, childActivity);
    }
    if (onFinish) await onFinish();
    else navigation.navigate('Main' as never);
  };

  const ps: PhaseState = {
    data, profile, activeChildId, step, setStep, selectedArea, setSelectedArea,
    selectedActivity, setSelectedActivity, parentLiked, setParentLiked,
    wantChildActivity, setWantChildActivity, feedback, setFeedback,
    currentAreaIndex, setCurrentAreaIndex, interactiveStep, setInteractiveStep,
    interactiveAnswers, setInteractiveAnswers, currentAnswer, setCurrentAnswer,
    generatedActivity, setGeneratedActivity, showGame, setShowGame,
    childGameResults, setChildGameResults, childActivitySelections, setChildActivitySelections,
    aiRecommendations, setAiRecommendations, loadingRecommendations, setLoadingRecommendations,
    qaAnimKey, debouncedSaveAreaProgress, saveCompletedGrowthArea, mergeChildGameFromServer,
    generateAiRecommendations, handleFinishRef, navigation,
  };

  return (
    <View className="flex-1">
      {step === 'intro' && <IntroScreen ps={ps} />}
      {step === 'area_selection' && <AreaSelectionScreen ps={ps} />}
      {step === 'activity_selection' && <ActivitySelectionScreen ps={ps} />}
      {step === 'interactive_activity' && <InteractiveActivityScreen ps={ps} />}
      {step === 'activity_summary' && <ActivitySummaryScreen ps={ps} />}
      {step === 'parent_activity' && <ParentActivityScreen ps={ps} />}
      {step === 'feedback' && <FeedbackScreen ps={ps} />}
      {step === 'child_activity_prompt' && <ChildActivityPromptScreen ps={ps} />}
      {step === 'results' && <ResultsPreviewScreen ps={ps} />}
      {step === 'skip' && <SkipScreen ps={ps} />}
    </View>
  );
}
