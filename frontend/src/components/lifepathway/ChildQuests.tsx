import { useKidQuests } from '@/hooks/useKidQuests';
import { anyLogged, daysAgo, questSummary, questTotals } from '@/api/kidQuests';
import { localDay } from '@/lib/kidsDay';

interface ChildQuestsProps {
  childId: string;
  childName: string;
}

const C = (token: string, alpha?: number) =>
  alpha === undefined
    ? `rgb(var(--constellation-${token}-rgb))`
    : `rgb(var(--constellation-${token}-rgb) / ${alpha})`;

/** A small uppercase pill ("2/3 quests done", "Not started"). */
const PILL: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 999,
  border: `1px solid ${C('cyan', 0.25)}`,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: C('slate-pale'),
  whiteSpace: 'nowrap',
};

/**
 * The child's Transform quests on the parent's Life Pathway (docs/child-view-build-plan.md,
 * 3.3), as the prototype's panel: "{name}'s quests" with a done chip, "Your topic: {interest}
 * · done in child view", the plan topic's "Logged" and "Finished n/3", then each quest with its
 * progress ring, status and when it was last logged; before any log, the topic and "Not
 * started". Any interest the child added follows, with its own label. Hidden while it loads or
 * when transform refuses (the circle's lock).
 */
export default function ChildQuests({ childId, childName }: ChildQuestsProps) {
  const { quests } = useKidQuests(childId);
  if (!quests) return null;
  const summary = questSummary(quests);
  // The first name, or "Your child" when none is saved.
  const name = childName.trim();
  const who = name.length > 0 ? (name.split(/\s+/)[0] ?? name) : 'Your child';
  const topic = summary.find((s) => s.fromParent) ?? summary[0];
  const totals = topic ? questTotals(topic.quests) : null;
  // Anything logged, in the plan's topic or an interest the child added, shows the list; the
  // header's chip and counts are the plan topic's own (0/3 when only an added one is logged).
  const started = anyLogged(quests);
  const today = localDay();

  return (
    <section style={{ marginTop: 56 }} aria-labelledby="lp-child-quests">
      <div
        style={{
          borderRadius: 20,
          background: C('panel', 0.62),
          border: `1px solid ${C('cyan', 0.14)}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '22px 24px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            borderBottom: `1px solid ${C('cyan', 0.09)}`,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2
                id="lp-child-quests"
                className="font-orbitron"
                style={{ fontWeight: 700, fontSize: 17, color: C('cyan-paler') }}
              >
                {who}&apos;s quests
              </h2>
              <span style={PILL}>
                {started && totals
                  ? `${totals.finished}/${totals.total} quests done`
                  : 'Not started'}
              </span>
            </div>
            <p style={{ marginTop: 5, fontSize: 13, fontWeight: 600, color: C('slate-warm') }}>
              {topic ? `Your topic: ${topic.label} · done in child view` : 'Done in child view'}
            </p>
          </div>
          {started && totals && (
            <div style={{ display: 'flex', gap: 22 }}>
              {[
                { n: String(totals.logged), label: 'Logged', on: false },
                {
                  n: `${totals.finished}/${totals.total}`,
                  label: 'Finished',
                  on: totals.finished > 0,
                },
              ].map((k) => (
                <div key={k.label} style={{ textAlign: 'right' }}>
                  <div
                    className="font-orbitron"
                    style={{
                      fontWeight: 700,
                      fontSize: 19,
                      lineHeight: 1,
                      color: k.on ? C('teal-pale') : C('cyan-pale'),
                    }}
                  >
                    {k.n}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontWeight: 700,
                      fontSize: 9.5,
                      letterSpacing: '.14em',
                      textTransform: 'uppercase',
                      color: C('slate-mute'),
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {k.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!started || !topic ? (
          <div style={{ padding: '26px 24px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15, color: C('cyan-pale') }}>
                {topic?.label ?? 'Quests'}
              </div>
              <div style={PILL}>Not started</div>
            </div>
            <p
              style={{
                marginTop: 6,
                fontSize: 13.5,
                fontWeight: 600,
                lineHeight: 1.5,
                color: C('slate-warm'),
              }}
            >
              When {who} logs a {topic?.label ?? ''} quest in child view, it shows up here.
            </p>
          </div>
        ) : (
          summary.map((interest) => (
            <div key={interest.key}>
              {/* An interest the child added gets its own label (the plan's is the header's). */}
              {interest !== topic && (
                <div
                  style={{
                    padding: '14px 24px 4px',
                    borderTop: `1px solid ${C('cyan', 0.07)}`,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: C('cyan'),
                  }}
                >
                  {interest.label} · {who} added
                </div>
              )}
              <ul>
                {interest.quests.map((q) => {
                  const done = q.count >= q.target;
                  const on = q.count > 0;
                  const pct = Math.min(100, Math.round((q.count / q.target) * 100));
                  return (
                    <li
                      key={q.title}
                      style={{
                        padding: '16px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        borderTop: `1px solid ${C('cyan', 0.07)}`,
                      }}
                    >
                      {/* A progress ring with "count/target", teal once done. */}
                      <div
                        role="img"
                        aria-label={`${q.count} of ${q.target} logged`}
                        style={{
                          flexShrink: 0,
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          padding: 3,
                          background: `conic-gradient(${done ? C('teal') : C('cyan')} ${pct}%, ${C('cyan', 0.12)} 0)`,
                        }}
                      >
                        <div
                          className="font-orbitron"
                          style={{
                            width: '100%',
                            height: '100%',
                            borderRadius: '50%',
                            background: C('ring-core'),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: 12,
                            color: C('cyan-pale'),
                          }}
                          aria-hidden="true"
                        >
                          {q.count}/{q.target}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: 16,
                              lineHeight: 1.25,
                              color: C('cyan-pale'),
                            }}
                          >
                            {q.title}
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: 10,
                              letterSpacing: '.12em',
                              textTransform: 'uppercase',
                              color: done ? C('teal') : on ? C('gold') : C('slate-dim'),
                            }}
                          >
                            {done ? 'Done' : on ? 'In progress' : 'Not started'}
                          </span>
                        </div>
                        <p
                          style={{
                            marginTop: 4,
                            fontSize: 13,
                            fontWeight: 600,
                            lineHeight: 1.4,
                            color: C('slate-warm'),
                          }}
                        >
                          {on
                            ? q.lastLogged
                              ? `Last logged ${daysAgo(q.lastLogged, today)}`
                              : 'Logged'
                            : q.how}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
