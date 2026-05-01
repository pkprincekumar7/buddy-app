import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/api/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { 
  Plus, ChevronRight, User, Edit, Trash2, 
  Calendar, Target, Sparkles, ArrowLeft
} from 'lucide-react';
import { Skeleton } from "@/components/ui/skeleton";
import { avatars } from '../components/shared/AvatarSelector';
import PersonalityAnalysis, { calculateMBTI } from '../components/shared/PersonalityAnalysis';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Individuals() {
  const queryClient = useQueryClient();
  const [selectedChild, setSelectedChild] = useState(null);
  const [showPersonality, setShowPersonality] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const { data: children = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date')
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.Child.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children'] });
      setDeleteConfirm(null);
    }
  });

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to={createPageUrl('ParentDashboard')}>
                <Button variant="ghost" size="icon" className="rounded-xl">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Your Children</h1>
                <p className="text-sm text-slate-500">{children.length} individual{children.length !== 1 ? 's' : ''} onboarded</p>
              </div>
            </div>
            <Link to={createPageUrl('Onboarding')}>
              <Button className="rounded-xl bg-teal-500 hover:bg-teal-600">
                <Plus className="w-4 h-4 mr-2" />
                Add Child
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-8 py-6">
        {children.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16"
          >
            <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-slate-100 flex items-center justify-center">
              <User className="w-12 h-12 text-slate-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">No Children Yet</h2>
            <p className="text-slate-500 mb-6">Start by adding your first child to the platform</p>
            <Link to={createPageUrl('Onboarding')}>
              <Button className="rounded-xl bg-teal-500 hover:bg-teal-600">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Child
              </Button>
            </Link>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {children.map((child, index) => {
              const avatarConfig = getAvatarConfig(child.avatar_style);
              const AvatarIcon = avatarConfig.icon;
              const age = calculateAge(child.date_of_birth);
              const mbti = calculateMBTI(child);

              return (
                <motion.div
                  key={child.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${avatarConfig.color} flex items-center justify-center`}>
                      <AvatarIcon className="w-8 h-8 text-white" />
                    </div>
                    
                    <div className="flex-1">
                      <h3 className="font-bold text-lg text-slate-800">{child.name}</h3>
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        {age && <span>Age {age}</span>}
                        <span>•</span>
                        <span className="capitalize">{child.current_phase} phase</span>
                        {mbti && (
                          <>
                            <span>•</span>
                            <span className="font-medium text-teal-600">{mbti.type}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs">
                          {child.total_missions_completed || 0} missions
                        </span>
                        <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs">
                          {child.streak_days || 0} day streak
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedChild(child);
                          setShowPersonality(true);
                        }}
                        className="rounded-xl text-slate-400 hover:text-teal-600"
                      >
                        <Sparkles className="w-5 h-5" />
                      </Button>
                      <Link to={createPageUrl('ParentDashboard') + `?child=${child.id}`}>
                        <Button variant="ghost" size="icon" className="rounded-xl text-slate-400 hover:text-slate-600">
                          <ChevronRight className="w-5 h-5" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteConfirm(child)}
                        className="rounded-xl text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      {/* Personality Dialog */}
      <Dialog open={showPersonality} onOpenChange={setShowPersonality}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedChild?.name}'s Personality</DialogTitle>
          </DialogHeader>
          {selectedChild && (
            <PersonalityAnalysis 
              mbtiResult={calculateMBTI(selectedChild)} 
              childName={selectedChild.name} 
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteConfirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all data associated with {deleteConfirm?.name}, including missions, reflections, and progress. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteConfirm.id)}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}