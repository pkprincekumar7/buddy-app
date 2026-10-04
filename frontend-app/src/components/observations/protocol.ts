/**
 * The observation protocol and next-step copy — ported verbatim from
 * frontend/src/pages/Observations.tsx (SPANS / NEXT_STEPS).
 *
 * Static, and deliberately so: its whole value is being the same procedure for
 * every child — baseline, then one variable at a time, then hold steady — so
 * that what a parent notices in month three is comparable to month one.
 */
import { rgb } from '@/theme';

export interface ObservationStep {
  when: string;
  title: string;
  body: string;
  dot: string;
}

export interface ObservationSpan {
  label: string;
  tag: string;
  title: string;
  cadence: string;
  steps: ObservationStep[];
}

const CYAN = rgb('constellation-cyan');
const GOLD = rgb('constellation-gold');

export const SPANS: ObservationSpan[] = [
  {
    label: '1 month',
    tag: 'Get a baseline',
    title: 'Month one: write it down as it happens',
    cadence: 'Two short notes a week',
    steps: [
      {
        when: 'Week 1',
        title: 'Same questions, no changes',
        body: 'Answer as things are. Change nothing yet.',
        dot: CYAN,
      },
      {
        when: 'Week 2',
        title: 'Note the setting',
        body: 'Where it happened and what came before.',
        dot: CYAN,
      },
      {
        when: 'Week 3',
        title: 'Note the exceptions',
        body: 'The days it did not happen matter too.',
        dot: GOLD,
      },
      {
        when: 'Week 4',
        title: 'First look back',
        body: 'Your notes side by side, to see what repeated.',
        dot: GOLD,
      },
    ],
  },
  {
    label: '2 months',
    tag: 'Look for the pattern',
    title: 'Month two: test the pattern against another view',
    cadence: 'Weekly note, one school check-in',
    steps: [
      {
        when: 'Week 5',
        title: 'Bring in a second observer',
        body: 'A teacher or coach answers the same questions.',
        dot: CYAN,
      },
      {
        when: 'Week 6',
        title: 'Try one small change',
        body: 'One only. Movement before homework, say.',
        dot: CYAN,
      },
      {
        when: 'Week 7',
        title: 'Keep the change steady',
        body: 'Long enough to tell it from a good week.',
        dot: GOLD,
      },
      {
        when: 'Week 8',
        title: 'Compare the two views',
        body: 'Where both views agree is the sturdiest part.',
        dot: GOLD,
      },
    ],
  },
  {
    label: '3 months',
    tag: 'Decide the next step',
    title: 'Month three: see the whole picture',
    cadence: 'Fortnightly note, one summary',
    steps: [
      {
        when: 'Week 9',
        title: 'Hold the routine',
        body: 'No new changes. Keep conditions steady.',
        dot: CYAN,
      },
      {
        when: 'Week 10',
        title: 'Note what {he} say{s}',
        body: '{His} own words about {his} day, kept verbatim.',
        dot: CYAN,
      },
      {
        when: 'Week 11',
        title: 'Build the summary',
        body: 'A one page record of the ninety days.',
        dot: GOLD,
      },
      {
        when: 'Week 12',
        title: 'Choose what happens next',
        body: 'Keep watching, close the note, or share the page.',
        dot: GOLD,
      },
    ],
  },
];

/**
 * Product affordances, each mapping to a real feature. `{his}`/`{him}` resolve
 * against the child's gender at render time.
 */
export const NEXT_STEPS = [
  {
    title: 'Share it with {his} teacher',
    body: 'Makes a school conversation shorter and more specific.',
  },
  {
    title: 'Use it to shape {his} routine',
    body: 'The settings that work for {him} are already in your notes.',
  },
  {
    title: 'Or simply keep watching',
    body: 'Many patterns settle on their own as children grow.',
  },
];
