import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/api/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { 
  ArrowLeft, Star, Sparkles, Flame, Trophy,
  ChevronRight, MessageCircle
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import AvatarChatbot from '../components/shared/AvatarChatbot';
import MissionMiniGame from '../components/missions/MissionMiniGame';

import GrowthTree from '../components/shared/GrowthTree';
import WeeklyMissions from '../components/missions/WeeklyMissions';
import ReflectionPrompt from '../components/reflections/ReflectionPrompt';
import { avatars } from '../components/shared/AvatarSelector';
import { pillarConfig } from '../components/shared/PillarIcon';

export default function ChildMode() {
  const [activeTab, setActiveTab] = useState('missions');
  const [showChatbot, setShowChatbot] = useState(false);
  const [selectedMission, setSelectedMission] = useState(null);
  const queryClient = useQueryClient();
  
  const { data: children = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date')
  });
  
  const activeChild = children[0];
  
  const { data: missions = [] } = useQuery({
    queryKey: ['missions', activeChild?.id],
    queryFn: () => activeChild ? api.entities.GrowthMission.filter({ child_id: activeChild.id }, '-created_date', 20) : [],
    enabled: !!activeChild
  });
  
  const { data: reflections = [] } = useQuery({
    queryKey: ['reflections', activeChild?.id],
    queryFn: () => activeChild ? api.entities.Reflection.filter({ child_id: activeChild.id }, '-created_date', 10) : [],
    enabled: !!activeChild
  });
  
  const completeMissionMutation = useMutation({
    mutationFn: async ({ mission, data }) => {
      await api.entities.GrowthMission.update(mission.id, { 
        status: 'completed', 
        completed_date: new Date().toISOString().split('T')[0],
        child_responses: data.responses || [],
        reflection: data.reflection || '',
        learning_areas: data.learning_areas || ''
      });
      // Update pillar score
      const pillar = mission.pillar;
      const currentScores = activeChild.pillar_scores || {};
      const newScore = Math.min(100, (currentScores[pillar] || 20) + 5);
      await api.entities.Child.update(activeChild.id, {
        pillar_scores: { ...currentScores, [pillar]: newScore },
        total_missions_completed: (activeChild.total_missions_completed || 0) + 1
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['children'] });
      queryClient.invalidateQueries({ queryKey: ['reflections'] });
      setSelectedMission(null);
    }
  });
  
  const handleMissionClick = (mission) => {
    setSelectedMission(mission);
  };
  
  const handleMissionComplete = (data) => {
    if (selectedMission) {
      completeMissionMutation.mutate({ mission: selectedMission, data });
    }
  };
  
  const createReflectionMutation = useMutation({
    mutationFn: (data) => api.entities.Reflection.create({ ...data, child_id: activeChild.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reflections'] })
  });
  
  const getAvatarConfig = (style) => avatars.find(a => a.id === style) || avatars[0];
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 p-4">
        <Skeleton className="h-48 rounded-3xl mb-6" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  }
  
  if (!activeChild) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Sparkles className="w-16 h-16 mx-auto text-purple-400 mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">No Profile Found</h1>
          <p className="text-slate-500 mb-6">Ask your parent to set up your journey first!</p>
          <Link to={createPageUrl('Onboarding')}>
            <Button className="rounded-2xl">Go to Setup</Button>
          </Link>
        </div>
      </div>
    );
  }
  
  const avatarConfig = getAvatarConfig(activeChild.avatar_style);
  const AvatarIcon = avatarConfig.icon;
  
  const activeMissions = missions.filter(m => m.status === 'active').slice(0, 4);
  
  const tabs = [
    { id: 'missions', label: 'Missions', emoji: '🎯' },
    { id: 'reflect', label: 'Reflect', emoji: '💭' },
    { id: 'progress', label: 'My Growth', emoji: '🌱' }
  ];
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      {/* Page Header */}
      <div className="bg-white/60 backdrop-blur-lg border-b border-white/40">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 rounded-full">
                <Flame className="w-4 h-4 text-amber-500" />
                <span className="font-bold text-amber-700">{activeChild.streak_days || 0}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 rounded-full">
                <Star className="w-4 h-4 text-purple-500" />
                <span className="font-bold text-purple-700">{activeChild.total_missions_completed || 0}</span>
              </div>
            </div>
            
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowChatbot(true)}
              className="rounded-full bg-teal-100 hover:bg-teal-200"
            >
              <MessageCircle className="w-5 h-5 text-teal-600" />
            </Button>
          </div>
        </div>
      </div>
      
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Welcome Card */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-6 mb-6 shadow-lg shadow-purple-100/50"
        >
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${avatarConfig.color} flex items-center justify-center shadow-lg`}>
              <AvatarIcon className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Hey, {activeChild.name}! 👋</h1>
              <p className="text-slate-500">Ready for today's adventure?</p>
            </div>
          </div>
        </motion.div>
        
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white text-slate-800 shadow-lg shadow-purple-100/50'
                  : 'bg-white/50 text-slate-600 hover:bg-white/80'
              }`}
            >
              <span className="text-xl">{tab.emoji}</span>
              <span>{tab.label}</span>
            </motion.button>
          ))}
        </div>
        
        {/* Tab Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'missions' && (
            <motion.div
              key="missions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {activeMissions.length > 0 ? (
                <WeeklyMissions
                  missions={activeMissions}
                  onCompleteMission={handleMissionClick}
                  onViewMission={() => {}}
                  isChildMode={true}
                />
              ) : (
                <div className="bg-white rounded-3xl p-8 text-center">
                  <Trophy className="w-16 h-16 mx-auto text-amber-400 mb-4" />
                  <h3 className="text-xl font-bold text-slate-800 mb-2">All Done! 🎉</h3>
                  <p className="text-slate-500">You've completed all your missions. Amazing work!</p>
                </div>
              )}
            </motion.div>
          )}
          
          {activeTab === 'reflect' && (
            <motion.div
              key="reflect"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <ReflectionPrompt 
                onSubmit={(data) => createReflectionMutation.mutate(data)}
                isLoading={createReflectionMutation.isPending}
              />
              
              {reflections.length > 0 && (
                <div className="space-y-4">
                  <h3 className="font-bold text-slate-700">Recent Reflections</h3>
                  {reflections.slice(0, 5).map((reflection, i) => (
                    <motion.div
                      key={reflection.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="bg-white rounded-2xl p-4 border border-slate-200"
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">
                          {reflection.type === 'gratitude' && '💝'}
                          {reflection.type === 'achievement' && '🏆'}
                          {reflection.type === 'learning' && '💡'}
                          {reflection.type === 'feeling' && '😊'}
                          {reflection.type === 'dream' && '✨'}
                        </span>
                        <div>
                          <p className="text-slate-700">{reflection.content}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(reflection.created_date).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
          
          {activeTab === 'progress' && (
            <motion.div
              key="progress"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Growth Tree */}
              <div className="bg-white rounded-3xl p-6 flex flex-col items-center">
                <h3 className="font-bold text-slate-800 text-lg mb-4 self-start">My Growth Tree</h3>
                <GrowthTree pillarScores={activeChild.pillar_scores} size="lg" />
                <p className="text-sm text-slate-500 mt-4 text-center">
                  Keep completing missions to grow your tree! 🌳
                </p>
              </div>
              
              {/* Pillar Progress - Simplified for kids */}
              <div className="bg-white rounded-3xl p-6">
                <h3 className="font-bold text-slate-800 text-lg mb-4">My Superpowers</h3>
                <div className="space-y-4">
                  {Object.entries(pillarConfig).map(([key, config]) => {
                    const score = activeChild.pillar_scores?.[key] || 20;
                    const Icon = config.icon;
                    return (
                      <div key={key} className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl ${config.bgColor} flex items-center justify-center`}>
                          <Icon className={`w-5 h-5 ${config.color}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between mb-1">
                            <span className="text-sm font-medium text-slate-700">{config.label}</span>
                            <span className={`text-sm font-bold ${config.color}`}>{score}%</span>
                          </div>
                          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div
                              className={`h-full bg-gradient-to-r ${config.gradientFrom} ${config.gradientTo} rounded-full`}
                              initial={{ width: 0 }}
                              animate={{ width: `${score}%` }}
                              transition={{ duration: 1 }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mission Mini-Game */}
      <AnimatePresence>
        {selectedMission && (
          <MissionMiniGame
            mission={selectedMission}
            childId={activeChild.id}
            onComplete={handleMissionComplete}
            onCancel={() => setSelectedMission(null)}
          />
        )}
      </AnimatePresence>

      {/* Chatbot */}
      <AnimatePresence>
        {showChatbot && (
          <AvatarChatbot
            childName={activeChild.name}
            childData={activeChild}
            isParentMode={false}
            onClose={() => setShowChatbot(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}