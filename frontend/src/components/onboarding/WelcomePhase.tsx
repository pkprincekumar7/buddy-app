import { motion } from 'framer-motion';
import { Sparkles, Shield, Heart, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';

const WELCOME_FEATURES = [
  { icon: Heart, text: 'Understand your child deeply' },
  { icon: Compass, text: 'Create a personalized growth pathway' },
  { icon: Sparkles, text: 'Get life changing recommendations' },
];

interface WelcomePhaseProps {
  onContinue: () => void;
  isAuthenticated?: boolean;
  user?: { full_name?: string; email?: string } | null;
}

export default function WelcomePhase({ onContinue, isAuthenticated, user }: WelcomePhaseProps) {
  const handleGoogleLogin = () => {
    void api.auth.redirectToLogin();
  };

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center">
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 60, damping: 14, delay: 0.1 }}
          className="glow-teal mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600"
        >
          <span className="text-2xl font-bold text-white">B</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.55, ease: 'easeOut' }}
          className="mb-3 text-3xl font-bold tracking-tight text-white md:text-4xl"
        >
          Welcome to Buddy360
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.85, ease: 'easeOut' }}
          className="mx-auto max-w-md text-base leading-relaxed text-slate-400"
        >
          A guided journey to help your child discover their strengths and design a meaningful life
        </motion.p>
      </div>

      {/* Features */}
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 1.15, ease: 'easeOut' }}
        className="border-edge mx-auto max-w-md rounded-2xl bg-surface-elevated p-6"
      >
        <p className="mb-5 text-xs font-semibold uppercase tracking-widest text-slate-500">
          What you'll do today
        </p>
        <div className="space-y-4">
          {WELCOME_FEATURES.map((feature, index) => (
            <motion.div
              key={feature.text}
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 1.4 + index * 0.25, ease: 'easeOut' }}
              className="flex items-center gap-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/10">
                <feature.icon className="h-4 w-4 text-teal-400" />
              </div>
              <span className="text-sm text-slate-300">{feature.text}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Login/Continue */}
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 2.15, ease: 'easeOut' }}
        className="mx-auto max-w-md space-y-4 text-center"
      >
        {isAuthenticated ? (
          <>
            <div className="border-edge flex items-center gap-3 rounded-2xl bg-surface-elevated p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-500">
                <span className="text-sm font-bold text-white">
                  {user?.full_name?.[0] ?? user?.email?.[0] ?? '?'}
                </span>
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-white">{user?.full_name ?? 'Welcome!'}</p>
                <p className="text-xs text-slate-500">{user?.email}</p>
              </div>
            </div>

            <Button
              onClick={onContinue}
              className="btn-primary h-btn-lg w-full rounded-2xl text-base transition-all duration-200"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Let's Begin
            </Button>
          </>
        ) : (
          <>
            <div className="border-edge rounded-2xl bg-surface-elevated p-5">
              <div className="mb-4 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Shield className="h-3.5 w-3.5" />
                <span>Sign in to save your progress securely</span>
              </div>

              <Button
                onClick={handleGoogleLogin}
                className="border-edge-strong h-12 w-full rounded-xl bg-[#242424] text-sm font-medium text-white transition-all duration-200 hover:bg-[#2a2a2a]"
              >
                <svg className="mr-3 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </Button>
            </div>

            <p className="text-xs text-slate-600">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>
          </>
        )}
      </motion.div>

      {/* Time estimate */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 2.5, ease: 'easeOut' }}
        className="text-center text-xs text-slate-600"
      >
        ⏱️ This will take about 5–7 minutes
      </motion.p>
    </div>
  );
}
