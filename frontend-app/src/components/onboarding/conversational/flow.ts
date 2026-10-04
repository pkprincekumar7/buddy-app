// Types, icon maps and pure helpers of the conversational onboarding chatbot —
// split out of web components/onboarding/ConversationalOnboarding.tsx verbatim.
import {
  Activity,
  BarChart2,
  Cloud,
  Eye,
  Hand,
  Headphones,
  Heart,
  HelpCircle,
  MessageSquare,
  Mic,
  Moon,
  Search,
  Shield,
  Shuffle,
  Sparkles,
  User,
  VolumeX,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { questionnaireFieldHasValue } from '@/lib/onboardingChildData';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationStep {
  id: string;
  message: string | ((data: Record<string, unknown>) => string);
  field: string;
  type: 'text' | 'multi_text' | 'choice' | 'auto' | 'final';
  options?: string[];
  placeholder?: string;
  hint?: string;
  phase?: number;
}

export interface ChatMessage {
  id: string;
  role: 'bot' | 'user';
  content: string;
}

export interface AnalyzingState {
  show: boolean;
  progress: number;
  name: string;
  showingDots: boolean;
  dotCount: number;
}

export interface PhaseSplash {
  icon: string;
  /** className(s) for the icon circle (web: color + ring classes). */
  iconColor: string;
  title: string;
  subtitle: string;
  displayStep: number;
}

export interface SummaryItem {
  label: string;
  answer: string;
}

// ── Summary card icon map ─────────────────────────────────────────────────────

export const SUMMARY_ICONS: Record<string, LucideIcon> = {
  Strengths: Sparkles,
  Hobbies: Heart,
  'Thinking style': Eye,
  Communication: MessageSquare,
  'Energy level': Activity,
  'Social behaviour': Shield,
  'Emotional nature': Moon,
};

// ── Option icon map ───────────────────────────────────────────────────────────

export const OPTION_ICONS: Record<string, LucideIcon> = {
  Visual: Eye,
  Analytical: BarChart2,
  Imaginative: Sparkles,
  'Not sure': HelpCircle,
  'Not Sure': HelpCircle,
  Talkative: MessageSquare,
  'Deep Listener': Headphones,
  'Communicates through gestures': Hand,
  Silent: VolumeX,
  Observant: Search,
  'High energy - always active': Zap,
  'Moderate - balanced': Activity,
  'Calm and composed': Heart,
  'Variable - depends on interest': Shuffle,
  Confident: Shield,
  Friendly: Heart,
  Reserved: User,
  Expressive: Mic,
  Withdrawn: User,
  Calm: Moon,
  Sensitive: Heart,
  Impulsive: Zap,
  Moody: Cloud,
};

// ── Phase splash definitions (triggered when crossing these flow indices) ─────

export const PHASE_SPLASHES: Record<number, PhaseSplash> = {};

// ── Helper functions ──────────────────────────────────────────────────────────

export function buildAccThrough(
  flow: ConversationStep[],
  data: Record<string, unknown>,
  beforeStepIdx: number,
): Record<string, unknown> {
  const acc: Record<string, unknown> = {};
  for (let j = 0; j < beforeStepIdx; j++) {
    const st = flow[j];
    if (!st) break;
    if (st.type === 'auto') break;
    acc[st.field] = data[st.field];
  }
  return acc;
}

export function findResumeStepIndex(
  flow: ConversationStep[],
  data: Record<string, unknown>,
): number {
  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    if (!step) break;
    if (step.type === 'auto') return i;
    if (!questionnaireFieldHasValue(step.field, data)) return i;
  }
  const autoIx = flow.findIndex(s => s.type === 'auto');
  return autoIx >= 0 ? autoIx : flow.length - 1;
}

export const ANALYZING_INITIAL: AnalyzingState = {
  show: false,
  progress: 0,
  name: '',
  showingDots: false,
  dotCount: 0,
};

const FIELD_LABELS: Record<string, string> = {
  strengths: 'Strengths',
  hobbies: 'Hobbies',
  thinking_pattern: 'Thinking style',
  communication_style: 'Communication',
  energy_level: 'Energy level',
  social_behaviour: 'Social behaviour',
  emotional_behaviour: 'Emotional nature',
};

