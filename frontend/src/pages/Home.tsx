import type { CSSProperties } from 'react';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import ChildCard from '@/components/shared/ChildCard';
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
  Smartphone,
  Loader2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Web app only — the React Native app (frontend-app/) has its own update flow.
// Show the APK download option only when the page is opened on an Android device.
// APKs cannot be sideloaded on iOS or installed on desktop, so displaying this
// button there would be misleading. User-agent detection is intentionally
// client-side: the backend endpoint remains available to any authenticated user,
// but the UI surface is scoped to Android browsers.
const IS_ANDROID_BROWSER = /android/i.test(navigator.userAgent);

import { PILLAR_GLOW_COLORS } from '@/lib/gradientColors';

const PILLARS = [
  {
    icon: Brain,
    label: 'Mind',
    color: 'from-info-medium to-info-strong',
    glow: PILLAR_GLOW_COLORS.mind,
    description: 'Cognitive growth & curiosity',
  },
  {
    icon: Heart,
    label: 'Heart',
    color: 'from-error-medium to-error-strong',
    glow: PILLAR_GLOW_COLORS.heart,
    description: 'Emotional intelligence',
  },
  {
    icon: Dumbbell,
    label: 'Body',
    color: 'from-success to-success-strong',
    glow: PILLAR_GLOW_COLORS.body,
    description: 'Physical wellbeing',
  },
  {
    icon: Palette,
    label: 'Talents',
    color: 'from-personality to-personality-alt-strong',
    glow: PILLAR_GLOW_COLORS.talents,
    description: 'Skill discovery',
  },
  {
    icon: Star,
    label: 'Character',
    color: 'from-warning-medium to-warning-strong',
    glow: PILLAR_GLOW_COLORS.character,
    description: 'Values & integrity',
  },
  {
    icon: Rocket,
    label: 'Future',
    color: 'from-primary-medium to-primary-stronger',
    glow: PILLAR_GLOW_COLORS.future,
    description: 'Life direction',
  },
];

