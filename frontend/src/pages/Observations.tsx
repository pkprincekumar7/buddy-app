import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { SPINNER } from '@/lib/animations';

// Icon path data ported 1:1 from the "Observations" mockup's IC constant.
const IC = {
  focus: 'M12 4v3M12 17v3M4 12h3M17 12h3M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z',
  read: 'M4 5.5h7v13H4zM20 5.5h-7v13h7z',
  sense: 'M12 4a8 8 0 0 0-8 8v5h4v-6M12 4a8 8 0 0 1 8 8v5h-4v-6',
  motion: 'M13 4l-2 7h5l-3 9M6 9l3-1M18 14l-3 1',
  words: 'M5 7h14M5 12h9M5 17h6',
  social: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c1-3.5 3.2-5.2 6-5.2S14 16.5 15 20M16 5.5a3 3 0 0 1 0 6',
};

interface ObservationNote {
  title: string;
  freq: string;
  icon: string;
  summary: string;
  notes: string[];
}

const OBSERVATIONS: ObservationNote[] = [
  {
    title: 'Attention moves in bursts',
    freq: 'Noted 7 times',
    icon: IC.focus,
    summary:
      'Long stretches of deep focus on what he chooses, and short ones on what is set for him.',
    notes: [
      'Forty minutes on a build, no reminders needed.',
      'Instructions with three parts often land as one.',
    ],
  },
  {
    title: 'Reading takes a longer road',
    freq: 'Noted 5 times',
    icon: IC.read,
    summary:
      'He understands the story easily when he hears it. Getting it off the page takes more effort.',
    notes: ['Reads aloud slower than he speaks.', 'Hears a story once and retells it in detail.'],
  },
  {
    title: 'Sound and texture register strongly',
    freq: 'Noted 4 times',
    icon: IC.sense,
    summary: 'Busy rooms, labels and certain fabrics come up often in how his day went.',
    notes: [
      'Leaves the room when several people talk at once.',
      'Settles faster outdoors than indoors.',
    ],
  },
  {
    title: 'Movement helps him think',
    freq: 'Noted 6 times',
    icon: IC.motion,
    summary: 'He answers better while walking, tapping or holding something in his hands.',
    notes: [
      'Stands up to explain things.',
      'A short run before homework makes a visible difference.',
    ],
  },
  {
    title: 'Words arrive out of order',
    freq: 'Noted 3 times',
    icon: IC.words,
    summary: 'He knows what he means well before he can lay it out in sequence.',
    notes: ['Starts in the middle of a story, then fills in.', 'Writing takes longer than telling.'],
  },
  {
    title: 'Reading the room takes effort',
    freq: 'Noted 4 times',
    icon: IC.social,
    summary: 'Warm one to one, more careful in groups. He watches first and joins late.',
    notes: ['Waits to be invited into a game.', 'Deep with one friend rather than many.'],
  },
];

interface ObservationStep {
  when: string;
  title: string;
  body: string;
  dot: string;
}

interface ObservationSpan {
  label: string;
  tag: string;
  title: string;
  cadence: string;
  steps: ObservationStep[];
}

