import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { CheckCircle, Circle } from 'lucide-react';
import { api } from '@/api/client';
import { toast } from 'sonner';

const careerOptions = [
  {
    id: 'astronaut',
    label: 'Astronaut',
    image: 'https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?w=400&h=300&fit=crop',
    emoji: '🚀'
  },
  {
    id: 'sports',
    label: 'Sports Person',
    image: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=400&h=300&fit=crop',
    emoji: '⚽'
  },
  {
    id: 'parent',
    label: 'As My Father/Mother',
    image: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400&h=300&fit=crop',
    emoji: '👨‍👩‍👧'
  },
  {
    id: 'superhero',
    label: 'Super Hero',
    image: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?w=400&h=300&fit=crop',
    emoji: '🦸'
  },
  {
    id: 'dancer',
    label: 'Dancer',
    image: 'https://images.unsplash.com/photo-1508700929628-666bc8bd84ea?w=400&h=300&fit=crop',
    emoji: '💃'
  }
];

export default function CareerSelectionGame({ childName, onComplete }) {
  const [selected, setSelected] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleSelection = (id) => {
    if (selected.includes(id)) {
      setSelected(selected.filter(s => s !== id));
    } else {
      if (selected.length < 3) {
        setSelected([...selected, id]);
      } else {
        toast.error('You can select maximum 3 options');
      }
    }
  };

  const handleSubmit = async () => {
    if (selected.length === 0) {
      toast.error('Please select at least 1 option');
      return;
    }

    setIsSubmitting(true);
    try {
      // Generate AI recommendations based on selections
      const selectedLabels = selected.map(id => 
        careerOptions.find(opt => opt.id === id)?.label
      ).join(', ');

      const prompt = `A child named ${childName} has selected these career aspirations: ${selectedLabels}.

Generate personalized recommendations for the parent to help nurture these interests:
1. A brief summary of what these choices reveal about the child's interests
2. 3-4 specific activities or experiences to support these aspirations
3. 2-3 strengths to encourage based on these choices`;

      const recommendations = await api.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            activities: {
              type: "array",
              items: { type: "string" }
            },
            strengths: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      onComplete({
        selections: selected,
        recommendations
      });
    } catch (error) {
      console.error('Failed to generate recommendations:', error);
      toast.error('Failed to generate recommendations');
    }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">
          What do you want to become in life?
        </h2>
        <p className="text-slate-500">Choose up to 3 options that excite you!</p>
        <p className="text-sm text-emerald-600 mt-2">
          Selected: {selected.length}/3
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {careerOptions.map((option, i) => (
          <motion.button
            key={option.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => toggleSelection(option.id)}
            className={`relative rounded-2xl overflow-hidden border-4 transition-all ${
              selected.includes(option.id)
                ? 'border-emerald-500 shadow-lg'
                : 'border-slate-200 hover:border-emerald-300'
            }`}
          >
            <div className="aspect-[4/3] relative">
              <img
                src={option.image}
                alt={option.label}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div className="hidden absolute inset-0 bg-gradient-to-br from-purple-400 to-pink-500 items-center justify-center">
                <span className="text-6xl">{option.emoji}</span>
              </div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-between p-3">
              <span className="text-white font-semibold text-sm">
                {option.label}
              </span>
              {selected.includes(option.id) ? (
                <CheckCircle className="w-6 h-6 text-white fill-emerald-500" />
              ) : (
                <Circle className="w-6 h-6 text-white/80" />
              )}
            </div>
          </motion.button>
        ))}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={selected.length === 0 || isSubmitting}
        className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600"
      >
        {isSubmitting ? 'Generating Recommendations...' : 'Submit My Choices'}
      </Button>
    </div>
  );
}