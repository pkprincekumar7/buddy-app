import { useNavigate } from 'react-router';
import { Star } from 'lucide-react';
import type { Child } from '@/api/children';
import { questSummary, shortDay } from '@/api/kidQuests';
import { daysAgo } from '@/api/kidWorlds';
import { useKidActivity } from '@/hooks/useKidActivity';
import { useKidQuests } from '@/hooks/useKidQuests';
import { Button } from '@/components/ui/button';

/**
 * What a child did in child view, on the parent's Home (docs/child-view-build-plan.md, P.2):
 * the wins they chose to show ("Show my grown-up") and the quests they logged, newest first.
 * Here because the parent's own Connect and Life Pathway open later in parent view. Hidden
 * until there's something to show; "Share" opens Connect once it's open.
 */
export default function ChildViewNews({ child }: { child: Child }) {
  const navigate = useNavigate();
  const { activity } = useKidActivity(child.id);
  const { quests } = useKidQuests(child.id);
  const wins = Object.values(activity?.shown ?? {}).sort((a, b) => b.at.localeCompare(a.at));
  const logged = (quests ? questSummary(quests) : [])
    .flatMap((interest) => interest.quests.map((q) => ({ ...q, interest: interest.label })))
    .filter((q) => q.count > 0 && q.lastLogged)
    .sort((a, b) => (b.lastLogged ?? '').localeCompare(a.lastLogged ?? ''));
  if (wins.length === 0 && logged.length === 0) return null;

  return (
    <section
      aria-label={`From ${child.name}'s child view`}
      className="border-edge-faint mx-auto mt-6 w-full max-w-2xl rounded-2xl bg-card p-5 text-left"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          From {child.name}&apos;s child view
        </h2>
        {child.progress.release && wins.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate(`/Connect/${child.id}`)}
            className="rounded-full"
          >
            Share from Connect
          </Button>
        )}
      </div>
      {wins.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {child.name} wants to show you
          </p>
          <ul className="mt-2 grid gap-2">
            {wins.map((w) => (
              <li key={w.title} className="flex items-center gap-2 text-sm text-foreground">
                <Star className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex-1">{w.title}</span>
                <span className="text-muted-foreground">{daysAgo(w.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {logged.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quests
          </p>
          <ul className="mt-2 grid gap-2">
            {logged.slice(0, 5).map((q) => (
              <li
                key={`${q.interest}-${q.title}`}
                className="flex flex-wrap justify-between gap-2 text-sm"
              >
                <span className="text-foreground">
                  {q.title} <span className="text-muted-foreground">· {q.interest}</span>
                </span>
                <span className="text-muted-foreground">
                  {q.count >= q.target ? 'Done' : `${q.count} of ${q.target}`} · last{' '}
                  {q.lastLogged ? shortDay(q.lastLogged) : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
