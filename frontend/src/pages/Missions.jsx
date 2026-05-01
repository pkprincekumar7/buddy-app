import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/api/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { 
  ArrowLeft, Plus, Filter, Sparkles, Wand2, Loader2,
  Brain, Heart, Dumbbell, Palette, Star, Rocket
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import WeeklyMissions from '../components/missions/WeeklyMissions';
import { pillarConfig } from '../components/shared/PillarIcon';

const missionTemplates = {
  cognitive: [
    { title: "Read for 20 Minutes", description: "Choose any book and read for 20 minutes", difficulty: "easy" },
    { title: "Solve a Puzzle", description: "Complete a puzzle, brain teaser, or logic game", difficulty: "medium" },
    { title: "Learn Something New", description: "Research and learn about a topic that interests you", difficulty: "medium" }
  ],
  emotional: [
    { title: "Express Gratitude", description: "Tell 3 people something you appreciate about them", difficulty: "easy" },
    { title: "Handle a Challenge", description: "When something goes wrong, take a deep breath and find a solution", difficulty: "medium" },
    { title: "Help Someone", description: "Find a way to help a friend or family member today", difficulty: "easy" }
  ],
  physical: [
    { title: "30 Minutes of Movement", description: "Play a sport, dance, or do any physical activity", difficulty: "easy" },
    { title: "Try a New Activity", description: "Try a physical activity you've never done before", difficulty: "medium" },
    { title: "Healthy Choices", description: "Drink water and eat fruits/vegetables today", difficulty: "easy" }
  ],
  talent: [
    { title: "Create Something", description: "Draw, paint, build, or create anything you want", difficulty: "easy" },
    { title: "Practice a Skill", description: "Spend 20 minutes practicing something you're learning", difficulty: "medium" },
    { title: "Share Your Talent", description: "Show someone what you've been working on", difficulty: "easy" }
  ],
  character: [
    { title: "Keep a Promise", description: "Make a promise and keep it today", difficulty: "easy" },
    { title: "Be Patient", description: "Practice patience when something takes longer than expected", difficulty: "medium" },
    { title: "Do the Right Thing", description: "Make a choice based on what's right, not what's easy", difficulty: "medium" }
  ],
  future: [
    { title: "Career Explorer", description: "Learn about a job that interests you", difficulty: "easy" },
    { title: "Plan Ahead", description: "Write down 3 things you want to accomplish this week", difficulty: "easy" },
    { title: "Learn a Life Skill", description: "Learn to do something practical like cooking or organizing", difficulty: "medium" }
  ]
};

export default function Missions() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [filterPillar, setFilterPillar] = useState('all');
  const [isGenerating, setIsGenerating] = useState(false);
  const [newMission, setNewMission] = useState({
    title: '', description: '', pillar: 'cognitive', difficulty: 'easy'
  });
  
  const queryClient = useQueryClient();
  
  const { data: children = [] } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date')
  });
  
  const activeChild = children[0];
  
  const { data: missions = [], isLoading } = useQuery({
    queryKey: ['missions', activeChild?.id],
    queryFn: () => activeChild ? api.entities.GrowthMission.filter({ child_id: activeChild.id }, '-created_date', 50) : [],
    enabled: !!activeChild
  });
  
  const createMissionMutation = useMutation({
    mutationFn: (data) => api.entities.GrowthMission.create({ ...data, child_id: activeChild.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      setShowAddDialog(false);
      setNewMission({ title: '', description: '', pillar: 'cognitive', difficulty: 'easy' });
    }
  });
  
  const completeMissionMutation = useMutation({
    mutationFn: (mission) => api.entities.GrowthMission.update(mission.id, { 
      status: 'completed', 
      completed_date: new Date().toISOString().split('T')[0] 
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['missions'] })
  });
  
  const generateWeeklyMissions = async () => {
    if (!activeChild) return;
    setIsGenerating(true);
    
    const weekNum = Math.ceil((new Date().getTime() - new Date(activeChild.created_date).getTime()) / (7 * 24 * 60 * 60 * 1000));
    
    // Generate one mission per pillar area (balanced approach)
    const pillars = ['cognitive', 'emotional', 'physical', 'talent'];
    const missionsToCreate = pillars.map(pillar => {
      const templates = missionTemplates[pillar];
      const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
      return {
        ...randomTemplate,
        pillar,
        child_id: activeChild.id,
        week_number: weekNum,
        status: 'active'
      };
    });
    
    await api.entities.GrowthMission.bulkCreate(missionsToCreate);
    queryClient.invalidateQueries({ queryKey: ['missions'] });
    setIsGenerating(false);
  };
  
  const filteredMissions = filterPillar === 'all' 
    ? missions 
    : missions.filter(m => m.pillar === filterPillar);
  
  const PillarIcon = ({ pillar }) => {
    const icons = { cognitive: Brain, emotional: Heart, physical: Dumbbell, talent: Palette, character: Star, future: Rocket };
    const Icon = icons[pillar] || Brain;
    return <Icon className="w-4 h-4" />;
  };
  
  if (!activeChild) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-slate-500 mb-4">No child profile found</p>
          <Link to={createPageUrl('Onboarding')}>
            <Button>Set Up Profile</Button>
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to={createPageUrl('ParentDashboard')}>
                <Button variant="ghost" size="icon" className="rounded-xl">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Growth Missions</h1>
                <p className="text-sm text-slate-500">{missions.length} total missions</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                onClick={generateWeeklyMissions}
                disabled={isGenerating}
                className="rounded-xl hidden sm:flex"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4 mr-2" />
                )}
                Generate Week
              </Button>
              <Button 
                onClick={() => setShowAddDialog(true)}
                className="rounded-xl bg-slate-800 hover:bg-slate-900"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Mission
              </Button>
            </div>
          </div>
        </div>
      </header>
      
      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Filter */}
        <div className="flex items-center gap-3 mb-6 overflow-x-auto pb-2">
          <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <button
            onClick={() => setFilterPillar('all')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
              filterPillar === 'all' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            All
          </button>
          {Object.entries(pillarConfig).map(([key, config]) => (
            <button
              key={key}
              onClick={() => setFilterPillar(key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                filterPillar === key 
                  ? `${config.bgColor} ${config.color}` 
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <PillarIcon pillar={key} />
              {config.label}
            </button>
          ))}
        </div>
        
        {/* Missions */}
        {isLoading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
        ) : filteredMissions.length > 0 ? (
          <WeeklyMissions
            missions={filteredMissions}
            onCompleteMission={(mission) => completeMissionMutation.mutate(mission)}
            onViewMission={() => {}}
          />
        ) : (
          <div className="bg-white rounded-3xl p-12 text-center">
            <Sparkles className="w-16 h-16 mx-auto text-purple-400 mb-4" />
            <h3 className="text-xl font-bold text-slate-800 mb-2">No Missions Yet</h3>
            <p className="text-slate-500 mb-6">Create missions or generate a week of balanced activities</p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={generateWeeklyMissions} className="rounded-xl">
                <Wand2 className="w-4 h-4 mr-2" />
                Generate Week
              </Button>
              <Button onClick={() => setShowAddDialog(true)} className="rounded-xl">
                <Plus className="w-4 h-4 mr-2" />
                Add Mission
              </Button>
            </div>
          </div>
        )}
      </main>
      
      {/* Add Mission Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Create New Mission</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 pt-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Title</label>
              <Input
                value={newMission.title}
                onChange={(e) => setNewMission({...newMission, title: e.target.value})}
                placeholder="Mission title"
                className="mt-1 rounded-xl"
              />
            </div>
            
            <div>
              <label className="text-sm font-medium text-slate-700">Description</label>
              <Textarea
                value={newMission.description}
                onChange={(e) => setNewMission({...newMission, description: e.target.value})}
                placeholder="What should they do?"
                className="mt-1 rounded-xl resize-none"
                rows={3}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700">Growth Area</label>
                <Select 
                  value={newMission.pillar} 
                  onValueChange={(v) => setNewMission({...newMission, pillar: v})}
                >
                  <SelectTrigger className="mt-1 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(pillarConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>{config.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-700">Difficulty</label>
                <Select 
                  value={newMission.difficulty} 
                  onValueChange={(v) => setNewMission({...newMission, difficulty: v})}
                >
                  <SelectTrigger className="mt-1 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">⭐ Easy</SelectItem>
                    <SelectItem value="medium">⭐⭐ Medium</SelectItem>
                    <SelectItem value="challenging">⭐⭐⭐ Challenging</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setShowAddDialog(false)} className="rounded-xl">
                Cancel
              </Button>
              <Button 
                onClick={() => createMissionMutation.mutate({...newMission, status: 'active'})}
                disabled={!newMission.title || createMissionMutation.isPending}
                className="rounded-xl bg-slate-800 hover:bg-slate-900"
              >
                {createMissionMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Create Mission
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}