export default function Home() {
  const navigate = useNavigate();
  const [apkDownloading, setApkDownloading] = useState(false);

  const handleDownloadApk = async () => {
    setApkDownloading(true);
    try {
      const { url } = await api.downloads.getApkUrl();
      // Trigger the download via a temporary anchor so the browser initiates
      // the download without opening a new tab. The filename is controlled by
      // the Content-Disposition header embedded in the pre-signed S3 URL —
      // anchor.download is not used because it is ignored for cross-origin URLs.
      const anchor = document.createElement('a');
      anchor.href = url;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch {
      toast.error('Could not fetch the download link. Please try again.');
    } finally {
      setApkDownloading(false);
    }
  };

  const { data: childrenRaw = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date'),
  });
  const children = Array.isArray(childrenRaw) ? childrenRaw : [];

  const handleStartJourney = () => {
    navigate('/Onboarding');
  };

  // "Continue Your Journey" routes to /Onboarding/:childId so the child is identified
  // in the URL and survives a page refresh on the Onboarding page.
  // TO ENABLE MULTIPLE CHILDREN: replace children[0] with the child the user selected.
  const firstChild = children[0]?.id ? children[0] : null;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Ambient glows */}
        <div className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-primary/[0.04] blur-3xl" />
        <div className="pointer-events-none absolute left-10 top-40 h-72 w-72 rounded-full bg-primary/[0.05] blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-10 h-96 w-96 rounded-full bg-personality/[0.04] blur-3xl" />

        <div
          // Padding was previously shrunk when children existed (py-8) because the
          // children management section below provided visual weight. Now that section
          // is hidden, always use full hero padding. Restore the conditional
          // `children.length > 0 ? 'py-8 md:py-12' : 'py-24 md:py-36'` when re-enabling.
          className="relative mx-auto max-w-6xl px-4 py-24 md:py-36"
        >
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2 }}
            className="text-center"
          >
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2">
              <span className="text-sm font-medium text-primary">
                A Transformational Journey for Your Child
              </span>
            </div>

            <h1 className="mx-auto mb-6 max-w-4xl px-4 text-4xl font-bold leading-tight tracking-tight text-foreground md:text-6xl lg:text-7xl">
              Preparing Children to{' '}
              <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
                Unlock Their Super Powers
              </span>
            </h1>

            <p className="mx-auto mb-10 max-w-3xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              A guided journey to uncover strengths, build confidence, and grow into a thoughtful,
              capable individual.
            </p>

            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              {children.length === 0 ? (
                <Button
                  size="xl"
                  onClick={handleStartJourney}
                  className="btn-primary rounded-2xl transition-all duration-200"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Start Your Journey
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                // "Continue Your Journey" is shown here because the children management
                // section below is hidden. When that section is re-enabled, remove this
                // else-branch so the hero goes back to showing no button when children exist.
                <Button
                  size="xl"
                  onClick={() =>
                    navigate(firstChild ? `/Onboarding/${firstChild.id}` : '/Onboarding')
                  }
                  className="btn-primary rounded-2xl transition-all duration-200"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Continue Your Journey
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Android app download — visible only when the page is opened on an Android
          browser. APKs are built and uploaded to S3 by the build-android-apk GitHub
          Actions workflow. The backend generates a 5-minute pre-signed URL on demand. */}
      {IS_ANDROID_BROWSER && (
        <section className="py-6">
          <div className="mx-auto max-w-6xl px-4">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="border-edge flex flex-col items-center gap-4 rounded-2xl bg-gradient-to-r from-primary-medium/10 via-primary/5 to-success/10 px-6 py-5 sm:flex-row sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-medium to-success-strong">
                  <Smartphone className="h-5 w-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-foreground">
                    Get the Buddy360 Android App
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Install directly on your device for the full experience
                  </p>
                </div>
              </div>
              <Button
                onClick={() => {
                  void handleDownloadApk();
                }}
                disabled={apkDownloading}
                className="btn-primary shrink-0 rounded-xl px-5 py-2.5 text-sm font-medium transition-all duration-200"
              >
                {apkDownloading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Preparing…
                  </>
                ) : (
                  <>
                    <Smartphone className="mr-2 h-4 w-4" />
                    Download APK
                  </>
                )}
              </Button>
            </motion.div>
          </div>
        </section>
      )}

      {/* FEATURE HIDDEN: Children management section (add child, child cards, delete child).
          To re-enable: remove the `{false && ( ... )}` wrapper below, remove the `firstChild`
          variable and the "Continue Your Journey" else-branch in the hero above, and restore
          the hero padding conditional. The underlying API and hook (useStartOver) are untouched. */}
      {false && (
        <section className="py-10">
          <div className="mx-auto max-w-6xl px-4">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Your Children</h2>
                <div className="flex flex-col items-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('/Onboarding', { state: { forceNew: true } })}
                    disabled={children.length >= 10}
                    className="rounded-xl"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Child
                  </Button>
                  {children.length >= 10 && (
                    <p className="text-xs text-muted-foreground">Maximum of 10 children reached.</p>
                  )}
                </div>
              </div>

              {children.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                  No children yet.{' '}
                  <button
                    className="text-primary underline underline-offset-2"
                    onClick={() => navigate('/Onboarding', { state: { forceNew: true } })}
                  >
                    Add your first child
                  </button>{' '}
                  to begin their journey.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {children.map((child) => (
                    <ChildCard key={child.id} child={child} />
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        </section>
      )}

      {/* 6 Pillars */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-14 text-center"
          >
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              6 Pillars of Holistic Growth
            </h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
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
                <h3 className="mb-1.5 text-lg font-semibold text-foreground">{pillar.label}</h3>
                <p className="text-sm text-muted-foreground">{pillar.description}</p>
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
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
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
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — only shown to first-time visitors with no children yet */}
      {children.length === 0 && (
        <section className="py-20 md:py-28">
          <div className="mx-auto max-w-4xl px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="border-edge-faint relative overflow-hidden rounded-3xl bg-section-dark p-10 text-center md:p-16"
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-medium/[0.04] via-transparent to-personality/[0.04]" />
              <div className="pointer-events-none absolute left-1/2 top-0 h-32 w-96 -translate-x-1/2 rounded-full bg-primary/[0.06] blur-3xl" />
              <div className="relative">
                <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                  Begin Your Child's Journey Today
                </h2>
                <p className="mx-auto mb-8 max-w-2xl leading-relaxed text-muted-foreground">
                  No pressure. No comparisons. Just guided, consistent growth towards becoming their
                  best self.
                </p>
                <Button
                  size="xl"
                  onClick={handleStartJourney}
                  className="btn-primary rounded-2xl transition-all duration-200"
                >
                  Get Started Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t-edge-faint py-8">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <div className="mb-2 flex items-center justify-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary-dark">
              <span className="text-[10px] font-bold text-white">B</span>
            </div>
            <span className="text-sm font-semibold text-foreground">Buddy360</span>
          </div>
          <p className="text-xs text-muted-foreground">
            A Growth Companion for Raising Self-Aware, Capable, and Purpose-Driven Humans
          </p>
        </div>
      </footer>
    </div>
  );
}
