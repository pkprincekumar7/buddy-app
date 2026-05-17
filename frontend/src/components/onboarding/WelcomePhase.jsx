import { motion } from 'framer-motion';
import { LogIn, Sparkles, Shield, Heart, Compass } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { api } from '@/api/client';

export default function WelcomePhase({ onContinue, isAuthenticated, user }) {
  const handleGoogleLogin = () => {
    api.auth.redirectToLogin(window.location.href);
  };

  const features = [
    { icon: Heart, text: 'Understand your child deeply' },
    { icon: Compass, text: 'Create a personalized growth pathway' },
    { icon: Sparkles, text: 'Get life changing recommendations' }
  ];

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200 }}
          className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center glow-teal"
        >
          <span className="text-white font-bold text-2xl">B</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-3xl md:text-4xl font-bold text-white mb-3 tracking-tight"
        >
          Welcome to Buddy360
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="text-base text-slate-400 max-w-md mx-auto leading-relaxed"
        >
          A guided journey to help your child discover their strengths and design a meaningful life
        </motion.p>
      </div>

      {/* Features */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-[#1a1a1a] rounded-2xl p-6 border border-white/[0.08] max-w-md mx-auto"
      >
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-5">What you'll do today</p>
        <div className="space-y-4">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.75 + index * 0.15 }}
              className="flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0">
                <feature.icon className="w-4 h-4 text-teal-400" />
              </div>
              <span className="text-slate-300 text-sm">{feature.text}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Login/Continue */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.05 }}
        className="text-center space-y-4 max-w-md mx-auto"
      >
        {isAuthenticated ? (
          <>
            <div className="flex items-center gap-3 p-4 bg-[#1a1a1a] rounded-2xl border border-white/[0.08]">
              <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-sm">{user?.full_name?.[0] || user?.email?.[0] || '?'}</span>
              </div>
              <div className="text-left">
                <p className="font-medium text-white text-sm">{user?.full_name || 'Welcome!'}</p>
                <p className="text-xs text-slate-500">{user?.email}</p>
              </div>
            </div>

            <Button
              onClick={onContinue}
              className="w-full h-13 rounded-2xl bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-[#0a0a0a] font-semibold text-base glow-teal transition-all duration-200"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Let's Begin
            </Button>
          </>
        ) : (
          <>
            <div className="p-5 bg-[#1a1a1a] rounded-2xl border border-white/[0.08]">
              <div className="flex items-center gap-2 justify-center text-xs text-slate-500 mb-4">
                <Shield className="w-3.5 h-3.5" />
                <span>Sign in to save your progress securely</span>
              </div>

              <Button
                onClick={handleGoogleLogin}
                className="w-full h-12 rounded-xl bg-[#242424] hover:bg-[#2a2a2a] text-white border border-white/[0.10] text-sm font-medium transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-3" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
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
        transition={{ delay: 1.2 }}
        className="text-center text-xs text-slate-600"
      >
        ⏱️ This will take about 5–7 minutes
      </motion.p>
    </div>
  );
}
