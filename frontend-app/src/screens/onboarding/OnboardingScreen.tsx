import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSlideUpWhenReady } from '@/lib/animations';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '@/navigation';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { navigateTo } from '@/lib/navigationRef';
import WelcomePhase from '@/components/onboarding/WelcomePhase';
import StartOverButton from '@/components/shared/StartOverButton';
import PageActions from '@/components/shared/PageActions';
import StageSplash from '@/components/shared/StageSplash';
import { useStageSplash } from '@/hooks/useStageSplash';

type OnboardingNavigationProp = StackNavigationProp<OnboardingStackParamList, 'Onboarding'>;

export default function OnboardingScreen() {
  const navigation = useNavigation<OnboardingNavigationProp>();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(true);

  // Preload any existing in-progress child so Continue reuses it instead of creating a new one.
  // No auto-redirects — the user always navigates step by step.
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setChecking(false);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const list = await api.entities.Child.list('-created_date', 1);
        if (cancelled) return;
        const listArr = Array.isArray(list) ? list : [];
        const child = listArr[0];
        if (child && !child.onboarding_completed) {
          setChildId(child.id as string);
        }
      } catch (err) {
        console.warn('[Onboarding] Preload failed:', err);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated]);

  const [showSplash, startTimer] = useStageSplash();
  // Content animates in only when data is ready AND the stage-1 splash is gone —
  // mirrors web: animate={{ opacity: showSplash ? 0 : 1 }}
  const contentStyle = useSlideUpWhenReady(!isLoading && !checking && !showSplash);

  const handleContinue = useCallback(async () => {
    if (!isAuthenticated) {
      navigation.navigate('Onboarding');
      return;
    }
    let targetId = childId;
    if (!targetId) {
      try {
        const created = await api.entities.Child.create({
          onboarding_phase: 1,
          onboarding_completed: false,
        });
        const createdId = created?.id as string | undefined;
        if (createdId) {
          setChildId(createdId);
          targetId = createdId;
        }
      } catch (err) {
        console.warn('[Onboarding] Could not create child stub:', err);
      }
    }
    if (targetId) navigation.navigate('ConversationalOnboarding');
  }, [isAuthenticated, childId, navigation]);

  if (isLoading || checking) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#14b8a6" />
      </View>
    );
  }

  return (
    // Outer wrapper holds page content + absolute-positioned splash overlay.
    // Mirrors web: <> <motion.div opacity={showSplash ? 0 : 1}>…</motion.div> <StageSplash stage={1} /> </>
    <View style={{ flex: 1 }}>
      <Animated.View style={contentStyle} className="flex-1 bg-background">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 32, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="max-w-3xl w-full self-center">
            <WelcomePhase
              onContinue={() => { void handleContinue(); }}
              isAuthenticated={isAuthenticated}
              user={user}
            />
            {/* Actions row: Back (→ Home) + Start Over (when in-progress child exists) */}
            <PageActions
              className="mt-8"
              left={
                <Button
                  variant="outline"
                  onPress={() => navigateTo('Main')}
                  className="h-12 w-full rounded-2xl px-6"
                >
                  <Text className="text-slate-300">← Back</Text>
                </Button>
              }
              center={childId ? <StartOverButton childId={childId} className="w-full" /> : undefined}
            />
          </View>
        </ScrollView>
      </Animated.View>

      {/* Stage-1 splash — matches web Onboarding.tsx <StageSplash stage={1} onReady={startTimer} /> */}
      {showSplash && <StageSplash stage={1} onReady={startTimer} />}
    </View>
  );
}
