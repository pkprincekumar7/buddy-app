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
      personalized_growth_areas: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 10,
      },
      role_models: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            caption: { type: 'string', maxLength: 48 },
          },
          required: ['name', 'caption'],
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
      trait_scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            score: { type: 'number', minimum: 0, maximum: 100 },
          },
          required: ['label', 'score'],
        },
        minItems: 4,
        maxItems: 5,
      },
      child_quote: { type: 'string', maxLength: 120 },
      parent_note: { type: 'string', maxLength: 220 },
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
      'trait_scores',
      'child_quote',
      'parent_note',
    ],
  };
}
