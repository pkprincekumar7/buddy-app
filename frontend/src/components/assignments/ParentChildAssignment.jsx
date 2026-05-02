import { useState, useEffect, useRef } from 'react';
import { api } from '@/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, Users, School, Heart, Play, CheckCircle, Clock, Sparkles } from 'lucide-react';

const assignmentScenarios = [
  {
    id: 'friends_interaction',
    title: 'Friend Stories',
    icon: Users,
    color: 'from-blue-400 to-indigo-500',
    prompt: "Ask your child: Tell me about something fun that happened with your friends recently. What did you enjoy most about it?",
    followUp: "What did your friends say they like about you?",
    category: 'social',
    duration: '5-10 min'
  },
  {
    id: 'teacher_feedback',
    title: 'School Highlights',
    icon: School,
    color: 'from-emerald-400 to-teal-500',
    prompt: "Ask your child: What did your teacher say about your work this week? What made them happy?",
    followUp: "Is there something you want to get better at in class?",
    category: 'academic',
    duration: '5-10 min'
  },
  {
    id: 'helping_others',
    title: 'Kindness Moments',
    icon: Heart,
    color: 'from-rose-400 to-pink-500',
    prompt: "Ask your child: Did you help anyone today or this week? How did it make you feel?",
    followUp: "Who do you like helping the most? Why?",
    category: 'character',
    duration: '5 min'
  },
  {
    id: 'problem_solving',
    title: 'Challenge Champion',
    icon: Sparkles,
    color: 'from-amber-400 to-orange-500',
    prompt: "Ask your child: Tell me about a problem you solved recently. How did you figure it out?",
    followUp: "What do you do when something is really hard?",
    category: 'cognitive',
    duration: '5-10 min'
  },
  {
    id: 'dreams_goals',
    title: 'Dream Talk',
    icon: Sparkles,
    color: 'from-purple-400 to-violet-500',
    prompt: "Ask your child: If you could be amazing at anything, what would it be? Why?",
    followUp: "What would you do with that skill?",
    category: 'future',
    duration: '10 min'
  }
];

export default function ParentChildAssignment({ childName, onComplete, currentAssignment }) {
  const [selectedAssignment, setSelectedAssignment] = useState(currentAssignment || null);
  const [isRecording, setIsRecording] = useState(false);
  const [notes, setNotes] = useState('');
  const [childResponse, setChildResponse] = useState('');
  const [step, setStep] = useState('select'); // select, conversation, notes, complete
  const ttsEnabledRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await api.preferences.get();
        if (!cancelled && typeof prefs.tts_enabled === 'boolean') {
          ttsEnabledRef.current = prefs.tts_enabled;
        }
      } catch { /* keep default */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleStartAssignment = (assignment) => {
    setSelectedAssignment(assignment);
    setStep('conversation');

    if (ttsEnabledRef.current && typeof window !== 'undefined' && window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(assignment.prompt);
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleComplete = () => {
    onComplete?.({
      assignment: selectedAssignment,
      childResponse,
      parentNotes: notes,
      completedAt: new Date().toISOString()
    });
    setStep('complete');
  };

  if (step === 'complete') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-3xl p-8 border border-emerald-200 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring" }}
          className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-500 flex items-center justify-center"
        >
          <CheckCircle className="w-10 h-10 text-white" />
        </motion.div>
        <h3 className="text-xl font-bold text-emerald-800 mb-2">Great Conversation! 🎉</h3>
        <p className="text-emerald-600 mb-4">
          This interaction helps us understand {childName} better and strengthens your bond.
        </p>
        <Button
          onClick={() => {
            setStep('select');
            setSelectedAssignment(null);
            setNotes('');
            setChildResponse('');
          }}
          className="rounded-xl bg-emerald-500 hover:bg-emerald-600"
        >
          Try Another Activity
        </Button>
      </motion.div>
    );
  }

  if (step === 'conversation' && selectedAssignment) {
    const Icon = selectedAssignment.icon;
    
    return (
      <div className="space-y-6">
        {/* Assignment Header */}
        <div className={`bg-gradient-to-br ${selectedAssignment.color} rounded-3xl p-6 text-white`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg">{selectedAssignment.title}</h3>
              <p className="text-white/80 text-sm flex items-center gap-1">
                <Clock className="w-3 h-3" /> {selectedAssignment.duration}
              </p>
            </div>
          </div>
          
          <div className="bg-white/10 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <MessageCircle className="w-5 h-5 flex-shrink-0 mt-1" />
              <p className="font-medium">{selectedAssignment.prompt}</p>
            </div>
          </div>
        </div>

        {/* Recording Area */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200">
          <h4 className="font-semibold text-slate-800 mb-3">What did {childName} say?</h4>
          <Textarea
            value={childResponse}
            onChange={(e) => setChildResponse(e.target.value)}
            placeholder={`Write down ${childName}'s response here... You can also note their expressions, tone, and body language.`}
            className="min-h-[120px] rounded-xl border-slate-200 mb-4"
          />

          {/* Follow-up prompt */}
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 mb-4">
            <p className="text-sm text-amber-800">
              <strong>Follow-up question:</strong> {selectedAssignment.followUp}
            </p>
          </div>

          {/* Parent notes */}
          <h4 className="font-semibold text-slate-800 mb-3">Your Observations (Optional)</h4>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional observations about their mood, enthusiasm, or anything else you noticed..."
            className="min-h-[80px] rounded-xl border-slate-200"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setStep('select')}
            className="flex-1 h-12 rounded-xl"
          >
            Back
          </Button>
          <Button
            onClick={handleComplete}
            disabled={!childResponse.trim()}
            className="flex-1 h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600"
          >
            Complete Activity
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-bold text-slate-800 mb-2">Parent-Child Activities</h3>
        <p className="text-slate-500">
          These conversations help us understand {childName} better while you bond together
        </p>
      </div>

      <div className="grid gap-4">
        {assignmentScenarios.map((assignment, index) => {
          const Icon = assignment.icon;
          return (
            <motion.button
              key={assignment.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => handleStartAssignment(assignment)}
              className="bg-white rounded-2xl p-5 border border-slate-200 text-left hover:shadow-lg hover:border-slate-300 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${assignment.color} flex items-center justify-center flex-shrink-0`}>
                  <Icon className="w-7 h-7 text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-slate-800 mb-1">{assignment.title}</h4>
                  <p className="text-sm text-slate-500 line-clamp-2">{assignment.prompt}</p>
                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {assignment.duration}
                  </p>
                </div>
                <Play className="w-5 h-5 text-slate-400 group-hover:text-teal-500 transition-colors" />
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}