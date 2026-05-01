import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import { createPageUrl } from "@/utils";
import { User, Baby, Lock, ChevronRight, Plus, Eye, EyeOff } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { avatars } from '../components/shared/AvatarSelector';

export default function SelectMode() {
  const [selectedMode, setSelectedMode] = useState(null); // 'parent' | 'child'
  const [selectedChild, setSelectedChild] = useState(null);
  const [pin, setPin] = useState(['', '', '', '']);
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [user, setUser] = useState(null);

  const { data: children = [], isLoading } = useQuery({
    queryKey: ['children'],
    queryFn: () => api.entities.Child.list('-created_date')
  });

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await api.auth.me();
        setUser(currentUser);
      } catch (e) {}
    };
    loadUser();
  }, []);

  // Redirect to onboarding if no children
  useEffect(() => {
    if (!isLoading && children.length === 0) {
      window.location.href = createPageUrl('Onboarding');
    }
  }, [isLoading, children]);

  const getAvatarConfig = (style) => avatars.find(a => a.id === style) || avatars[0];

  const handlePinChange = (index, value) => {
    if (value.length > 1) return;
    if (value && !/^\d$/.test(value)) return;
    
    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    setPinError(false);

    // Auto-focus next input
    if (value && index < 3) {
      document.getElementById(`pin-${index + 1}`)?.focus();
    }

    // Check PIN when complete
    if (index === 3 && value) {
      const enteredPin = newPin.join('');
      const storedPin = user?.parent_pin || '1234'; // Default PIN
      
      if (enteredPin === storedPin) {
        window.location.href = createPageUrl('ParentDashboard');
      } else {
        setPinError(true);
        setPin(['', '', '', '']);
        document.getElementById('pin-0')?.focus();
      }
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      document.getElementById(`pin-${index - 1}`)?.focus();
    }
  };

  const handleChildSelect = (child) => {
    setSelectedChild(child);
    window.location.href = createPageUrl('ChildMode');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="h-32 rounded-3xl" />
          <Skeleton className="h-32 rounded-3xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center">
            <span className="text-2xl">🌱</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Welcome to Buddy360</h1>
          <p className="text-slate-500 mt-1">Who's using the app today?</p>
        </motion.div>

        {!selectedMode ? (
          <div className="space-y-4">
            {/* Parent Mode */}
            <motion.button
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              onClick={() => setSelectedMode('parent')}
              className="w-full p-6 bg-white rounded-3xl border-2 border-slate-200 hover:border-purple-400 hover:shadow-lg transition-all text-left group"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                  <User className="w-7 h-7 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-slate-800">Parent Mode</h3>
                  <p className="text-sm text-slate-500">View dashboard & manage activities</p>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-purple-500 transition-colors" />
              </div>
            </motion.button>

            {/* Child Mode */}
            <motion.button
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              onClick={() => setSelectedMode('child')}
              className="w-full p-6 bg-white rounded-3xl border-2 border-slate-200 hover:border-teal-400 hover:shadow-lg transition-all text-left group"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
                  <Baby className="w-7 h-7 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-slate-800">Child Mode</h3>
                  <p className="text-sm text-slate-500">Fun activities & games</p>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-teal-500 transition-colors" />
              </div>
            </motion.button>

            {/* Add Another Child */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-center pt-4"
            >
              <Button
                variant="ghost"
                onClick={() => window.location.href = createPageUrl('Onboarding')}
                className="text-slate-500 hover:text-teal-600"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Another Child
              </Button>
            </motion.div>
          </div>
        ) : selectedMode === 'parent' ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-6 border border-slate-200 shadow-lg"
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                <Lock className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Enter Parent PIN</h2>
              <p className="text-sm text-slate-500 mt-1">4-digit PIN to access parent dashboard</p>
            </div>

            <div className="flex justify-center gap-3 mb-6">
              {pin.map((digit, index) => (
                <Input
                  key={index}
                  id={`pin-${index}`}
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handlePinChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className={`w-14 h-14 text-center text-2xl font-bold rounded-xl ${
                    pinError ? 'border-red-500 bg-red-50' : 'border-slate-200'
                  }`}
                  autoFocus={index === 0}
                />
              ))}
            </div>

            {pinError && (
              <p className="text-red-500 text-sm text-center mb-4">
                Incorrect PIN. Please try again.
              </p>
            )}

            <div className="flex justify-center mb-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPin(!showPin)}
                className="text-slate-500"
              >
                {showPin ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                {showPin ? 'Hide' : 'Show'} PIN
              </Button>
            </div>

            <p className="text-xs text-slate-400 text-center mb-4">
              Default PIN: 1234 (change in settings)
            </p>

            <Button
              variant="ghost"
              onClick={() => {
                setSelectedMode(null);
                setPin(['', '', '', '']);
                setPinError(false);
              }}
              className="w-full"
            >
              ← Back
            </Button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-4"
          >
            <div className="text-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">Who's Playing?</h2>
              <p className="text-sm text-slate-500">Select your profile</p>
            </div>

            {children.map((child, index) => {
              const avatarConfig = getAvatarConfig(child.avatar_style);
              const AvatarIcon = avatarConfig.icon;
              
              return (
                <motion.button
                  key={child.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  onClick={() => handleChildSelect(child)}
                  className="w-full p-5 bg-white rounded-2xl border-2 border-slate-200 hover:border-teal-400 hover:shadow-lg transition-all text-left group"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarConfig.color} flex items-center justify-center`}>
                      <AvatarIcon className="w-7 h-7 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-slate-800">{child.name}</h3>
                      <p className="text-sm text-slate-500">{child.mbti_type || 'Explorer'}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-teal-500 transition-colors" />
                  </div>
                </motion.button>
              );
            })}

            <Button
              variant="ghost"
              onClick={() => setSelectedMode(null)}
              className="w-full mt-4"
            >
              ← Back
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}