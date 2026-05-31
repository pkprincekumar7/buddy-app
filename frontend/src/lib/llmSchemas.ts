import { PERSONALITY_TYPE_KEYS } from '@/components/shared/PersonalityAnalysis';

export function personalityLlmSchema() {
  const styleEnumItem = PERSONALITY_TYPE_KEYS.length
    ? { type: 'string', enum: [...PERSONALITY_TYPE_KEYS] }
    : { type: 'string' };
  return {
    type: 'object',
    properties: {
      dominant_style: styleEnumItem,
      personality_category: {
        type: 'string',
        enum: ['motivators', 'socializers', 'creatives', 'adventurers'],
      },
      secondary_styles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            personality_style: styleEnumItem,
            prominence: { type: 'number' },
          },
        },
        maxItems: 2,
      },
      personalized_traits: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 6 },
      personalized_description: { type: 'string', maxLength: 180 },
      personalized_growth_areas: { type: 'array', items: { type: 'string' }, minItems: 3 },
      role_models: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        minItems: 2,
        maxItems: 2,
      },
      strength_summary_bullets: {
        type: 'array',
        items: { type: 'string' },
        minItems: 6,
        maxItems: 6,
      },
    },
    required: [
      'dominant_style',
      'personality_category',
      'secondary_styles',
      'personalized_traits',
      'personalized_description',
      'personalized_growth_areas',
      'role_models',
      'strength_summary_bullets',
    ],
  };
}

export function recommendationsJourneySchema() {
  return {
    type: 'object',
    properties: {
      pathway_overview: { type: 'string' },
      focus_areas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pillar: { type: 'string' },
            focus: { type: 'string' },
            why: { type: 'string' },
          },
        },
        minItems: 4,
        maxItems: 4,
      },
      initial_missions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            pillar: { type: 'string' },
          },
        },
        minItems: 3,
        maxItems: 3,
      },
    },
  };
}

export function goalsMonthlyPlanSchema() {
  return {
    type: 'object',
    required: ['months'],
    properties: {
      months: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          required: ['month', 'goal', 'objective', 'periods'],
          properties: {
            month: { type: 'number' },
            goal: { type: 'string' },
            objective: { type: 'string' },
            periods: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: {
                type: 'object',
                required: ['label', 'activities'],
                properties: {
                  label: { type: 'string' },
                  activities: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 2,
                    items: {
                      type: 'object',
                      required: ['title', 'objective', 'scorable'],
                      properties: {
                        title: { type: 'string' },
                        objective: { type: 'string' },
                        scorable: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function activityQuestionsSchema() {
  return {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            type: { type: 'string', enum: ['choice', 'text', 'scale'] },
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            labels: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
}
