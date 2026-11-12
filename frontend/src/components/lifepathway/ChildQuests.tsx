import { useKidQuests } from '@/hooks/useKidQuests';
import { anyLogged, questSummary, shortDay } from '@/api/kidQuests';
import { BODY, CYAN, FROST, GOLD, LABEL_CL } from '@/components/lifepathway/theme';

interface ChildQuestsProps {
  childId: string;
  childName: string;
}

const CARD: React.CSSProperties = {
  marginTop: 16,
  padding: '18px 20px',
  borderRadius: 18,
  background: 'rgb(var(--constellation-navy-deepest-rgb) / .6)',
  border: '1px solid rgb(var(--constellation-cyan-rgb) / .2)',
};

/**
 * The child's Transform quests on the parent's Life Pathway (docs/child-view-build-plan.md,
 * 3.3): the plan's interest and any the child added, each quest's count and when it was last
 * done, or "Nothing logged yet". In the page's own constellation tokens. Hidden while it
 * loads or when transform refuses (the circle's lock).
 */
export default function ChildQuests({ childId, childName }: ChildQuestsProps) {
  const { quests } = useKidQuests(childId);
  if (!quests) return null;
  const summary = questSummary(quests);
  const who = childName || 'Your child';

  return (
    <section style={{ marginTop: 56 }} aria-labelledby="lp-child-quests">
      <h2
        id="lp-child-quests"
        className="font-orbitron"
        style={{ fontWeight: 900, fontSize: 17, color: 'rgb(var(--constellation-cyan-paler-rgb))' }}
      >
        {who}&apos;s quests
      </h2>
      <p style={{ marginTop: 6, fontSize: 13.5, fontWeight: 600, color: BODY }}>
        What {who} does in child view, quest by quest.
      </p>
      {!anyLogged(quests) || summary.length === 0 ? (
        <div style={CARD}>
          <p style={{ fontWeight: 700, color: FROST }}>Nothing logged yet.</p>
          <p style={{ marginTop: 4, fontSize: 13.5, fontWeight: 600, color: BODY }}>
            When {who} ticks off a quest in child view, it shows here.
          </p>
        </div>
      ) : (
        summary.map((interest) => (
          <div key={interest.key} style={CARD}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span className="font-orbitron" style={{ fontWeight: 900, color: FROST }}>
                {interest.label}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: interest.fromParent ? GOLD : CYAN,
                }}
              >
                {interest.fromParent ? 'From your plan' : `${who} added`}
              </span>
            </div>
            <ul style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {interest.quests.map((q) => (
                <li
                  key={q.title}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                    fontSize: 14.5,
                    fontWeight: 600,
                    color: BODY,
                  }}
                >
                  <span style={{ color: FROST }}>{q.title}</span>
                  <span>
                    <span style={{ fontWeight: 700, color: q.count >= q.target ? GOLD : CYAN }}>
                      {q.count >= q.target ? 'Done' : `${q.count} of ${q.target}`}
                    </span>
                    <span style={{ color: LABEL_CL }}>
                      {' · '}
                      {q.lastLogged ? `last ${shortDay(q.lastLogged)}` : 'not yet'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
