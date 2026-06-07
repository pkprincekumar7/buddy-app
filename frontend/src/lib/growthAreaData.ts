import { Rocket, Heart, Brain, Palette, Dumbbell, MessageSquare } from 'lucide-react';

export interface Question {
  id: string;
  question: string;
  type: string;
  placeholder?: string;
  options?: string[];
  followUp: string;
}

export const GROWTH_AREAS = [
  {
    id: 'life_ambition',
    urlName: 'LifeAmbition',
    name: 'Life Ambition',
    icon: Rocket,
    color: 'from-personality to-personality-alt-strong',
    description: 'Discovering purpose and future goals',
  },
  {
    id: 'self_care',
    urlName: 'SelfCare',
    name: 'Self Care',
    icon: Heart,
    color: 'from-error-medium to-accent-pink',
    description: 'Building healthy habits and emotional wellness',
  },
  {
    id: 'critical_thinking',
    urlName: 'CriticalThinking',
    name: 'Critical Thinking',
    icon: Brain,
    color: 'from-info-medium to-primary-medium',
    description: 'Problem solving and analytical skills',
  },
  {
    id: 'creativity',
    urlName: 'Creativity',
    name: 'Creativity',
    icon: Palette,
    color: 'from-warning-medium to-warning-orange-medium',
    description: 'Imagination and creative expression',
  },
  {
    id: 'physical_wellness',
    urlName: 'PhysicalWellness',
    name: 'Physical Wellness',
    icon: Dumbbell,
    color: 'from-success to-primary-dark',
    description: 'Body awareness and physical health',
  },
  {
    id: 'social_skills',
    urlName: 'SocialSkills',
    name: 'Social Skills',
    icon: MessageSquare,
    color: 'from-personality-alt to-personality-alt-strong',
    description: 'Communication and relationship building',
  },
];

/** Map URL param name → area definition, e.g. "LifeAmbition" → { id: 'life_ambition', ... } */
export function areaByUrlName(urlName: string): (typeof GROWTH_AREAS)[number] | null {
  return GROWTH_AREAS.find((a) => a.urlName === urlName) ?? null;
}

/** Map area_id → area definition, e.g. "life_ambition" → { id: 'life_ambition', ... } */
export function areaById(id: string): (typeof GROWTH_AREAS)[number] | null {
  return GROWTH_AREAS.find((a) => a.id === id) ?? null;
}

export const AREA_QUESTIONS: Record<string, Question[]> = {
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
