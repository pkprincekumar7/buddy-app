// A stand-in for the children service's kid activity (backend/children/app/kids.py), so a
// child view test can play: each event the app sends changes the state the next read
// returns, with the server's rules: stars given once per award (a power's first flip +1, a
// power tried today +1, the Discover badge +3 once all seven are flipped, a day's mood +1),
// a best time kept only when faster, and circles_done derived from what was done.

import type { Call, Stubs } from '../fixtures';
import { TODAY, aKidActivity } from './builders';
import type { ChildrenSchemas } from './routes';

type KidActivity = ChildrenSchemas['schemas']['KidActivity'];
type Event =
  | ChildrenSchemas['schemas']['FlipPower']
  | ChildrenSchemas['schemas']['TryPower']
  | ChildrenSchemas['schemas']['GameBest']
  | ChildrenSchemas['schemas']['MoodIn']
  | ChildrenSchemas['schemas']['ShowWin'];

const POWERS = 7;

export class KidServer {
  state: KidActivity;
  readonly events: Event[] = [];
  private readonly awards = new Set<string>();

  constructor(initial: KidActivity = aKidActivity()) {
    this.state = structuredClone(initial);
    for (const p of initial.flipped_powers) this.awards.add(`power:${p}`);
    if (initial.discover_badge) this.awards.add('badge:discover');
    for (const day of Object.keys(initial.moods)) this.awards.add(`mood:${day}`);
  }

  private award(key: string, stars: number): void {
    if (this.awards.has(key)) return;
    this.awards.add(key);
    this.state.stars += stars;
  }

  apply(event: Event, day = TODAY): KidActivity {
    this.events.push(event);
    const s = this.state;
    switch (event.type) {
      case 'flip_power':
        if (!s.flipped_powers.includes(event.power)) s.flipped_powers.push(event.power);
        this.award(`power:${event.power}`, 1);
        if (s.flipped_powers.length >= POWERS) {
          s.discover_badge = true;
          this.award('badge:discover', 3);
          s.circles_done = { ...s.circles_done, discover: true };
        }
        break;
      case 'try_power':
        if (!s.tried_today.includes(event.power)) s.tried_today.push(event.power);
        this.award(`try:${event.power}:${day}`, 1);
        break;
      case 'game_best': {
        const before = s.best_times[event.game];
        if (before === undefined || event.seconds < before)
          s.best_times[event.game] = event.seconds;
        break;
      }
      case 'mood':
        s.moods[day] = { mood: event.mood, note: event.note ?? null };
        this.award(`mood:${day}`, 1);
        s.circles_done = { ...s.circles_done, release: true };
        break;
      case 'show_win':
        s.shown = { ...s.shown, [event.key]: { title: event.title, at: `${day}T10:00:00Z` } };
        s.circles_done = { ...s.circles_done, connect: true };
        break;
    }
    return structuredClone(s);
  }

  /** The two routes, answering from this state. */
  stubs(): Stubs {
    return {
      'GET /children/{id}/kids': () => ({ body: structuredClone(this.state) }),
      'POST /children/{id}/kids/events': (call: Call) => ({
        body: this.apply(call.body as Event, call.query.get('date') ?? TODAY),
      }),
    };
  }
}
