import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { createPageUrl } from '@/utils';
import { determinePhase } from '@/lib/onboardingHelpers';

export function useOnboardingComplete({
  dispatch,
  childData,
  mbtiResult,
  generatedProfile,
  recommendations,
  pendingActivities,
}) {
  const navigate = useNavigate();

  return useCallback(async () => {
    dispatch({ type: 'SET_COMPLETION_BUSY', payload: true });
    try {
      const age = parseInt(childData.age, 10) || 10;
      const phase = determinePhase(age);

      const existingChildren = await api.entities.Child.list('-created_date', 1);
      const childExists =
        existingChildren &&
        existingChildren.length > 0 &&
        existingChildren[0].name?.toLowerCase() === childData.name?.toLowerCase();

      const today = new Date();
      const dob = new Date(today.getFullYear() - age, today.getMonth(), today.getDate());

      const finalData = {
        ...childData,
        date_of_birth: dob.toISOString().split('T')[0],
        current_phase: phase,
        onboarding_completed: true,
        personality_traits: childData.strengths || [],
        interests: childData.hobbies || [],
        mbti_type: mbtiResult?.type,
        generated_profile: generatedProfile,
        recommendations,
      };

      if (!childExists) {
        await api.entities.Child.create(finalData);
      }

      const children = await api.entities.Child.list('-created_date', 1);
      const newChild = children[0];

      const existingMissions = await api.entities.GrowthMission.filter({ child_id: newChild.id });
      const missionsExist = existingMissions && existingMissions.length > 0;

      if (newChild) {
        const allMissions = [];

        if (recommendations?.initial_missions) {
          const pillarMap = {
            Mind: 'cognitive', Heart: 'emotional', Body: 'physical',
            Talent: 'talent', Character: 'character', Future: 'future',
          };
          allMissions.push(...recommendations.initial_missions.map(m => ({
            child_id: newChild.id,
            title: m.title,
            description: m.description,
            pillar: pillarMap[m.pillar] || 'cognitive',
            status: 'active',
            difficulty: 'easy',
            week_number: 1,
          })));
        }

        if (pendingActivities.length > 0) {
          allMissions.push(...pendingActivities.map(activity => ({
            child_id: newChild.id,
            title: activity.title,
            description: activity.description,
            pillar: activity.pillar || 'future',
            status: 'active',
            difficulty: 'medium',
            week_number: 1,
            activity_type: 'interactive',
            activity_data: {
              questions: activity.questions || [],
              instructions: activity.instructions || [],
              estimated_time: activity.estimated_time || '10-15 min',
            },
          })));
        }

        if (allMissions.length > 0 && !missionsExist) {
          await api.entities.GrowthMission.bulkCreate(allMissions);
        }
      }

      navigate(createPageUrl('LifePathway'), { replace: true });
    } catch (err) {
      console.error('[Onboarding] Failed to save journey:', err);
      toast.error('Something went wrong saving your journey. Please try again.');
    } finally {
      dispatch({ type: 'SET_COMPLETION_BUSY', payload: false });
    }
  }, [dispatch, childData, mbtiResult, generatedProfile, recommendations, pendingActivities, navigate]);
}
