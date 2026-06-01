import {
  calculateMBTI,
  adaptAiPersonalityToViewModel,
  PERSONALITY_TYPE_KEYS,
  personalityTypes,
  personalityCategories,
} from '@/lib/personalityLogic';

describe('personalityLogic — static data', () => {
  it('PERSONALITY_TYPE_KEYS matches personalityTypes keys', () => {
    expect(PERSONALITY_TYPE_KEYS).toEqual(Object.keys(personalityTypes));
  });

  it('every personality type has required fields', () => {
    for (const [, pt] of Object.entries(personalityTypes)) {
      expect(pt.name).toBeTruthy();
      expect(pt.category).toBeTruthy();
      expect(pt.traits.length).toBeGreaterThan(0);
      expect(pt.famous_people.length).toBeGreaterThan(0);
    }
  });

  it('every category key referenced by personalityTypes exists in personalityCategories', () => {
    const categoryKeys = Object.keys(personalityCategories);
    for (const pt of Object.values(personalityTypes)) {
      expect(categoryKeys).toContain(pt.category);
    }
  });
});

describe('calculateMBTI', () => {
  it('returns a valid personality type for well-known analytic profile', () => {
    const result = calculateMBTI({
      energy_level: 'Calm and composed',
      thinking_pattern: 'Analytical',
      communication_style: 'Silent',
      social_behaviour: 'Reserved',
      emotional_behaviour: 'Calm',
      name: 'Alex',
    });
    expect(PERSONALITY_TYPE_KEYS).toContain(result.type);
    expect(result.profile.description).toContain('Alex');
    // Thinker should dominate for analytical/silent/calm combo
    expect(result.type).toBe('Thinker');
  });

  it('returns Outgoing/Enthusiastic for social/talkative profile', () => {
    const result = calculateMBTI({
      energy_level: 'High energy - always active',
      thinking_pattern: 'Imaginative',
      communication_style: 'Talkative',
      social_behaviour: 'Friendly',
      emotional_behaviour: 'Sensitive',
      name: 'Sam',
    });
    expect(PERSONALITY_TYPE_KEYS).toContain(result.type);
    expect([
      'Outgoing',
      'Enthusiastic',
      'Highly Energetic',
      'Playful',
    ]).toContain(result.type);
  });

  it('returns a valid type for empty data', () => {
    const result = calculateMBTI({});
    expect(PERSONALITY_TYPE_KEYS).toContain(result.type);
  });

  it('scores object contains all personality type keys', () => {
    const result = calculateMBTI({ energy_level: 'Moderate - balanced' });
    expect(Object.keys(result.scores)).toEqual(
      expect.arrayContaining(PERSONALITY_TYPE_KEYS),
    );
  });

  it('profile.description replaces {childName} placeholder', () => {
    const result = calculateMBTI({ name: 'Jordan' });
    expect(result.profile.description).not.toContain('{childName}');
    expect(result.profile.description).toContain('Jordan');
  });
});

describe('adaptAiPersonalityToViewModel', () => {
  const validAi = {
    dominant_style: 'Thinker',
    personality_category: 'creatives',
    personalized_traits: ['Curious', 'Analytical'],
    personalized_description: '{childName} loves solving puzzles.',
    strength_summary_bullets: ['Problem-solving', 'Deep thinking'],
    personalized_growth_areas: ['Social interaction'],
    role_models: [{ name: 'Marie Curie' }, { name: 'Einstein' }],
    secondary_styles: [{ personality_style: 'Creative', prominence: 75 }],
  };

  it('uses the provided dominant_style', () => {
    const vm = adaptAiPersonalityToViewModel(validAi, 'Jordan');
    expect(vm.type).toBe('Thinker');
  });

  it('replaces {childName} in description', () => {
    const vm = adaptAiPersonalityToViewModel(validAi, 'Jordan');
    expect(vm.profile.description).toContain('Jordan');
    expect(vm.profile.description).not.toContain('{childName}');
  });

  it('uses custom traits when provided', () => {
    const vm = adaptAiPersonalityToViewModel(validAi, 'Jordan');
    expect(vm.profile.traits).toEqual(['Curious', 'Analytical']);
  });

  it('falls back to base traits when personalized_traits is empty', () => {
    const vm = adaptAiPersonalityToViewModel(
      { ...validAi, personalized_traits: [] },
      'Alex',
    );
    const base = personalityTypes['Thinker']!;
    expect(vm.profile.traits).toEqual(base.traits);
  });

  it('falls back to Creative for unknown dominant_style', () => {
    const vm = adaptAiPersonalityToViewModel(
      { dominant_style: 'Unknown' },
      'Alex',
    );
    expect(vm.type).toBe('Creative');
  });

  it('dominant personality gets score 100 in scores map', () => {
    const vm = adaptAiPersonalityToViewModel(validAi, 'Jordan');
    expect(vm.scores['Thinker']).toBe(100);
  });

  it('secondary style gets elevated score', () => {
    const vm = adaptAiPersonalityToViewModel(validAi, 'Jordan');
    expect(vm.scores['Creative'] ?? 0).toBeGreaterThan(14);
  });

  it('produces two famous_people entries', () => {
    const vm = adaptAiPersonalityToViewModel(validAi, 'Jordan');
    expect(vm.profile.famous_people).toHaveLength(2);
  });

  it('uses safe fallback name when childName is empty', () => {
    const vm = adaptAiPersonalityToViewModel(validAi, '');
    expect(vm.profile.description).toContain('your child');
  });
});