const SPANS: ObservationSpan[] = [
  {
    label: '1 month',
    tag: 'Get a baseline',
    title: 'Month one: write it down as it happens',
    cadence: 'Two short notes a week',
    steps: [
      { when: 'Week 1', title: 'Same questions, no changes', body: 'Answer as things are. Change nothing yet.', dot: '#4be9ff' },
      { when: 'Week 2', title: 'Note the setting', body: 'Where it happened and what came before.', dot: '#4be9ff' },
      { when: 'Week 3', title: 'Note the exceptions', body: 'The days it did not happen matter too.', dot: '#f0c98a' },
      { when: 'Week 4', title: 'First look back', body: 'Your notes side by side, to see what repeated.', dot: '#f0c98a' },
    ],
  },
  {
    label: '2 months',
    tag: 'Look for the pattern',
    title: 'Month two: test the pattern against another view',
    cadence: 'Weekly note, one school check-in',
    steps: [
      { when: 'Week 5', title: 'Bring in a second observer', body: 'A teacher or coach answers the same questions.', dot: '#4be9ff' },
      { when: 'Week 6', title: 'Try one small change', body: 'One only. Movement before homework, say.', dot: '#4be9ff' },
      { when: 'Week 7', title: 'Keep the change steady', body: 'Long enough to tell it from a good week.', dot: '#f0c98a' },
      { when: 'Week 8', title: 'Compare the two views', body: 'Where both views agree is the sturdiest part.', dot: '#f0c98a' },
    ],
  },
  {
    label: '3 months',
    tag: 'Decide the next step',
    title: 'Month three: see the whole picture',
    cadence: 'Fortnightly note, one summary',
    steps: [
      { when: 'Week 9', title: 'Hold the routine', body: 'No new changes. Keep conditions steady.', dot: '#4be9ff' },
      { when: 'Week 10', title: 'Note what he says', body: 'His own words about his day, kept verbatim.', dot: '#4be9ff' },
      { when: 'Week 11', title: 'Build the summary', body: 'A one page record of the ninety days.', dot: '#f0c98a' },
      { when: 'Week 12', title: 'Choose what happens next', body: 'Keep watching, close the note, or share the page.', dot: '#f0c98a' },
    ],
  },
];

const NEXT_STEPS = [
  { title: 'Share it with his teacher', body: 'Makes a school conversation shorter and more specific.' },
  { title: 'Use it to shape his routine', body: 'The settings that work for him are already in your notes.' },
  { title: 'Or simply keep watching', body: 'Many patterns settle on their own as children grow.' },
];

