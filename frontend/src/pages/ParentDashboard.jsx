import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/api/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { 
  User, Settings, Bell, Plus, ChevronRight, 
  Calendar, Target, BookOpen, MessageSquare,
  TrendingUp, Sparkles, RefreshCw, Users, MessageCircle
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import GrowthRoadmap from '../components/dashboard/GrowthRoadmap';
import PillarProgress from '../components/dashboard/PillarProgress';
import InsightCard from '../components/dashboard/InsightCard';
import WeeklyMissions from '../components/missions/WeeklyMissions';
import GrowthTree from '../components/shared/GrowthTree';
import { avatars } from '../components/shared/AvatarSelector';
import AvatarChatbot from '../components/shared/AvatarChatbot';
import ParentChildAssignment from '../components/assignments/ParentChildAssignment';
import ParentObservationModal from '../components/missions/ParentObservationModal';
import MissionInsightsCard from '../components/dashboard/MissionInsightsCard';

export default function ParentDashboard() {
  const queryClient = useQueryClient();
  const [showChatbot, setShowChatbot] = useState(false);
  const [showAssignments, setShowAssignments] = useState(false);
  const [selectedMission, setSelectedMission] = useState(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  
  const { data: children = [], isLoading: loadingChildren } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date')
  });
  
  const activeChild = children[0];
  
  const { data: missions = [], isLoading: loadingMissions } = useQuery({
    queryKey: ['missions', activeChild?.id],
    queryFn: () => activeChild ? api.entities.GrowthMission.filter({ child_id: activeChild.id }, '-created_date', 20) : [],
    enabled: !!activeChild
  });
  
  const { data: insights = [], isLoading: loadingInsights } = useQuery({
    queryKey: ['insights', activeChild?.id],
    queryFn: () => activeChild ? api.entities.ParentInsight.filter({ child_id: activeChild.id, is_read: false }, '-created_date', 5) : [],
    enabled: !!activeChild
  });
  
  const completeMissionMutation = useMutation({
    mutationFn: (mission) => api.entities.GrowthMission.update(mission.id, { status: 'completed', completed_date: new Date().toISOString().split('T')[0] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['missions'] })
  });
  
  const handleMissionView = (mission) => {
    // Check if this is a completed mission that needs parent observation
    if (mission.status === 'completed' && mission.child_responses && mission.child_responses.length > 0 && !mission.ai_insights) {
      setSelectedMission(mission);
    }
  };
  
  const handleParentObservationSubmit = async (observation) => {
    if (!selectedMission) return;
    
    setIsGeneratingInsights(true);
    try {
      const prompt = `Analyze a child's responses to a growth activity along with parent's observation.

Activity: ${selectedMission.title}
Description: ${selectedMission.description}

Child's Responses:
${selectedMission.child_responses.map((r, i) => `${i + 1}. ${r.question}\nAnswer: ${r.answer}`).join('\n\n')}

Parent's Observation:
${observation}

Generate personalized insights focusing on:
1. A brief summary of what the activity revealed
2. 2-3 specific strengths observed
3. 1-2 growth opportunities
4. 2-3 actionable recommendations for parents`;

      const insights = await api.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            strengths_observed: {
              type: "array",
              items: { type: "string" }
            },
            growth_opportunities: {
              type: "array",
              items: { type: "string" }
            },
            recommendations: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });
      
      await api.entities.GrowthMission.update(selectedMission.id, {
        parent_observation: observation,
        ai_insights: insights
      });
      
      // Create a parent insight
      await api.entities.ParentInsight.create({
        child_id: activeChild.id,
        insight_type: 'activity_suggestion',
        title: `Insights from: ${selectedMission.title}`,
        description: insights.summary,
        action_suggestion: insights.recommendations[0]
      });
      
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['insights'] });
      setSelectedMission(null);
    } catch (error) {
      console.error('Failed to generate insights:', error);
    }
    setIsGeneratingInsights(false);
  };
  
  const calculateAge = (dob) => {
    if (!dob) return null;
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };
  
  const getAvatarConfig = (style) => avatars.find(a => a.id === style) || avatars[0];
  
  if (loadingChildren) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <Skeleton className="h-32 rounded-3xl" />
          <div className="grid md:grid-cols-3 gap-6">
            <Skeleton className="h-64 rounded-3xl" />
            <Skeleton className="h-64 rounded-3xl md:col-span-2" />
          </div>
        </div>
      </div>
    );
  }
  
  const handleAssignmentComplete = async (assignmentData) => {
    if (activeChild) {
      const existingInteractions = activeChild.parent_interactions || [];
      await api.entities.Child.update(activeChild.id, {
        parent_interactions: [...existingInteractions, assignmentData]
      });
      queryClient.invalidateQueries({ queryKey: ['children'] });
    }
  };

  if (!activeChild) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
            <Sparkles className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-800 mb-3">Welcome to Buddy360</h1>
          <p className="text-slate-500 mb-8">
            A guided growth platform to help your child discover strengths, build character, and design a meaningful life.
          </p>
          <Link to={createPageUrl('Onboarding')}>
            <Button className="h-14 px-8 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-lg">
              <Plus className="w-5 h-5 mr-2" />
              Start Your Child's Journey
            </Button>
          </Link>
        </motion.div>
      </div>
    );
  }
  
  const avatarConfig = getAvatarConfig(activeChild.avatar_style);
  const AvatarIcon = avatarConfig.icon;
  const childAge = calculateAge(activeChild.date_of_birth);
  
  const thisWeekMissions = missions.filter(m => {
    const weekNum = Math.ceil((new Date().getTime() - new Date(activeChild.created_date).getTime()) / (7 * 24 * 60 * 60 * 1000));
    return m.week_number === weekNum || !m.week_number;
  }).slice(0, 4);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Page Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${avatarConfig.color} flex items-center justify-center`}>
                <AvatarIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">{activeChild.name}'s Journey</h1>
                <p className="text-sm text-slate-500">Age {childAge} • {activeChild.current_phase} phase</p>
              </div>
            </div>
            
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setShowChatbot(true)}>
              <MessageCircle className="w-5 h-5 text-slate-600" />
            </Button>
          </div>
        </div>
      </div>
      
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Streak', value: `${activeChild.streak_days || 0} days`, icon: Target, color: 'from-amber-400 to-orange-500' },
            { label: 'Missions', value: activeChild.total_missions_completed || 0, icon: TrendingUp, color: 'from-emerald-400 to-teal-500' },
            { label: 'This Week', value: `${thisWeekMissions.filter(m => m.status === 'completed').length}/4`, icon: Calendar, color: 'from-blue-400 to-indigo-500' },
            { label: 'Phase', value: activeChild.current_phase, icon: BookOpen, color: 'from-purple-400 to-pink-500' }
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-white rounded-2xl p-4 border border-slate-200 hover:shadow-md transition-shadow"
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center mb-3`}>
                <stat.icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-2xl font-bold text-slate-800 capitalize">{stat.value}</p>
              <p className="text-sm text-slate-500">{stat.label}</p>
            </motion.div>
          ))}
        </div>
        
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Growth Tree */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl p-6 border border-slate-200 flex flex-col items-center"
            >
              <h3 className="font-bold text-slate-800 text-lg mb-4 self-start">Growth Tree</h3>
              <GrowthTree pillarScores={activeChild.pillar_scores} size="lg" />
              <p className="text-sm text-slate-500 mt-4 text-center">
                Watch {activeChild.name}'s tree grow as they complete missions and build skills!
              </p>
            </motion.div>
            
            {/* Roadmap */}
            <GrowthRoadmap currentPhase={activeChild.current_phase} childAge={childAge} />
          </div>
          
          {/* Middle + Right Columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Pillar Progress */}
            <PillarProgress pillarScores={activeChild.pillar_scores} />
            
            {/* Weekly Missions */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-800 text-lg">Weekly Missions</h3>
                <Link to={createPageUrl('Missions')}>
                  <Button variant="ghost" size="sm" className="text-teal-600 hover:text-teal-700">
                    View All <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
              
              {loadingMissions ? (
                <div className="space-y-4">
                  {[1,2].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
                </div>
              ) : thisWeekMissions.length > 0 ? (
                <WeeklyMissions
                  missions={thisWeekMissions}
                  onCompleteMission={(mission) => completeMissionMutation.mutate(mission)}
                  onViewMission={handleMissionView}
                />
              ) : (
                <div className="text-center py-8">
                  <p className="text-slate-500 mb-4">No missions yet this week</p>
                  <Link to={createPageUrl('Missions')}>
                    <Button className="rounded-xl">
                      <Plus className="w-4 h-4 mr-2" />
                      Create Missions
                    </Button>
                  </Link>
                </div>
              )}
            </div>
            
            {/* Parent-Child Activities */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-800 text-lg">Parent-Child Activities</h3>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowAssignments(!showAssignments)}
                  className="text-teal-600 hover:text-teal-700"
                >
                  {showAssignments ? 'Hide' : 'View All'} <ChevronRight className={`w-4 h-4 ml-1 transition-transform ${showAssignments ? 'rotate-90' : ''}`} />
                </Button>
              </div>
              
              {showAssignments ? (
                <ParentChildAssignment 
                  childName={activeChild.name} 
                  onComplete={handleAssignmentComplete}
                />
              ) : (
                <div className="text-center py-6">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
                    <Users className="w-8 h-8 text-purple-500" />
                  </div>
                  <h4 className="font-semibold text-slate-800 mb-1">Strengthen Your Bond</h4>
                  <p className="text-sm text-slate-500 mb-4">
                    Interactive activities to understand {activeChild.name} better
                  </p>
                  <Button 
                    onClick={() => setShowAssignments(true)}
                    className="rounded-xl bg-purple-500 hover:bg-purple-600"
                  >
                    Start an Activity
                  </Button>
                </div>
              )}
            </div>

            {/* Mission Insights */}
            {missions.filter(m => m.ai_insights).length > 0 && (
              <div className="space-y-4">
                <h3 className="font-bold text-slate-800 text-lg">Recent Mission Insights</h3>
                {missions.filter(m => m.ai_insights).slice(0, 2).map((mission, i) => (
                  <motion.div
                    key={mission.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <MissionInsightsCard mission={mission} />
                  </motion.div>
                ))}
              </div>
            )}

            {/* General Insights */}
            {insights.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-bold text-slate-800 text-lg">Parent Insights</h3>
                {insights.map((insight, i) => (
                  <motion.div
                    key={insight.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <InsightCard insight={insight} onAction={() => {}} />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Parent Observation Modal */}
      <AnimatePresence>
        {selectedMission && (
          <ParentObservationModal
            mission={{ ...selectedMission, child_name: activeChild.name }}
            childResponses={selectedMission.child_responses}
            onSubmit={handleParentObservationSubmit}
            onCancel={() => setSelectedMission(null)}
            isGenerating={isGeneratingInsights}
          />
        )}
      </AnimatePresence>

      {/* Floating Chatbot */}
      <AnimatePresence>
        {showChatbot && (
          <AvatarChatbot
            childName={activeChild.name}
            childData={activeChild}
            isParentMode={true}
            onClose={() => setShowChatbot(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}