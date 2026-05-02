import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { api } from '@/api/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Sparkles, ArrowRight, TreeDeciduous, Brain, Heart, 
  Dumbbell, Palette, Star, Rocket, Shield, Users
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { USER_APP_HOME_RESET_KEYS, patchBodyClearKeys } from '@/lib/userAppStateKeys';

export default function Home() {
  const queryClient = useQueryClient();
  const { data: children = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date')
  });

  const { data: appState = {}, isSuccess: appStateLoaded } = useQuery({
    queryKey: ['userAppState'],
    queryFn: () => api.userAppState.get(),
    staleTime: 30_000,
  });

  const phaseRaw = appState?.onboarding_phase;
  const onboardingInProgress =
    appStateLoaded &&
    phaseRaw !== undefined &&
    phaseRaw !== null &&
    String(phaseRaw) !== 'null' &&
    String(phaseRaw) !== 'complete';

  const goToJourneyEntry = () => {
    if (children.length > 0) {
      window.location.href = createPageUrl('SelectMode');
    } else {
      window.location.href = createPageUrl('Onboarding');
    }
  };

  /** Default CTAs: preserve saved onboarding app-state. */
  const handleStartJourney = () => {
    goToJourneyEntry();
  };

  /** Explicit reset only — same key scope as before (onboarding wizard blob, not full Start Over). */
  const handleStartFresh = async () => {
    try {
      if (await api.auth.isAuthenticated()) {
        await api.userAppState.patch(patchBodyClearKeys(USER_APP_HOME_RESET_KEYS));
        queryClient.invalidateQueries({ queryKey: ['userAppState'] });
      }
    } catch {
      /* ignore */
    }
    goToJourneyEntry();
  };
  
  const pillars = [
    { icon: Brain, label: 'Mind', color: 'from-blue-400 to-blue-600', description: 'Cognitive growth & curiosity' },
    { icon: Heart, label: 'Heart', color: 'from-rose-400 to-rose-600', description: 'Emotional intelligence' },
    { icon: Dumbbell, label: 'Body', color: 'from-emerald-400 to-emerald-600', description: 'Physical wellbeing' },
    { icon: Palette, label: 'Talents', color: 'from-purple-400 to-purple-600', description: 'Skill discovery' },
    { icon: Star, label: 'Character', color: 'from-amber-400 to-amber-600', description: 'Values & integrity' },
    { icon: Rocket, label: 'Future', color: 'from-teal-400 to-teal-600', description: 'Life direction' }
  ];
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 via-transparent to-purple-500/5" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-teal-400/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl" />
        
        <div className="relative max-w-6xl mx-auto px-4 py-20 md:py-32">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 rounded-full border border-teal-200 mb-8">
              <TreeDeciduous className="w-5 h-5 text-teal-600" />
              <span className="text-sm font-medium text-teal-700">A Growth Companion for Families</span>
            </div>
            
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-slate-900 mb-6 leading-tight">
              Nurture Self-Aware,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-500 to-emerald-500">
                Purpose-Driven
              </span>
              {' '}Children
            </h1>
            
            <p className="text-xl md:text-2xl text-slate-500 max-w-3xl mx-auto mb-10 leading-relaxed">
              A 9-year guided journey helping your child discover strengths, 
              build character, and design a meaningful life.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {onboardingInProgress ? (
                <>
                  <Button 
                    onClick={() => window.location.href = createPageUrl('Onboarding')}
                    className="h-14 px-8 text-lg rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 shadow-xl shadow-teal-500/25"
                  >
                    <Sparkles className="w-5 h-5 mr-2" />
                    Continue Onboarding
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                  <Button 
                    onClick={handleStartFresh}
                    variant="outline"
                    className="h-14 px-8 text-lg rounded-2xl border-2 border-teal-500"
                  >
                    Start Fresh
                  </Button>
                </>
              ) : (
                <Button 
                  onClick={handleStartJourney}
                  className="h-14 px-8 text-lg rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 shadow-xl shadow-teal-500/25"
                >
                  <Sparkles className="w-5 h-5 mr-2" />
                  Start Your Journey
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      </section>
      
      {/* 6 Pillars */}
      <section className="py-20 md:py-32">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">
              6 Pillars of Holistic Growth
            </h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">
              We nurture every dimension of your child's development for balanced, sustainable growth.
            </p>
          </motion.div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pillars.map((pillar, index) => (
              <motion.div
                key={pillar.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -4 }}
                className="bg-white rounded-3xl p-6 border border-slate-200 shadow-lg shadow-slate-100/50 hover:shadow-xl transition-all"
              >
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${pillar.color} flex items-center justify-center mb-4 shadow-lg`}>
                  <pillar.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">{pillar.label}</h3>
                <p className="text-slate-500">{pillar.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      
      {/* Features */}
      <section className="py-20 md:py-32 bg-slate-50/50">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">
              How It Works
            </h2>
          </motion.div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Users,
                title: "Parent Onboarding",
                description: "Share insights about your child's personality, interests, and your family values to create their unique baseline profile."
              },
              {
                icon: Sparkles,
                title: "Weekly Missions",
                description: "Balanced activities across all 6 pillars keep growth consistent, fun, and achievable without overwhelm."
              },
              {
                icon: Shield,
                title: "Growth Insights",
                description: "Receive observations about emerging strengths, patterns, and conversation prompts to deepen connection."
              }
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.2 }}
                className="text-center"
              >
                <div className="w-16 h-16 mx-auto rounded-2xl bg-white border border-slate-200 shadow-lg flex items-center justify-center mb-4">
                  <feature.icon className="w-8 h-8 text-teal-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">{feature.title}</h3>
                <p className="text-slate-500">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      
      {/* CTA */}
      <section className="py-20 md:py-32">
        <div className="max-w-4xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-[2rem] p-10 md:p-16 text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-purple-500/10" />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Begin Your Child's Journey Today
              </h2>
              <p className="text-lg text-slate-300 mb-8 max-w-2xl mx-auto">
                No pressure. No comparisons. Just guided, consistent growth towards becoming their best self.
              </p>
              <Button 
                onClick={handleStartJourney}
                className="h-14 px-10 text-lg rounded-2xl bg-white text-slate-900 hover:bg-slate-100"
              >
                Get Started Free
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
      
      {/* Footer */}
      <footer className="py-8 border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <TreeDeciduous className="w-5 h-5 text-teal-600" />
            <span className="font-bold text-slate-800">Buddy360</span>
          </div>
          <p className="text-sm text-slate-500">
            A Growth Companion for Raising Self-Aware, Capable, and Purpose-Driven Humans
          </p>
        </div>
      </footer>
    </div>
  );
}