function CheckIcon({ opacity }: { opacity: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#08131f"
      strokeWidth={3.2}
      style={{ width: 12, height: 12, opacity }}
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5c7688"
      strokeWidth={1.9}
      style={{ width: 15, height: 15, flexShrink: 0, marginTop: 2 }}
    >
      <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#4be9ff" strokeWidth={2.2} style={{ width: 28, height: 28 }}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export default function Observations() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [tracked, setTracked] = useState<number[]>([0, 1]);
  const [span, setSpan] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          void navigate('/Home', { replace: true });
          return;
        }
        setChildName(child.name ?? '');
        setChildAge(child.age != null ? String(child.age) : '');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  const toggleTracked = (index: number) => {
    setTracked((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));
  };

  const chosen = useMemo(() => tracked.map((i) => OBSERVATIONS[i]?.title).filter(Boolean) as string[], [tracked]);
  const activeSpan = SPANS[span] ?? SPANS[0]!;

  const trackedLabel =
    tracked.length === 0 ? 'Nothing selected yet' : `${tracked.length} of ${OBSERVATIONS.length} being watched`;
  const startTitle =
    tracked.length === 0 ? 'Pick at least one observation to watch' : `Watch these for ${activeSpan.label}`;
  const startLine =
    tracked.length === 0
      ? 'Tick the ones that match what you see at home.'
      : 'Same few questions, on this rhythm. Every answer dated. Change the list whenever you like.';
  const startedLine = `${chosen.length} observation${chosen.length === 1 ? ' is' : 's are'} now being watched for ${activeSpan.label}. Your first check-in arrives in three days.`;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#04060d' }}>
        <motion.div
          {...SPINNER}
          className="h-10 w-10 rounded-full border-2 border-t-transparent"
          style={{ borderColor: 'rgba(30,196,232,0.6)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at 82% -5%,rgba(75,233,255,.12),rgba(4,6,13,0) 50%),radial-gradient(ellipse at 8% 60%,rgba(240,201,138,.07),rgba(4,6,13,0) 45%),#04060d',
        fontFamily: 'Rajdhani, sans-serif',
        color: '#e7f5f9',
      }}
    >
      <style>{`
        @keyframes obsFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes obsSwap { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '48px 40px 90px' }}>
        {/* Hero */}
        <section style={{ textAlign: 'center', animation: 'obsFadeUp .7s ease both' }}>
          <div
            style={{
              fontWeight: 700,
              letterSpacing: '.4em',
              fontSize: 11,
              textTransform: 'uppercase',
              color: '#f0c98a',
            }}
          >
            {childName || 'Your child'}
            {childAge && ` · Age ${childAge}`} · Observation log
          </div>
          <h1
            style={{
              margin: '16px auto 0',
              maxWidth: 780,
              fontFamily: 'Orbitron, sans-serif',
              fontWeight: 900,
              fontSize: 'clamp(28px,4vw,44px)',
              lineHeight: 1.12,
            }}
          >
            What we have noticed so far
          </h1>
          <p
            style={{
              margin: '16px auto 0',
              maxWidth: 560,
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.55,
              color: '#a8c1d1',
            }}
          >
            Patterns that came up more than once. Pick the ones to keep an eye on.
          </p>
        </section>

        {/* Observations grid */}
        <section style={{ marginTop: 40, animation: 'obsFadeUp .7s ease .14s both' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontFamily: 'Orbitron, sans-serif',
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#eafdff',
              }}
            >
              Observations
            </div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: '#6f8a9c',
              }}
            >
              {trackedLabel}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))',
              gap: 14,
              marginTop: 16,
            }}
          >
            {OBSERVATIONS.map((obs, index) => {
              const on = tracked.includes(index);
              return (
                <div
                  key={obs.title}
                  style={{
                    borderRadius: 18,
                    padding: '20px 21px',
                    background: on
                      ? 'linear-gradient(150deg,rgba(30,46,72,.85),rgba(8,13,24,.8))'
                      : 'rgba(9,13,22,.6)',
                    border: `1px solid ${on ? 'rgba(75,233,255,.45)' : 'rgba(75,233,255,.12)'}`,
                    transition: 'all .22s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          flexShrink: 0,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'linear-gradient(150deg,#1c2b46,#0a1220)',
                          border: '1.5px solid rgba(240,201,138,.5)',
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="#f0c98a" strokeWidth={1.8} style={{ width: 18, height: 18 }}>
                          <path d={obs.icon} />
                        </svg>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#eafdff' }}>{obs.title}</div>
                        <div
                          style={{
                            marginTop: 2,
                            fontWeight: 700,
                            fontSize: 10.5,
                            letterSpacing: '.16em',
                            textTransform: 'uppercase',
                            color: '#6f8a9c',
                          }}
                        >
                          {obs.freq}
                        </div>
                      </div>
                    </div>
                    <div
                      role="checkbox"
                      aria-checked={on}
                      aria-label={on ? `Stop watching ${obs.title}` : `Watch ${obs.title}`}
                      tabIndex={0}
                      onClick={() => toggleTracked(index)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') toggleTracked(index);
                      }}
                      style={{
                        cursor: 'pointer',
                        flexShrink: 0,
                        width: 22,
                        height: 22,
                        borderRadius: 7,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: `1.5px solid ${on ? '#4be9ff' : 'rgba(120,145,165,.4)'}`,
                        background: on ? '#4be9ff' : 'transparent',
                        transition: 'all .2s ease',
                      }}
                    >
                      <CheckIcon opacity={on ? 1 : 0} />
                    </div>
                  </div>

                  <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.5, color: '#b9cedb' }}>
                    {obs.summary}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {obs.notes.map((note) => (
                      <div
                        key={note}
                        style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 10, alignItems: 'start' }}
                      >
                        <div
                          style={{
                            width: 5,
                            height: 5,
                            marginTop: 8,
                            marginLeft: 4,
                            borderRadius: '50%',
                            background: '#4be9ff',
                          }}
                        />
                        <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.45, color: '#8ba1b1' }}>
                          {note}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Watch it over time */}
        <section style={{ marginTop: 52, animation: 'obsFadeUp .7s ease .2s both' }}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontFamily: 'Orbitron, sans-serif',
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#eafdff',
              }}
            >
              A way to watch it over time
            </div>
            <p
              style={{
                margin: '12px auto 0',
                maxWidth: 520,
                fontSize: 15.5,
                fontWeight: 600,
                lineHeight: 1.5,
                color: '#8ba1b1',
              }}
            >
              Choose how long to watch. Superpower asks the same few questions on a rhythm.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
            {SPANS.map((s, index) => {
              const selected = span === index;
              return (
                <div
                  key={s.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSpan(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSpan(index);
                  }}
                  style={{
                    cursor: 'pointer',
                    minWidth: 150,
                    textAlign: 'center',
                    borderRadius: 15,
                    padding: '14px 22px',
                    background: selected
                      ? 'linear-gradient(150deg,rgba(30,46,72,.9),rgba(8,13,24,.85))'
                      : 'rgba(9,13,22,.6)',
                    border: `1px solid ${selected ? 'rgba(240,201,138,.55)' : 'rgba(75,233,255,.14)'}`,
                    transition: 'all .2s ease',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'Orbitron, sans-serif',
                      fontWeight: 700,
                      fontSize: 17,
                      color: selected ? '#f7fdff' : '#a8c1d1',
                    }}
                  >
                    {s.label}
                  </div>
                  <div style={{ marginTop: 3, fontWeight: 600, fontSize: 12.5, color: '#7e97a8' }}>{s.tag}</div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 22 }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSpan.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                style={{
                  borderRadius: 22,
                  padding: '26px 28px',
                  background: 'linear-gradient(165deg,rgba(14,22,38,.9),rgba(6,9,17,.9))',
                  border: '1px solid rgba(75,233,255,.18)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'Orbitron, sans-serif',
                      fontWeight: 900,
                      fontSize: 20,
                      color: '#f7fdff',
                    }}
                  >
                    {activeSpan.title}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 10.5,
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        color: '#6f8a9c',
                      }}
                    >
                      Check-in rhythm
                    </div>
                    <div style={{ marginTop: 3, fontWeight: 700, fontSize: 15, color: '#f0c98a' }}>
                      {activeSpan.cadence}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
                    gap: 14,
                    marginTop: 24,
                  }}
                >
                  {activeSpan.steps.map((step) => (
                    <div
                      key={step.when}
                      style={{
                        position: 'relative',
                        borderRadius: 15,
                        padding: '17px 18px',
                        background: 'rgba(6,10,18,.7)',
                        border: '1px solid rgba(75,233,255,.14)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: step.dot,
                            boxShadow: `0 0 10px ${step.dot}`,
                          }}
                        />
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 10.5,
                            letterSpacing: '.18em',
                            textTransform: 'uppercase',
                            color: '#7e97a8',
                          }}
                        >
                          {step.when}
                        </div>
                      </div>
                      <div style={{ marginTop: 10, fontWeight: 700, fontSize: 15, color: '#eafdff' }}>
                        {step.title}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 13.5, fontWeight: 600, lineHeight: 1.45, color: '#8ba1b1' }}>
                        {step.body}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        {/* Start tracking */}
        <section style={{ marginTop: 44, animation: 'obsFadeUp .7s ease .26s both' }}>
          <div
            style={{
              borderRadius: 22,
              padding: '26px 28px',
              background: 'linear-gradient(165deg,rgba(10,16,28,.92),rgba(5,8,15,.92))',
              border: '1px solid rgba(240,201,138,.28)',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 22, alignItems: 'center' }}>
              <div>
                <div
                  style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontWeight: 700,
                    fontSize: 18,
                    color: '#f7fdff',
                  }}
                >
                  {startTitle}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 15,
                    fontWeight: 600,
                    lineHeight: 1.5,
                    color: '#a8c1d1',
                    maxWidth: 620,
                  }}
                >
                  {startLine}
                </div>
                {chosen.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                    {chosen.map((title) => (
                      <div
                        key={title}
                        style={{
                          padding: '7px 14px',
                          borderRadius: 999,
                          background: 'rgba(75,233,255,.08)',
                          border: '1px solid rgba(75,233,255,.28)',
                          fontWeight: 700,
                          fontSize: 12,
                          color: '#bfe8f5',
                        }}
                      >
                        {title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setStarted(true)}
                disabled={tracked.length === 0}
                style={{
                  cursor: tracked.length === 0 ? 'default' : 'pointer',
                  flexShrink: 0,
                  padding: '15px 34px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'linear-gradient(135deg,#4be9ff,#f0c98a)',
                  fontFamily: 'Orbitron, sans-serif',
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: '#04121a',
                  boxShadow: '0 0 30px rgba(75,233,255,.3)',
                  opacity: tracked.length === 0 ? 0.4 : 1,
                  pointerEvents: tracked.length === 0 ? 'none' : 'auto',
                  transition: 'all .2s ease',
                }}
              >
                Start tracking
              </button>
            </div>
          </div>
        </section>

        {/* What you can do with this */}
        <section style={{ marginTop: 44, animation: 'obsFadeUp .7s ease .32s both' }}>
          <div
            style={{
              fontFamily: 'Orbitron, sans-serif',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: '#eafdff',
            }}
          >
            What you can do with this
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
              gap: 14,
              marginTop: 16,
            }}
          >
            {NEXT_STEPS.map((next) => (
              <div
                key={next.title}
                style={{
                  borderRadius: 16,
                  padding: '19px 20px',
                  background: 'rgba(9,13,22,.6)',
                  border: '1px solid rgba(75,233,255,.12)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 15.5, color: '#eafdff' }}>{next.title}</div>
                <div style={{ marginTop: 7, fontSize: 14, fontWeight: 600, lineHeight: 1.5, color: '#8ba1b1' }}>
                  {next.body}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, display: 'flex', alignItems: 'flex-start', gap: 9, maxWidth: 760 }}>
            <ShieldIcon />
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5, color: '#6f8a9c' }}>
              Notes stay in your account and are never shared unless you share them. Superpower records
              what you notice. It draws no conclusions and labels nothing.
            </div>
          </div>
        </section>
      </main>

      {/* Tracking started modal */}
      <AnimatePresence>
        {started && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            role="presentation"
            onClick={() => setStarted(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 26,
              background: 'radial-gradient(ellipse at 50% 40%,rgba(8,14,26,.72),rgba(2,3,9,.94) 72%)',
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-label="Tracking started"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 520,
                borderRadius: 22,
                padding: '30px 30px 26px',
                textAlign: 'center',
                background: 'linear-gradient(165deg,rgba(14,22,38,.97),rgba(6,9,17,.97))',
                border: '1px solid rgba(75,233,255,.32)',
                boxShadow: '0 30px 90px rgba(2,6,15,.8)',
              }}
            >
              <div
                style={{
                  width: 66,
                  height: 66,
                  margin: '0 auto',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(75,233,255,.12)',
                  border: '1.5px solid rgba(75,233,255,.5)',
                  boxShadow: '0 0 30px rgba(75,233,255,.22)',
                }}
              >
                <ClockIcon />
              </div>
              <div style={{ marginTop: 18, fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 19, color: '#eafdff' }}>
                Tracking started
              </div>
              <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, lineHeight: 1.5, color: '#a8c1d1' }}>
                {startedLine}
              </div>
              <button
                type="button"
                onClick={() => setStarted(false)}
                style={{
                  cursor: 'pointer',
                  marginTop: 22,
                  padding: '12px 30px',
                  borderRadius: 999,
                  border: '1px solid rgba(75,233,255,.45)',
                  background: 'rgba(6,12,20,.8)',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 700,
                  fontSize: 12.5,
                  letterSpacing: '.16em',
                  textTransform: 'uppercase',
                  color: '#bfe8f5',
                }}
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
