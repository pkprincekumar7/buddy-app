import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createPageUrl } from "@/utils";
import { api } from '@/api/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, ArrowRight, Brain, Heart,
  Dumbbell, Palette, Star, Rocket, Shield, Users
} from 'lucide-react';
import { Button } from "@/components/ui/button";

export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isResetting, setIsResetting] = useState(false);
  const { data: children = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date')
  });

  const { data: onboarding = {}, isSuccess: onboardingLoaded } = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api.onboarding.get(),
    staleTime: 30_000,
  });

  const phaseRaw = onboarding?.phase;
  const onboardingInProgress =
    onboardingLoaded &&
    phaseRaw !== undefined &&
    phaseRaw !== null &&
    phaseRaw > 0;

  const handleStartJourney = () => {
    navigate(createPageUrl('Onboarding'));
  };

  const handleStartFresh = async () => {
    if (isResetting) return;
    setIsResetting(true);
    try {
      const existingChildren = await api.entities.Child.list('-created_date');
      for (const c of (Array.isArray(existingChildren) ? existingChildren : [])) {
        try {
          await api.entities.Child.delete(c.id);
        } catch {
          // ignore 404s
        }
      }

      await api.onboarding.patch({
        phase: 0,
        clear_child_data: true,
        clear_personality: true,
        clear_recommendations: true,
      });
      await api.recommendationsProgress.patch({ step: 'intro' });
      await api.goals.patch({ clear_plan: true, clear_concern: true });
      await api.completedGrowthAreas.clear();

      queryClient.invalidateQueries({ queryKey: ['children'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      navigate(createPageUrl('Onboarding'));
    } catch (e) {
      console.error('[Start Fresh] Reset failed:', e);
      toast.error('Reset failed. Please try again.');
      setIsResetting(false);
    }
  };

  const pillars = [
    { icon: Brain, label: 'Mind', color: 'from-blue-500 to-blue-700', glow: 'rgba(59,130,246,0.15)', description: 'Cognitive growth & curiosity' },
    { icon: Heart, label: 'Heart', color: 'from-rose-500 to-rose-700', glow: 'rgba(244,63,94,0.15)', description: 'Emotional intelligence' },
    { icon: Dumbbell, label: 'Body', color: 'from-emerald-500 to-emerald-700', glow: 'rgba(16,185,129,0.15)', description: 'Physical wellbeing' },
    { icon: Palette, label: 'Talents', color: 'from-purple-500 to-purple-700', glow: 'rgba(168,85,247,0.15)', description: 'Skill discovery' },
    { icon: Star, label: 'Character', color: 'from-amber-500 to-amber-700', glow: 'rgba(245,158,11,0.15)', description: 'Values & integrity' },
    { icon: Rocket, label: 'Future', color: 'from-teal-500 to-teal-700', glow: 'rgba(20,184,166,0.15)', description: 'Life direction' }
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Ambient glows */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-teal-500/[0.04] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 left-10 w-72 h-72 bg-teal-400/[0.05] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-10 w-96 h-96 bg-purple-500/[0.04] rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 py-24 md:py-36">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-teal-500/10 rounded-full border border-teal-500/20 mb-8">
              <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-teal-400">A Growth Companion for Families</span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight tracking-tight">
              Nurture Self-Aware,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-teal-300">
                Purpose-Driven
              </span>
              {' '}Children
            </h1>

            <p className="text-lg md:text-xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
              A 9-year guided journey helping your child discover strengths,
              build character, and design a meaningful life.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {onboardingInProgress ? (
                <>
                  <Button
                    onClick={() => navigate(createPageUrl('Onboarding'))}
                    className="h-13 px-8 text-base rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-[#0a0a0a] font-semibold glow-teal transition-all duration-200"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Continue Onboarding
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                  <Button
                    onClick={handleStartFresh}
                    disabled={isResetting}
                    variant="outline"
                    className="h-13 px-8 text-base rounded-2xl border border-white/[0.12] text-slate-300 bg-transparent hover:bg-white/[0.05] hover:text-white transition-all duration-200"
                  >
                    {isResetting ? 'Resetting…' : 'Start Fresh'}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={handleStartJourney}
                  className="h-13 px-8 text-base rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-[#0a0a0a] font-semibold glow-teal transition-all duration-200"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Start Your Journey
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* 6 Pillars */}
      <section className="py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
              6 Pillars of Holistic Growth
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              We nurture every dimension of your child's development for balanced, sustainable growth.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pillars.map((pillar, index) => (
              <motion.div
                key={pillar.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="bg-[#141414] rounded-2xl p-6 border border-white/[0.06] hover:border-white/[0.10] transition-all duration-300 group"
                style={{ '--pillar-glow': pillar.glow }}
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${pillar.color} flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110`}
                  style={{ boxShadow: `0 0 20px ${pillar.glow}` }}
                >
                  <pillar.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-1.5">{pillar.label}</h3>
                <p className="text-slate-500 text-sm">{pillar.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 md:py-28 bg-[#0d0d0d]">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
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
                transition={{ delay: index * 0.15 }}
                className="text-center"
              >
                <div className="w-14 h-14 mx-auto rounded-2xl bg-[#1a1a1a] border border-white/[0.08] flex items-center justify-center mb-5">
                  <feature.icon className="w-6 h-6 text-teal-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-28">
        <div className="max-w-4xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="bg-[#111111] rounded-3xl p-10 md:p-16 text-center relative overflow-hidden border border-white/[0.06]"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-teal-500/[0.04] via-transparent to-purple-500/[0.04] pointer-events-none" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-32 bg-teal-500/[0.06] blur-3xl rounded-full pointer-events-none" />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
                Begin Your Child's Journey Today
              </h2>
              <p className="text-slate-400 mb-8 max-w-2xl mx-auto leading-relaxed">
                No pressure. No comparisons. Just guided, consistent growth towards becoming their best self.
              </p>
              <Button
                onClick={handleStartJourney}
                className="h-13 px-10 text-base rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-[#0a0a0a] font-semibold glow-teal transition-all duration-200"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">B</span>
            </div>
            <span className="font-semibold text-white text-sm">Buddy360</span>
          </div>
          <p className="text-xs text-slate-600">
            A Growth Companion for Raising Self-Aware, Capable, and Purpose-Driven Humans
          </p>
        </div>
      </footer>
    </div>
  );
}
