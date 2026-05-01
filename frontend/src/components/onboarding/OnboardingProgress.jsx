import { motion } from 'framer-motion';

export default function OnboardingProgress({ currentStep, totalSteps }) {
  return (
    <div className="w-full max-w-md mx-auto mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-500">Step {currentStep} of {totalSteps}</span>
        <span className="text-sm font-medium text-slate-500">{Math.round((currentStep / totalSteps) * 100)}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${(currentStep / totalSteps) * 100}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}