// Game Templates for Child Missions
// Each template defines how a mission should be presented as a game

export const gameTemplates = {
    storyAdventure: {
      id: 'storyAdventure',
      name: 'Story Adventure',
      icon: '📖',
      description: 'Follow a story and make choices along the way',
      structure: {
        intro: 'story_setup',
        questions: [
          { type: 'choice', format: 'narrative_choice' },
          { type: 'text', format: 'character_thought' },
          { type: 'choice', format: 'what_happens_next' },
          { type: 'text', format: 'your_ending' }
        ],
        outro: 'story_conclusion'
      },
      prompts: {
        story_setup: "You're about to start an adventure! Let me tell you a story...",
        narrative_choice: "What would you do in this situation?",
        character_thought: "How would the character feel? What would they think?",
        what_happens_next: "What happens next in your story?",
        your_ending: "How does your adventure end?"
      }
    },
  
    challengeQuest: {
      id: 'challengeQuest',
      name: 'Challenge Quest',
      icon: '⚔️',
      description: 'Complete challenges to level up',
      structure: {
        intro: 'quest_briefing',
        questions: [
          { type: 'choice', format: 'strategy' },
          { type: 'scale', format: 'confidence_meter' },
          { type: 'text', format: 'action_plan' },
          { type: 'choice', format: 'final_challenge' }
        ],
        outro: 'quest_complete'
      },
      prompts: {
        quest_briefing: "Welcome, adventurer! You have a quest to complete...",
        strategy: "Choose your strategy:",
        confidence_meter: "How ready do you feel for this challenge?",
        action_plan: "What's your plan to succeed?",
        final_challenge: "For the final challenge, you will:"
      }
    },
  
    discoveryMission: {
      id: 'discoveryMission',
      name: 'Discovery Mission',
      icon: '🔍',
      description: 'Explore and discover new things about yourself',
      structure: {
        intro: 'mission_start',
        questions: [
          { type: 'text', format: 'initial_thought' },
          { type: 'choice', format: 'exploration_path' },
          { type: 'scale', format: 'discovery_scale' },
          { type: 'text', format: 'big_discovery' }
        ],
        outro: 'mission_complete'
      },
      prompts: {
        mission_start: "Time to explore and discover! Ready?",
        initial_thought: "What do you already know about this?",
        exploration_path: "Which path will you explore?",
        discovery_scale: "How much did you discover?",
        big_discovery: "What's the biggest thing you discovered?"
      }
    },
  
    creativeBuilder: {
      id: 'creativeBuilder',
      name: 'Creative Builder',
      icon: '🎨',
      description: 'Create and build something amazing',
      structure: {
        intro: 'building_start',
        questions: [
          { type: 'text', format: 'vision' },
          { type: 'choice', format: 'materials' },
          { type: 'text', format: 'creation_process' },
          { type: 'scale', format: 'satisfaction' }
        ],
        outro: 'creation_showcase'
      },
      prompts: {
        building_start: "Let's create something awesome together!",
        vision: "What do you want to create?",
        materials: "What tools or ideas will you use?",
        creation_process: "How will you bring your creation to life?",
        satisfaction: "How happy are you with what you created?"
      }
    },
  
    reflectionJourney: {
      id: 'reflectionJourney',
      name: 'Reflection Journey',
      icon: '🌟',
      description: 'Think deeply and share your thoughts',
      structure: {
        intro: 'journey_welcome',
        questions: [
          { type: 'text', format: 'current_feeling' },
          { type: 'choice', format: 'experience_choice' },
          { type: 'text', format: 'deep_thought' },
          { type: 'scale', format: 'growth_feeling' }
        ],
        outro: 'journey_end'
      },
      prompts: {
        journey_welcome: "Welcome to your reflection journey!",
        current_feeling: "How are you feeling right now?",
        experience_choice: "What experience stands out to you?",
        deep_thought: "What does this make you think about?",
        growth_feeling: "How much have you grown?"
      }
    }
  };
  
  // Match game templates to pillars
  export const pillarGameMapping = {
    cognitive: ['challengeQuest', 'discoveryMission'],
    emotional: ['reflectionJourney', 'storyAdventure'],
    physical: ['challengeQuest', 'discoveryMission'],
    talent: ['creativeBuilder', 'discoveryMission'],
    character: ['storyAdventure', 'reflectionJourney'],
    future: ['discoveryMission', 'creativeBuilder']
  };
  
  // Generate activity questions based on game template
  export function generateGameActivity(pillar, topic, childName, gameTemplateId = null) {
    // Select template based on pillar or use provided one
    const availableTemplates = pillarGameMapping[pillar] || ['discoveryMission'];
    const templateId = gameTemplateId || availableTemplates[Math.floor(Math.random() * availableTemplates.length)];
    const template = gameTemplates[templateId];
  
    return {
      game_template: templateId,
      title: `${template.name}: ${topic}`,
      description: `${template.description} - ${topic}`,
      icon: template.icon,
      estimated_time: '8-12 minutes',
      questions: template.structure.questions.map((q, index) => ({
        id: index + 1,
        type: q.type,
        format: q.format,
        question: generateQuestionText(pillar, topic, q.format, childName),
        ...(q.type === 'choice' && { 
          options: generateChoiceOptions(pillar, q.format) 
        }),
        ...(q.type === 'scale' && {
          min: 1,
          max: 5,
          labels: getScaleLabels(q.format)
        })
      }))
    };
  }
  
  function generateQuestionText(pillar, topic, format, childName) {
    const questions = {
      narrative_choice: `You're exploring ${topic}. What would you do first?`,
      character_thought: `Imagine you're someone who loves ${topic}. How would they feel?`,
      what_happens_next: `As you continue with ${topic}, what happens next?`,
      your_ending: `How would your ${topic} adventure end?`,
      
      strategy: `What's your best approach to ${topic}?`,
      confidence_meter: `How confident do you feel about ${topic}?`,
      action_plan: `What steps would you take with ${topic}?`,
      final_challenge: `If you could master ${topic}, what would you do?`,
      
      initial_thought: `What do you already know about ${topic}?`,
      exploration_path: `How would you like to explore ${topic}?`,
      discovery_scale: `How excited are you to learn about ${topic}?`,
      big_discovery: `What's something cool you'd like to discover about ${topic}?`,
      
      vision: `If you could create something with ${topic}, what would it be?`,
      materials: `What would help you with ${topic}?`,
      creation_process: `How would you make ${topic} even better?`,
      satisfaction: `How happy does ${topic} make you feel?`,
      
      current_feeling: `When you think about ${topic}, how do you feel?`,
      experience_choice: `What about ${topic} interests you most?`,
      deep_thought: `What does ${topic} make you think about?`,
      growth_feeling: `How much do you want to grow in ${topic}?`
    };
    
    return questions[format] || `Tell me about ${topic}!`;
  }
  
  function generateChoiceOptions(pillar, format) {
    const optionSets = {
      narrative_choice: [
        'Jump in and explore!',
        'Think about it first',
        'Ask someone for ideas',
        'Try something creative'
      ],
      what_happens_next: [
        'Something exciting happens',
        'I learn something new',
        'I help someone',
        'I create something cool'
      ],
      strategy: [
        'Try my best and learn as I go',
        'Practice a little each day',
        'Find someone to help me',
        'Make it fun and creative'
      ],
      final_challenge: [
        'Share it with others',
        'Keep getting better at it',
        'Teach someone else',
        'Use it to help people'
      ],
      exploration_path: [
        'Try it myself',
        'Learn from others',
        'Experiment and play',
        'Think about it deeply'
      ],
      materials: [
        'My imagination',
        'Help from others',
        'Practice and effort',
        'Trying new things'
      ],
      experience_choice: [
        'Learning new things',
        'The challenge',
        'Helping others',
        'Being creative'
      ]
    };
    
    return optionSets[format] || [
      'Yes, definitely!',
      'Maybe, sometimes',
      'Not really',
      'I\'m not sure yet'
    ];
  }
  
  function getScaleLabels(format) {
    const labels = {
      confidence_meter: ['Not sure yet', 'Super confident!'],
      discovery_scale: ['A little', 'So much!'],
      satisfaction: ['Could be better', 'Amazing!'],
      growth_feeling: ['A little bit', 'A whole lot!']
    };
    
    return labels[format] || ['Not much', 'A lot!'];
  }