export function buildResumeSummary(
  flow: ConversationStep[],
  data: Record<string, unknown>,
  upToIdx: number,
): SummaryItem[] {
  const items: SummaryItem[] = [];
  for (let i = 0; i < upToIdx; i++) {
    const step = flow[i];
    if (!step || step.type === 'auto') break;
    const val = data[step.field];
    const answer = Array.isArray(val)
      ? val.join(', ')
      : typeof val === 'string'
      ? val
      : typeof val === 'number'
      ? String(val)
      : '';
    if (!answer) continue;
    const label = FIELD_LABELS[step.field] ?? step.field;
    items.push({ label, answer });
  }
  return items;
}

/** Builds the 8-step chatbot flow (web `conversationFlow` useMemo body). */
export function buildConversationFlow(parentName: string): ConversationStep[] {
  return [
    {
      id: 'ready_check',
      message: data => {
        const name =
          typeof data.name === 'string' && data.name ? data.name : 'your child';
        return `Hey ${parentName}! Let's now explore what makes ${name} unique.\nMention the top 3 strengths that ${name} has from your perspective.`;
      },
      field: 'strengths',
      type: 'multi_text',
      placeholder: 'e.g., Intelligent, Energetic, Well-mannered',
      hint: 'Separate each with a comma',
      phase: 1,
    },
    {
      id: 'strengths_response',
      message: data =>
        `Happy to know that! You are a lucky parent! 😊\n\nMention the top 3 hobbies where ${
          typeof data.name === 'string' ? data.name : ''
        } spends their time.`,
      field: 'hobbies',
      type: 'multi_text',
      placeholder: 'e.g., Cricket, Drawing, Reading',
      hint: 'Separate each with a comma',
      phase: 1,
    },
    {
      id: 'thinking_pattern',
      message: data =>
        `Choose the kind of thinking pattern that ${
          typeof data.name === 'string' ? data.name : ''
        } predominantly has:`,
      field: 'thinking_pattern',
      type: 'choice',
      options: ['Visual', 'Analytical', 'Imaginative', 'Not sure'],
      phase: 1,
    },
    {
      id: 'communication_style',
      message: data =>
        `Choose the kind of communication style that ${
          typeof data.name === 'string' ? data.name : ''
        } predominantly has:`,
      field: 'communication_style',
      type: 'choice',
      options: [
        'Talkative',
        'Deep Listener',
        'Communicates through gestures',
        'Silent',
        'Observant',
        'Not Sure',
      ],
      phase: 1,
    },
    {
      id: 'energy_level',
      message: data =>
        `How would you describe ${
          typeof data.name === 'string' ? data.name : ''
        }'s energy level?`,
      field: 'energy_level',
      type: 'choice',
      options: [
        'High energy - always active',
        'Moderate - balanced',
        'Calm and composed',
        'Variable - depends on interest',
      ],
      phase: 1,
    },
    {
      id: 'social_behaviour',
      message: data =>
        `How does ${
          typeof data.name === 'string' ? data.name : ''
        } behave in social situations?`,
      field: 'social_behaviour',
      type: 'choice',
      options: ['Confident', 'Friendly', 'Reserved', 'Expressive', 'Withdrawn'],
      phase: 1,
    },
    {
      id: 'emotional_behaviour',
      message: data =>
        `What kind of a child is ${
          typeof data.name === 'string' ? data.name : ''
        } emotionally?`,
      field: 'emotional_behaviour',
      type: 'choice',
      options: ['Calm', 'Sensitive', 'Reserved', 'Impulsive', 'Moody'],
      phase: 1,
    },
    {
      id: 'complete',
      message: () => '',
      field: 'start_analysis',
      type: 'auto',
      phase: 1,
    },
  ];
}

/** Resolves a step's message (static string or data-driven function). */
export function stepMessage(
  step: ConversationStep | undefined,
  data: Record<string, unknown>,
): string {
  if (!step) return '';
  return typeof step.message === 'function' ? step.message(data) : step.message;
}
