import { Brain, Heart, Dumbbell, Palette, Star, Rocket } from 'lucide-react';

const pillarConfig = {
  cognitive: {
    icon: Brain,
    label: 'Mind',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    gradientFrom: 'from-blue-400',
    gradientTo: 'to-blue-600'
  },
  emotional: {
    icon: Heart,
    label: 'Heart',
    color: 'text-rose-500',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
    gradientFrom: 'from-rose-400',
    gradientTo: 'to-rose-600'
  },
  physical: {
    icon: Dumbbell,
    label: 'Body',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    gradientFrom: 'from-emerald-400',
    gradientTo: 'to-emerald-600'
  },
  talent: {
    icon: Palette,
    label: 'Talents',
    color: 'text-purple-500',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    gradientFrom: 'from-purple-400',
    gradientTo: 'to-purple-600'
  },
  character: {
    icon: Star,
    label: 'Character',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    gradientFrom: 'from-amber-400',
    gradientTo: 'to-amber-600'
  },
  future: {
    icon: Rocket,
    label: 'Future',
    color: 'text-teal-500',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    gradientFrom: 'from-teal-400',
    gradientTo: 'to-teal-600'
  }
};

export default function PillarIcon({ pillar, size = 'md', showLabel = false }) {
  const config = pillarConfig[pillar] || pillarConfig.cognitive;
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };
  
  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };
  
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`${sizeClasses[size]} ${config.bgColor} ${config.borderColor} border-2 rounded-2xl flex items-center justify-center transition-transform hover:scale-105`}>
        <Icon className={`${iconSizes[size]} ${config.color}`} />
      </div>
      {showLabel && (
        <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
      )}
    </div>
  );
}

export { pillarConfig };