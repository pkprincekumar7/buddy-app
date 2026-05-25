import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { areaByUrlName, AREA_QUESTIONS } from '@/lib/growthAreaData';
import ChildActivityGame from '@/components/onboarding/ChildActivityGame';
import { SPINNER } from '@/lib/animations';
import StartOverButton from '@/components/shared/StartOverButton';

export default function GrowthAreasActivityGame() {
  const navigate = useNavigate();
  const { childId, activity } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();

  const area = areaByUrlName(activity ?? '');

  const [childName, setChildName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savedAnswers, setSavedAnswers] = useState<Record<string, unknown>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      navigate('/Home', { replace: true });
      return;
    }
    if (!area) {
      navigate(`/GrowthAreas/${childId}`, { replace: true });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          navigate('/Home', { replace: true });
          return;
        }

        const childRecord = child as Record<string, unknown>;
        setChildName((childRecord['name'] as string) || '');

        // Restore previously saved game selections
        const completedData = await api.completedGrowthAreas.list(childRecord['id'] as string);
        if (cancelled) return;
        const completedRecord = completedData as Record<string, unknown> | null;
        const allDocs = Array.isArray(completedRecord?.['areas'])
          ? (completedRecord['areas'] as Record<string, unknown>[])
          : [];
        const areaDoc = allDocs.find((a) => a['area_id'] === area.id) ?? {};
        const childActivity = areaDoc['child_activity'] as Record<string, unknown> | undefined;
        const saved =
          (childActivity?.['selections'] as string[] | undefined) ??
          (areaDoc['child_activity_selections'] as string[] | undefined) ??
          [];
        if (Array.isArray(saved) && saved.length > 0) setSelectedIds(saved);
        const ia = areaDoc['interactive_answers'];
        if (ia && typeof ia === 'object') setSavedAnswers(ia as Record<string, unknown>);
      } catch (err) {
        console.warn('[GrowthAreasActivityGame] Load failed:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, activity, area, navigate]);

  const handleGameComplete = useCallback(
    async (result: Record<string, unknown>) => {
      if (!childId || !area) return;
      try {
        await api.completedGrowthAreas.append(childId, {
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          answers: savedAnswers,
          status: 'in_progress',
          step: 'activity_summary',
          child_activity: {
            selections: result.selections ?? [],
            results: result.recommendations ?? null,
          },
          child_activity_selections: result.selections ?? [],
        });
      } catch (err) {
        console.error('[GrowthAreasActivityGame] Save failed:', err);
        toast.error('Could not save game results. Try again or check your connection.');
        return;
      }
      navigate(`/GrowthAreas/${childId}/Activity/${activity}/GreatInsights`);
    },
    [childId, area, activity, navigate, savedAnswers],
  );

  const handleSelectedIdsChange = useCallback(
    async (ids: string[]) => {
      setSelectedIds(ids);
      if (!childId || !area) return;
      try {
        await api.completedGrowthAreas.append(childId, {
          area_id: area.id,
          area_name: area.name,
          area_color: area.color,
          answers: savedAnswers,
          status: 'in_progress',
          step: 'activity_summary',
          child_activity_selections: ids,
        });
      } catch {
        /* non-fatal */
      }
    },
    [childId, area, savedAnswers],
  );

  if (isLoadingAuth || !hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          {...SPINNER}
          className="h-10 w-10 rounded-full border-2 border-teal-500 border-t-transparent"
        />
      </div>
    );
  }

  if (!area) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Area header */}
      <div className="border-b-edge-faint sticky top-0 z-40 bg-sidebar/90 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${area.color}`}
            >
              <area.icon className="h-5 w-5 text-white" />
            </div>
            <p className="text-sm font-semibold text-white">{area.name} — Activity</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        <ChildActivityGame
          childName={childName}
          areaId={area.id}
          activeChildId={childId}
          selectedIds={selectedIds}
          onSelectedIdsChange={(ids) => {
            void handleSelectedIdsChange(ids);
          }}
          onComplete={handleGameComplete}
        />
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              const questions = (AREA_QUESTIONS as Record<string, unknown[]>)[area.id] ?? [];
              navigate(`/GrowthAreas/${childId}/Activity/${activity}?q=${questions.length}`);
            }}
            className="btn-secondary h-12 w-full rounded-2xl px-6 sm:w-auto"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <StartOverButton childId={childId} className="w-full sm:w-auto" />
        </div>
      </div>
    </div>
  );
}
