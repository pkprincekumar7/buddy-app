import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Star, Rocket, Clock, ThumbsUp, ThumbsDown, ChevronRight, Brain, Heart, Dumbbell, Palette, Target, Compass, Zap, Award, MessageSquare, RefreshCw, CheckCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import TextareaWithVoice from '../shared/TextareaWithVoice';
import { api } from '@/api/client';
import MissionMiniGame from '../missions/MissionMiniGame';
import { toast } from 'sonner';
import ChildActivityGame from './ChildActivityGame';
import { createPageUrl } from '@/utils';

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

export default function RecommendationsPhase({ data, profile, recommendations, onActivityAdd, onRegisterBack, onPhaseBack }) {
  // Text-to-speech function
  const speak = (text) => {
    if (typeof window === 'undefined') return;
    if (!window.ttsEnabled) return;
    if (!voiceEnabled) return;
    
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[🌟💪😊🎉👋✨🚀🌱]/g, '').replace(/\n/g, ' ');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1;
    
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => 
      v.name.includes('Google US English Female') ||
      v.name.includes('Google UK English Female') ||
      v.name.includes('Samantha') ||
      v.name.includes('Karen') ||
      v.name.includes('Moira') ||
      v.name.includes('Fiona') ||
      v.name.includes('Serena') ||
      (v.name.includes('Microsoft') && v.name.includes('Zira')) ||
      (v.name.includes('Microsoft') && v.name.includes('Eva'))
    ) || voices.find(v => 
      v.lang.startsWith('en') && !v.localService
    ) || voices.find(v => 
      v.lang.startsWith('en')
    );
    
    if (preferredVoice) utterance.voice = preferredVoice;
    window.speechSynthesis.speak(utterance);
  };

  // Load saved progress from localStorage
  const getSavedProgress = () => {
    try {
      const saved = localStorage.getItem('recommendations_progress');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  };

  const savedProgress = getSavedProgress();

  const [step, setStep] = useState(savedProgress?.step || 'intro');
  // Restore selectedArea by ID to avoid losing the icon component reference
  const [selectedArea, setSelectedArea] = useState(
    savedProgress?.selectedArea?.id
      ? growthAreas.find(a => a.id === savedProgress.selectedArea.id) || null
      : null
  );
  const [selectedActivity, setSelectedActivity] = useState(savedProgress?.selectedActivity || null);
  const [parentLiked, setParentLiked] = useState(savedProgress?.parentLiked || null);
  const [wantChildActivity, setWantChildActivity] = useState(savedProgress?.wantChildActivity || null);
  const [feedback, setFeedback] = useState(savedProgress?.feedback || '');
  const [currentAreaIndex, setCurrentAreaIndex] = useState(savedProgress?.currentAreaIndex || 0);
  const [interactiveStep, setInteractiveStep] = useState(savedProgress?.interactiveStep || 0);
  const [interactiveAnswers, setInteractiveAnswers] = useState(savedProgress?.interactiveAnswers || {});
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [generatedActivity, setGeneratedActivity] = useState(savedProgress?.generatedActivity || null);
  const [showGame, setShowGame] = useState(savedProgress?.showGame || false);
  const [showChildGame, setShowChildGame] = useState(false);
  const [childGameResults, setChildGameResults] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [aiRecommendations, setAiRecommendations] = useState(null);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

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
          setInteractiveStep(0);
          setInteractiveAnswers({});
          setStep('interactive_activity');
        } else {
          setStep('area_selection');
        }
      });
    }
  });

  // Refs for voice control
  const introHasSpoken = useRef(false);
  const summaryHasSpoken = useRef(false);

  // Save progress to localStorage whenever state changes
  useEffect(() => {
    const progress = {
      step,
      selectedArea,
      selectedActivity,
      parentLiked,
      wantChildActivity,
      feedback,
      currentAreaIndex,
      interactiveStep,
      interactiveAnswers,
      generatedActivity,
      showGame
    };
    localStorage.setItem('recommendations_progress', JSON.stringify(progress));
  }, [step, selectedArea, selectedActivity, parentLiked, wantChildActivity, feedback, currentAreaIndex, interactiveStep, interactiveAnswers, generatedActivity, showGame]);

  // Helper to persist a completed growth area into localStorage
  const saveCompletedGrowthArea = (area, answers, recommendations) => {
    const existing = JSON.parse(localStorage.getItem('completed_growth_areas') || '[]');
    const updated = existing.filter(a => a.id !== area.id);
    updated.push({ id: area.id, name: area.name, color: area.color, answers, recommendations });
    localStorage.setItem('completed_growth_areas', JSON.stringify(updated));
  };

  // Speak full profile on intro
  useEffect(() => {
    if (step === 'intro' && !introHasSpoken.current && profile) {
      const strengthsText = profile.top_strengths?.map((s, i) => `Strength ${i + 1}: ${s.strength}. ${s.description}`).join('. ') || '';
      const primaryType = profile.personality_type?.split(' - ')[1] || profile.personality_type || '';
      const summaryAlreadyContainsType = primaryType && profile.summary?.toLowerCase().includes(primaryType.toLowerCase());
      const fullText = summaryAlreadyContainsType
        ? `${data.name}'s profile. ${profile.summary}. Emerging strengths: ${strengthsText}`
        : `${data.name}'s personality type is ${primaryType}. ${profile.summary}. Emerging strengths: ${strengthsText}`;
      speak(fullText);
      introHasSpoken.current = true;
    }
  }, [step, profile]);

  const renderIntro = () => {
    return (
      <div className="space-y-8">
        {/* Header */}
          <div className="text-center">
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200 }}
            className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center"
          >
            <Sparkles className="w-12 h-12 text-white" />
          </motion.div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Your Personalized Journey</h2>
          <p className="text-slate-500">Here's what we've discovered about {data.name}</p>
        </div>

        {/* Profile Summary Card */}
          {profile && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm"
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center flex-shrink-0">
                <Star className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-800">{data.name}'s Profile</h3>
                <p className="text-teal-600 text-sm font-medium">{profile.personality_type?.split(' - ')[1] || profile.personality_type}</p>
              </div>
            </div>
            
            <p className="text-slate-600 mb-6 leading-relaxed">{profile.summary}</p>
            
            {/* Top Strengths */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Emerging Strengths</p>
              {profile.top_strengths?.map((strength, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-start gap-3 bg-slate-50 rounded-xl p-3 border border-slate-100"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-600 font-bold text-sm">{index + 1}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{strength.strength}</p>
                    <p className="text-sm text-slate-500 mt-0.5">{strength.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Explore Growth Areas Prompt */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}

          className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-3xl p-6 border border-purple-200"
        >
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Compass className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-800">
              Do you want to explore the specific growth areas for {data.name} to become their best version?
            </h3>
            <p className="text-slate-600">
              Discover personalized activities to help {data.name} develop key life skills
            </p>
            
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
              <Button 
                onClick={() => setStep('area_selection')}
                className="h-12 px-8 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
              >
                <Zap className="w-5 h-5 mr-2" />
                Continue Now
              </Button>
              <Button 
                variant="outline"
                onClick={() => {
                  window.location.href = createPageUrl('Home');
                }}
                className="h-12 px-8 rounded-2xl border-2"
              >
                <Clock className="w-5 h-5 mr-2" />
                Catch Up Later
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  const renderAreaSelection = () => {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Growth Areas</h2>
          <p className="text-slate-500">Choose an area to explore for {data.name}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {growthAreas.map((area, i) => {
            const Icon = area.icon;
            return (
              <motion.button
                key={area.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                onClick={() => {
                  setSelectedArea(area);
                  setCurrentAreaIndex(i);
                  setInteractiveStep(0);
                  setInteractiveAnswers({});
                  setCurrentAnswer('');
                  setParentLiked(null);
                  setChildGameResults(null);
                  setShowGame(false);
                  setStep('interactive_activity');
                }}
                className={`p-4 rounded-2xl border-2 text-left transition-all hover:shadow-md bg-white border-slate-200 hover:border-purple-300`}
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${area.color} flex items-center justify-center mb-3`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-slate-800 text-sm">{area.name}</h4>
                <p className="text-xs text-slate-500 mt-1">{area.description}</p>
              </motion.button>
            );
          })}
        </div>

        <div className="text-center pt-2" />
      </div>
    );
  };

  const renderActivitySelection = () => {
    const activities = sampleActivities[selectedArea?.id] || [];
    const Icon = selectedArea?.icon || Target;

    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className={`w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br ${selectedArea?.color} flex items-center justify-center mb-4`}>
            <Icon className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">{selectedArea?.name}</h2>
          <p className="text-slate-500">Choose an activity to try with {data.name}</p>
        </div>

        <div className="space-y-3">
          {activities.map((activity, index) => (
            <motion.button
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => {
                setSelectedActivity(activity);
                setStep('parent_activity');
              }}
              className={`w-full p-4 rounded-2xl border-2 text-left transition-all hover:shadow-md ${
                selectedActivity?.title === activity.title 
                  ? 'border-purple-500 bg-purple-50' 
                  : 'border-slate-200 bg-white hover:border-purple-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h4 className="font-semibold text-slate-800">{activity.title}</h4>
                  <p className="text-sm text-slate-500 mt-1">{activity.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs px-2 py-1 bg-slate-100 rounded-full text-slate-600">
                      ⏱ {activity.duration}
                    </span>
                    <span className="text-xs px-2 py-1 bg-purple-100 rounded-full text-purple-600 capitalize">
                      {activity.type}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400" />
              </div>
            </motion.button>
          ))}
        </div>

        <div className="text-center pt-4">
          <Button variant="ghost" onClick={() => setStep('area_selection')}>
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
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`bg-gradient-to-br ${selectedArea?.color} rounded-3xl p-6 text-white`}
        >
          <div className="text-center space-y-4">
            <Award className="w-12 h-12 mx-auto" />
            <h2 className="text-2xl font-bold">{selectedActivity?.title}</h2>
            <p className="text-white/90">{selectedActivity?.description}</p>
            <div className="flex justify-center gap-4 pt-2">
              <span className="px-3 py-1 bg-white/20 rounded-full text-sm">
                ⏱ {selectedActivity?.duration}
              </span>
            </div>
          </div>
        </motion.div>

        <div className="bg-white rounded-3xl p-6 border border-slate-200 space-y-4">
          <h3 className="font-bold text-slate-800 text-center">Did you like this activity suggestion?</h3>
        
        <div className="flex justify-center gap-4">
          <Button
            onClick={() => {
              setParentLiked(true);
              setStep('child_activity_prompt');
            }}
            className="h-14 px-8 rounded-2xl bg-emerald-500 hover:bg-emerald-600"
          >
            <ThumbsUp className="w-5 h-5 mr-2" />
            Yes, I like it!
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setParentLiked(false);
              setStep('feedback');
            }}
            className="h-14 px-8 rounded-2xl border-2"
          >
            <ThumbsDown className="w-5 h-5 mr-2" />
            Not quite
          </Button>
        </div>
      </div>

      <div className="text-center">
        <Button variant="ghost" onClick={() => setStep('activity_selection')}>
          ← Choose Different Activity
        </Button>
      </div>
    </div>
    );
  };

  const renderFeedback = () => {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-800 mb-2">We'd love your feedback</h2>
          <p className="text-slate-500">What kind of activity would you like for {data.name}?</p>
        </div>

      <div className="bg-white rounded-3xl p-6 border border-slate-200 space-y-4">
        <TextareaWithVoice
          placeholder="Tell us what you're looking for... (e.g., more interactive, shorter duration, different topic)"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="min-h-[120px] rounded-xl pr-14"
        />
        
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setStep('activity_selection')}>
            Go Back
          </Button>
          <Button 
            onClick={() => setStep('activity_selection')}
            className="bg-purple-500 hover:bg-purple-600"
          >
            Submit & Try Another
          </Button>
        </div>
      </div>
    </div>
    );
  };

  const renderChildActivityPrompt = () => {
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-3xl p-6 border border-emerald-200"
        >
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">
              Do you want {data.name} to take a fun activity on {selectedArea?.name}?
            </h2>
          <p className="text-slate-600">
            {data.name} can complete this as a game on their device
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button 
              onClick={() => setStep('results')}
              className="h-12 px-8 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              Yes, Start Activity
            </Button>
            <Button 
              variant="outline"
              onClick={() => {
                window.location.href = createPageUrl('Home');
              }}
              className="h-12 px-8 rounded-2xl border-2"
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
      <div className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring" }}
          className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center"
        >
          <Award className="w-10 h-10 text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Activity Results Preview</h2>
        <p className="text-slate-500">Here's what you'll see after {data.name} completes activities</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl p-6 border border-slate-200 space-y-4"
      >
        <div className="text-center">
          <p className="text-sm text-slate-500 uppercase tracking-wide mb-2">{selectedArea?.name} Quotient</p>
          <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-600">
            --
          </div>
          <p className="text-sm text-slate-500 mt-1">Score will appear after activity</p>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h4 className="font-semibold text-slate-800 mb-3">Personalized Recommendations</h4>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-slate-200 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-200 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-slate-200 rounded animate-pulse w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-center py-4"
      >
        <p className="text-slate-600">
          🎉 You're all set! Click <span className="font-semibold text-teal-600">"Start the Journey"</span> to go to your dashboard.
        </p>
      </motion.div>
    </div>
  );

  const renderInteractiveActivity = () => {
    const questions = areaQuestions[selectedArea?.id] || areaQuestions.life_ambition;
    const currentQuestion = questions[interactiveStep];
    const questionText = currentQuestion?.question.replace('{name}', data.name);
    const isLastQuestion = interactiveStep === questions.length - 1;
    const AreaIcon = selectedArea?.icon || Rocket;

    return (
      <div className="space-y-6">
        {/* Progress */}
        <div className="text-center">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-4 bg-gradient-to-r ${selectedArea?.color || 'from-purple-500 to-indigo-600'} bg-opacity-10`} style={{background: 'rgba(16,185,129,0.08)'}}>
            <AreaIcon className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-700">{selectedArea?.name} Activity</span>
          </div>
          <div className="flex justify-center gap-1 mb-2">
            {questions.map((_, i) => (
              <div 
                key={i} 
                className={`h-2 w-10 rounded-full transition-all ${
                  i === interactiveStep ? 'bg-purple-500' : i < interactiveStep ? 'bg-emerald-400' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
          <p className="text-sm text-slate-500">Question {interactiveStep + 1} of {questions.length}</p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={interactiveStep}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-3xl p-6 border border-slate-200 shadow-lg"
          >
            {/* Question */}
            <div className="mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">{questionText}</h3>
            </div>

            {/* Answer Input */}
            <div className="space-y-4">
              {currentQuestion?.type === 'text' ? (
                <TextareaWithVoice
                  value={currentAnswer}
                  onChange={(e) => setCurrentAnswer(e.target.value)}
                  placeholder={currentQuestion?.placeholder}
                  className="min-h-[100px] rounded-xl text-lg pr-14"
                />
              ) : (
                <div className="space-y-2">
                  {currentQuestion?.options?.map((option) => (
                    <button
                      key={option}
                      onClick={() => {
                        const newAnswers = { ...interactiveAnswers, [currentQuestion.id]: option };
                        setInteractiveAnswers(newAnswers);
                        setCurrentAnswer('');
                        if (isLastQuestion) {
                          setStep('activity_summary');
                        } else {
                          setInteractiveStep(interactiveStep + 1);
                        }
                      }}
                      className="w-full p-4 rounded-xl text-left transition-all bg-slate-50 border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50"
                    >
                      <span className="font-medium">{option}</span>
                    </button>
                  ))}
                </div>
              )}
              {currentQuestion?.type === 'text' && (
                <Button
                  onClick={() => {
                    if (currentAnswer.trim()) {
                      setInteractiveAnswers({ ...interactiveAnswers, [currentQuestion.id]: currentAnswer });
                      setCurrentAnswer('');
                      if (isLastQuestion) {
                        setStep('activity_summary');
                      } else {
                        setInteractiveStep(interactiveStep + 1);
                      }
                    }
                  }}
                  disabled={!currentAnswer.trim()}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
                >
                  {isLastQuestion ? 'See Summary' : 'Next Question'}
                  <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <div />
      </div>
    );
  };

  const generateAiRecommendations = async (childResults) => {
    setLoadingRecommendations(true);
    const questions = areaQuestions[selectedArea?.id] || areaQuestions.life_ambition;
    const qaContext = questions
      .filter(q => interactiveAnswers[q.id])
      .map(q => `Q: ${q.question.replace('{name}', data.name)}\nA: ${interactiveAnswers[q.id]}`)
      .join('\n\n');

    const childContext = childResults
      ? `\n\nChild's game responses:\nSummary: ${childResults.recommendations?.summary || ''}\nStrengths observed: ${(childResults.recommendations?.strengths || []).join(', ')}\nSuggested activities from game: ${(childResults.recommendations?.activities || []).join(', ')}`
      : '';

    const result = await api.integrations.Core.InvokeLLM({
      prompt: `Based on the following parent responses and child's game activity responses about "${data.name}" in the growth area "${selectedArea?.name}", generate 5 practical 3-month recommendations that synthesize both perspectives.\n\nParent responses:\n${qaContext}${childContext}\n\nReturn ONLY a JSON object with a "recommendations" array of 5 short, actionable bullet points (1-2 sentences each) specific to the "${selectedArea?.name}" growth area.`,
      response_json_schema: {
        type: "object",
        properties: {
          recommendations: { type: "array", items: { type: "string" } }
        }
      }
    });
    setAiRecommendations(result.recommendations);
    setLoadingRecommendations(false);
  };

  // Summary is displayed visually, no TTS needed for summary page

  const renderActivitySummary = () => {
    const questions = areaQuestions[selectedArea?.id] || areaQuestions.life_ambition;
    const AreaIcon = selectedArea?.icon || Award;

    return (
      <div className="space-y-6">
      <div className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring" }}
          className={`w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br ${selectedArea?.color || 'from-emerald-400 to-teal-500'} flex items-center justify-center`}
        >
          <AreaIcon className="w-10 h-10 text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Great Insights!</h2>
        <p className="text-slate-500">Here's what we learned about {data.name}'s {selectedArea?.name}</p>
      </div>

      <div className="bg-white rounded-3xl p-6 border border-slate-200 space-y-4">
        {questions.map((q, i) => {
          const answer = interactiveAnswers[q.id];
          if (!answer) return null;
          return (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="border-b border-slate-100 pb-4 last:border-0"
            >
              <p className="text-sm text-slate-500 mb-1">{q.question.replace('{name}', data.name)}</p>
              <p className="text-slate-800 font-medium">{answer}</p>
            </motion.div>
          );
        })}
      </div>

      {!parentLiked && !showGame && !childGameResults && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <Button
              onClick={() => setParentLiked(true)}
              className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              Explore Child Activity
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                saveCompletedGrowthArea(selectedArea, interactiveAnswers, null);
                setStep('area_selection');
                setParentLiked(null);
              }}
              className="flex-1 h-12 rounded-2xl border-2"
            >
              Next Growth Area
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              saveCompletedGrowthArea(selectedArea, interactiveAnswers, null);
              window.location.href = createPageUrl('LifePathway');
            }}
            className="w-full h-12 rounded-2xl border-2 border-teal-300 text-teal-700 hover:bg-teal-50"
          >
            <ChevronRight className="w-5 h-5 mr-2" />
            Go to Life Journey
          </Button>
        </div>
      )}

      {parentLiked === true && !showGame && !childGameResults && (
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => setShowGame(true)}
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
          >
            Present a fun game to {data.name} on the same topic
          </Button>
          <Button
            onClick={() => {
              saveCompletedGrowthArea(selectedArea, interactiveAnswers, null);
              setStep('area_selection');
              setParentLiked(null);
            }}
            variant="outline"
            className="w-full h-12 rounded-2xl border-2"
          >
            Explore Later
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              saveCompletedGrowthArea(selectedArea, interactiveAnswers, null);
              window.location.href = createPageUrl('LifePathway');
            }}
            className="w-full h-12 rounded-2xl border-2 border-teal-300 text-teal-700 hover:bg-teal-50"
          >
            <ChevronRight className="w-5 h-5 mr-2" />
            Go to Life Journey
          </Button>
        </div>
      )}

      {/* Child Game */}
      {showGame && !childGameResults && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 border-2 border-emerald-200 shadow-lg"
        >
          <ChildActivityGame
            childName={data.name}
            areaId={selectedArea?.id}
            onComplete={(results) => {
              setChildGameResults(results);
              setShowGame(false);
            }}
          />
        </motion.div>
      )}

      {/* Results Display */}
      {childGameResults && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-3xl p-6 border-2 border-emerald-200">
                <div className="text-center mb-4">
                  <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-3">
                    <Sparkles className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Recommendations for {data.name}</h3>
                </div>

                <div className="bg-white rounded-2xl p-4 mb-4">
                  <h4 className="font-semibold text-slate-800 mb-2">What This Reveals</h4>
                  <p className="text-slate-600 text-sm">{childGameResults.recommendations.summary}</p>
                </div>

                <div className="bg-white rounded-2xl p-4 mb-4">
                  <h4 className="font-semibold text-slate-800 mb-2">Suggested Activities</h4>
                  <ul className="space-y-2">
                    {childGameResults.recommendations.activities.map((activity, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="text-emerald-500 mt-1">✓</span>
                        <span>{activity}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-white rounded-2xl p-4">
                  <h4 className="font-semibold text-slate-800 mb-2">Strengths to Encourage</h4>
                  <ul className="space-y-2">
                    {childGameResults.recommendations.strengths.map((strength, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                        <span className="text-emerald-500 mt-1">★</span>
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 3-Month Recommendations */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-3xl p-6 border border-emerald-200"
              >
                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
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
                  <div className="flex items-center gap-3 py-4">
                    <RefreshCw className="w-5 h-5 text-emerald-500 animate-spin" />
                    <p className="text-slate-600 text-sm">Generating personalized recommendations...</p>
                  </div>
                )}

                {aiRecommendations && (
                  <ul className="space-y-3">
                    {aiRecommendations.map((rec, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className="flex items-start gap-3 text-sm text-slate-700"
                      >
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500 text-white text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                        <span>{rec}</span>
                      </motion.li>
                    ))}
                  </ul>
                )}
              </motion.div>

              <div className="flex flex-col gap-3">
              <Button
                onClick={() => {
                  saveCompletedGrowthArea(selectedArea, interactiveAnswers, aiRecommendations);
                  if (currentAreaIndex < growthAreas.length - 1) {
                    setCurrentAreaIndex(currentAreaIndex + 1);
                    setStep('area_selection');
                    setShowGame(false);
                    setShowChildGame(false);
                    setChildGameResults(null);
                    setAiRecommendations(null);
                    setParentLiked(null);
                  } else {
                    window.location.href = createPageUrl('LifePathway');
                  }
                }}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
              >
                {currentAreaIndex < growthAreas.length - 1 ? 'Explore More Growth Areas' : 'Explore Life Journey'}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  saveCompletedGrowthArea(selectedArea, interactiveAnswers, aiRecommendations);
                  window.location.href = createPageUrl('LifePathway');
                }}
                className="w-full h-12 rounded-2xl border-2 border-teal-300 text-teal-700 hover:bg-teal-50"
              >
                <ChevronRight className="w-5 h-5 mr-2" />
                Go to Life Journey
              </Button>
              </div>
            </motion.div>
          )}
    </div>
    );
  };

  const renderSkip = () => (
    <div className="space-y-6 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center"
      >
        <Sparkles className="w-10 h-10 text-white" />
      </motion.div>
      <h2 className="text-2xl font-bold text-slate-800">Ready for the Next Step!</h2>
      <p className="text-slate-600">
        Let's explore the Life Journey designed for {data.name}.
      </p>
      <Button
        onClick={() => {
          window.location.href = createPageUrl('LifePathway');
        }}
        className="h-12 px-8 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
      >
        Continue to Life Journey
        <ChevronRight className="w-5 h-5 ml-2" />
      </Button>
    </div>
  );

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
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