import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import StartOverButton from '@/components/shared/StartOverButton';
import {
  Sparkles,
  ArrowRight,
  Brain,
  Heart,
  Dumbbell,
  Palette,
  Star,
  Rocket,
  Shield,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const PILLARS = [
  {
    icon: Brain,
    label: 'Mind',
    color: 'from-blue-500 to-blue-700',
    glow: 'rgba(59,130,246,0.15)',
    description: 'Cognitive growth & curiosity',
  },
  {
    icon: Heart,
    label: 'Heart',
    color: 'from-rose-500 to-rose-700',
    glow: 'rgba(244,63,94,0.15)',
    description: 'Emotional intelligence',
  },
  {
    icon: Dumbbell,
    label: 'Body',
    color: 'from-emerald-500 to-emerald-700',
    glow: 'rgba(16,185,129,0.15)',
    description: 'Physical wellbeing',
  },
  {
    icon: Palette,
    label: 'Talents',
    color: 'from-purple-500 to-purple-700',
    glow: 'rgba(168,85,247,0.15)',
    description: 'Skill discovery',
  },
  {
    icon: Star,
    label: 'Character',
    color: 'from-amber-500 to-amber-700',
    glow: 'rgba(245,158,11,0.15)',
    description: 'Values & integrity',
  },
  {
    icon: Rocket,
    label: 'Future',
    color: 'from-teal-500 to-teal-700',
    glow: 'rgba(20,184,166,0.15)',
    description: 'Life direction',
  },
];

export default function Home() {
  const navigate = useNavigate();
  const { data: childrenRaw = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date'),
  });
  const children = Array.isArray(childrenRaw) ? childrenRaw : [];

  // Onboarding is in progress if there's a child that hasn't completed it yet.
  const onboardingInProgress = children.some((c) => !c.onboarding_completed);
  // The child currently being onboarded (or the most recent one) for Start Over targeting.
  const activeChild = children.find((c) => !c.onboarding_completed) ?? children[0];

  const handleStartJourney = () => {
    navigate('/Onboarding');
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Ambient glows */}
        <div className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-teal-500/[0.04] blur-3xl" />
        <div className="pointer-events-none absolute left-10 top-40 h-72 w-72 rounded-full bg-teal-400/[0.05] blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-10 h-96 w-96 rounded-full bg-purple-500/[0.04] blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 py-24 md:py-36">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2 }}
            className="text-center"
          >
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/10 px-4 py-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" />
              <span className="text-sm font-medium text-teal-400">
                A Growth Companion for Families
              </span>
            </div>

            <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight text-white md:text-6xl lg:text-7xl">
              Nurture Self-Aware,
              <br />
              <span className="bg-gradient-to-r from-teal-400 to-teal-300 bg-clip-text text-transparent">
                Purpose-Driven
              </span>{' '}
              Children
            </h1>

            <p className="mx-auto mb-10 max-w-3xl text-lg leading-relaxed text-slate-400 md:text-xl">
              A 9-year guided journey helping your child discover strengths, build character, and
              design a meaningful life.
            </p>

            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              {onboardingInProgress ? (
                <>
                  <Button
                    onClick={() => navigate('/Onboarding')}
                    className="btn-primary h-btn-lg rounded-2xl px-8 text-base transition-all duration-200"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Continue Onboarding
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <StartOverButton
                    childId={activeChild?.id}
                    className="h-btn-lg rounded-2xl px-8 text-base transition-all duration-200"
                  />
                </>
              ) : (
                <Button
                  onClick={handleStartJourney}
                  className="btn-primary h-btn-lg rounded-2xl px-8 text-base transition-all duration-200"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Start Your Journey
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* 6 Pillars */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-14 text-center"
          >
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
              6 Pillars of Holistic Growth
            </h2>
            <p className="mx-auto max-w-2xl text-slate-400">
              We nurture every dimension of your child's development for balanced, sustainable
              growth.
            </p>
          </motion.div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((pillar, index) => (
              <motion.div
                key={pillar.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.12 }}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="border-edge-faint hover:border-edge group rounded-2xl bg-card p-6 transition-all duration-300"
              >
                <div
                  className={`h-12 w-12 rounded-xl bg-gradient-to-br ${pillar.color} glow-pillar mb-4 flex items-center justify-center transition-all duration-300 group-hover:scale-110`}
                  style={{ '--pillar-glow': pillar.glow } as CSSProperties}
                >
                  <pillar.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="mb-1.5 text-lg font-semibold text-white">{pillar.label}</h3>
                <p className="text-sm text-slate-500">{pillar.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-section-alt py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-14 text-center"
          >
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
              How It Works
            </h2>
          </motion.div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                icon: Users,
                title: 'Parent Onboarding',
                description:
                  "Share insights about your child's personality, interests, and your family values to create their unique baseline profile.",
              },
              {
                icon: Sparkles,
                title: 'Weekly Missions',
                description:
                  'Balanced activities across all 6 pillars keep growth consistent, fun, and achievable without overwhelm.',
              },
              {
                icon: Shield,
                title: 'Growth Insights',
                description:
                  'Receive observations about emerging strengths, patterns, and conversation prompts to deepen connection.',
              },
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.225 }}
                className="text-center"
              >
                <div className="border-edge mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-elevated">
                  <feature.icon className="h-6 w-6 text-teal-400" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-slate-500">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-4xl px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="border-edge-faint relative overflow-hidden rounded-3xl bg-section-dark p-10 text-center md:p-16"
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-500/[0.04] via-transparent to-purple-500/[0.04]" />
            <div className="pointer-events-none absolute left-1/2 top-0 h-32 w-96 -translate-x-1/2 rounded-full bg-teal-500/[0.06] blur-3xl" />
            <div className="relative">
              <h2 className="mb-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
                Begin Your Child's Journey Today
              </h2>
              <p className="mx-auto mb-8 max-w-2xl leading-relaxed text-slate-400">
                No pressure. No comparisons. Just guided, consistent growth towards becoming their
                best self.
              </p>
              <Button
                onClick={handleStartJourney}
                className="btn-primary h-btn-lg rounded-2xl px-10 text-base transition-all duration-200"
              >
                Get Started Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-edge-faint py-8">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-teal-400 to-teal-600">
              <span className="text-[10px] font-bold text-white">B</span>
            </div>
            <span className="text-sm font-semibold text-white">Buddy360</span>
          </div>
          <p className="text-xs text-slate-600">
            A Growth Companion for Raising Self-Aware, Capable, and Purpose-Driven Humans
          </p>
        </div>
      </footer>
    </div>
  );
}
