import { motion } from 'framer-motion';
import { MessageSquare, Sparkles, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';

const FEATURES = [
  { icon: MessageSquare, text: 'Quick chat' },
  { icon: Sparkles, text: 'Personalized' },
  { icon: Target, text: 'Actionable' },
];

interface WelcomePhaseProps {
  onContinue: () => void;
  isAuthenticated?: boolean;
  user?: { full_name?: string; email?: string } | null;
}

export default function WelcomePhase({ onContinue, isAuthenticated, user }: WelcomePhaseProps) {
  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  const handleGoogleLogin = () => {
    void api.auth.redirectToLogin();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: 'easeOut' }}
      className="mx-auto max-w-lg"
    >
      <div className="border-edge space-y-6 rounded-2xl bg-card p-8 text-center sm:p-10">
        {/* Buddy logo — solid teal filled circle with white sprout */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 70, damping: 12, delay: 0.1 }}
          className="glow-teal-icon mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary"
        >
          <svg viewBox="0 0 20 22" className="h-10 w-10">
            {/* stem */}
            <line
              x1="10"
              y1="21"
              x2="10"
              y2="14"
              className="stroke-logo-leaf"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            {/* left leaf — teardrop pointing upper-left */}
            <path
              d="M10 15 C9 12 4 10 4 6.5 C4 3.5 6.5 2.5 8.5 3.5 C9.5 4 10 9 10 15 Z"
              className="fill-logo-leaf"
            />
            {/* right leaf — teardrop pointing upper-right */}
            <path
              d="M10 15 C11 12 16 10 16 6.5 C16 3.5 13.5 2.5 11.5 3.5 C10.5 4 10 9 10 15 Z"
              className="fill-logo-leaf"
            />
          </svg>
        </motion.div>

        {/* Headline */}
        <div className="space-y-2">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"
          >
            Welcome to your growth journey
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.55, ease: 'easeOut' }}
            className="text-3xl font-bold leading-tight text-foreground sm:text-4xl"
          >
            Hey {firstName}! 👋
            <br />
            I'm <span className="text-primary">Buddy</span>, your child's
            <br />
            growth companion.
          </motion.h1>
        </div>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.75, duration: 0.5 }}
          className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground"
        >
          In a few light, friendly questions I'll learn about your child — one thing at a time. No
          long forms, no pressure. Promise.
        </motion.p>

        {/* Feature chips */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.95, duration: 0.5 }}
          className="flex w-full items-center justify-center gap-3"
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.text}
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.0 + i * 0.1, duration: 0.35, ease: 'easeOut' }}
              className="border-edge flex flex-1 flex-col items-center gap-2 rounded-xl bg-surface-elevated py-4"
            >
              <f.icon className="h-5 w-5 text-primary" />
              <span className="text-xs font-medium text-foreground">{f.text}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3, duration: 0.45 }}
          className="space-y-2 pt-1"
        >
          {isAuthenticated ? (
            <Button
              onClick={onContinue}
              className="glow-teal-md h-12 rounded-full bg-primary px-12 text-base font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/90"
            >
              Let's start &rarr;
            </Button>
          ) : (
            <>
              <Button
                onClick={handleGoogleLogin}
                className="glow-teal-md h-12 rounded-full bg-primary px-12 text-base font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/90"
              >
                Get started &rarr;
              </Button>
              <p className="text-xs text-muted-foreground/60">
                Sign in to save your progress securely
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground/50">Takes about 2 minutes</p>
        </motion.div>
      </div>
    </motion.div>
  );
}
