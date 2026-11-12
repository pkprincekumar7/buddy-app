// What the child does in child view (docs/child-view-build-plan.md, 2.1), through the
// generated client. The server gives the stars: the app sends what the child did, with
// the child's own day (`date`, YYYY-MM-DD), and shows the activity it answers with.

import type { components } from './generated/children';
import { services, unwrap } from './services';

type Schemas = components['schemas'];

export type KidActivity = Schemas['KidActivity'];
export type KidEvent =
  | Schemas['FlipPower']
  | Schemas['TryPower']
  | Schemas['GameBest']
  | Schemas['MoodIn']
  | Schemas['WorldDone']
  | Schemas['QuestDone']
  | Schemas['ShowWin'];
export type KidMoodKey = Schemas['MoodIn']['mood'];

const at = (id: string, day: string) => ({ params: { path: { id }, query: { date: day } } });

export const kids = {
  activity: (childId: string, day: string): Promise<KidActivity> =>
    unwrap(services.children.GET('/api/v1/children/{id}/kids', at(childId, day))),
  send: (childId: string, day: string, event: KidEvent): Promise<KidActivity> =>
    unwrap(
      services.children.POST('/api/v1/children/{id}/kids/events', {
        ...at(childId, day),
        body: event,
      }),
    ),
};

/** What the kids page shows for a refusal, matched on `detail.code`. */
export const KIDS_ERRORS: Record<string, string> = {
  circle_locked: 'This one opens later. Keep going!',
  bad_date: "Your device's date looks wrong. Please check it.",
  shown_full: 'Your grown-up has lots to see already.',
};
