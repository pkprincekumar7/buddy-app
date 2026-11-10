// The conversational onboarding (build plan 7.5), through the generated client. The app
// keeps the answers while the parent chats, then saves all seven in one PUT at the end.
// Onboarding then records the chat as done, and discover starts the personality on its
// own: the app starts no job.

import { children } from './children';
import { ApiError } from './errors';
import type { components } from './generated/onboarding';
import { services, unwrap } from './services';

export type Answers = components['schemas']['Answers'];
export type Conversation = components['schemas']['Onboarding'];

const LISTS = ['strengths', 'hobbies'] as const;
const TEXTS = [
  'thinking_pattern',
  'communication_style',
  'energy_level',
  'social_behaviour',
  'emotional_behaviour',
] as const;

const byId = (id: string) => ({ params: { path: { id } } });

export const onboarding = {
  /** The answers once the chat is done; `status: 'not_started'` and no answers before. */
  get: (childId: string): Promise<Conversation> =>
    unwrap(
      services.onboarding.GET(
        '/api/v1/children/{id}/onboarding',
        byId(childId),
      ),
    ),
  /** All seven answers, once, at the end of the chat (again later only to change them). */
  save: (childId: string, answers: Answers): Promise<Conversation> =>
    unwrap(
      services.onboarding.PUT('/api/v1/children/{id}/onboarding', {
        ...byId(childId),
        body: answers,
      }),
    ),

  /** What the chat resumes from: the child's own fields, plus the answers once it's done. */
  async draft(childId: string): Promise<Record<string, unknown>> {
    const [child, conversation] = await Promise.all([
      children.get(childId),
      onboarding.get(childId).catch((err: unknown) => {
        // Locked (no profile yet) or unreachable: the chat simply starts from the top.
        if (!(err instanceof ApiError)) throw err;
        console.warn('[onboarding] No saved answers:', err.code ?? err.status);
        return null;
      }),
    ]);
    return {
      name: child.name,
      ...(child.age === null ? {} : { age: String(child.age) }),
      ...(child.gender === null ? {} : { gender: child.gender }),
      ...(child.school === null ? {} : { school: child.school }),
      ...conversation?.answers,
    };
  },
};

/** The seven answers from what the chat collected, or null while one is still missing. */
export function answersFrom(
  collected: Record<string, unknown>,
): Answers | null {
  const answers: Record<string, string | string[]> = {};
  for (const field of LISTS) {
    const value = collected[field];
    const items = (
      Array.isArray(value)
        ? value
        : typeof value === 'string'
        ? value.split(',')
        : []
    )
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => item !== '');
    if (items.length === 0) return null;
    answers[field] = items;
  }
  for (const field of TEXTS) {
    const value = collected[field];
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '') return null;
    answers[field] = text;
  }
  return answers as Answers;
}

/** What the chat shows for a refusal, matched on `detail.code`. */
export const ONBOARDING_ERRORS: Record<string, string> = {
  circle_locked: "Please finish your child's profile first.",
  conversation_changed: 'The answers changed meanwhile. Please try again.',
  child_not_found: "That child couldn't be found.",
  children_unavailable:
    'We couldn’t reach the server just now. Please try again in a moment.',
};
