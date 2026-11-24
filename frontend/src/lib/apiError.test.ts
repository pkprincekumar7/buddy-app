import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { httpErrorMessage } from './apiError';

// The message a failed call shows (lib/apiError.ts), in its order: a blocked country,
// then the code, the status, the service's own words, a plain detail, the fallback.

const err = (status: number, detail: string | Record<string, unknown>) =>
  new ApiError(status, detail);

describe('httpErrorMessage', () => {
  it("a blocked country's message wins over everything else", () => {
    const e = err(403, { code: 'country_not_supported', msg: 'Not in your country yet.' });
    expect(
      httpErrorMessage(e, {
        statusMessages: { 403: 'Email not authorized' },
        codeMessages: { country_not_supported: 'by code' },
      }),
    ).toBe('Not in your country yet.');
  });

  it('a blocked country with no message of its own gets the standard one', () => {
    expect(httpErrorMessage(err(403, { code: 'country_not_supported' }))).toBe(
      'This service is not available in your country.',
    );
  });

  it('matches the code before the status', () => {
    const e = err(409, { code: 'email_taken', msg: 'taken' });
    expect(
      httpErrorMessage(e, {
        codeMessages: { email_taken: 'Already registered.' },
        statusMessages: { 409: 'Conflict' },
      }),
    ).toBe('Already registered.');
  });

  it('then the status, then the service’s own message', () => {
    expect(httpErrorMessage(err(500, { msg: 'Boom' }), { statusMessages: { 500: 'Down' } })).toBe(
      'Down',
    );
    expect(httpErrorMessage(err(500, { msg: 'Boom' }))).toBe('Boom');
  });

  it("a 422's first problem, without pydantic's prefix", () => {
    const e = err(422, {
      errors: [{ msg: 'Value error, Too short' }, { msg: 'Value error, Second' }],
    });
    expect(httpErrorMessage(e)).toBe('Too short');
  });

  it.each([
    ['no problems listed', { errors: [] }],
    ['a problem with no message', { errors: [{ loc: ['body'] }] }],
    ['an object with neither', { code: 'x' }],
  ])('%s: the fallback', (_what, detail) => {
    expect(httpErrorMessage(err(422, detail), { fallback: 'Please check the form.' })).toBe(
      'Please check the form.',
    );
  });

  it('a plain-text detail is shown as it is', () => {
    expect(httpErrorMessage(err(400, 'Bad thing'), { fallback: 'x' })).toBe('Bad thing');
  });

  it("an error that isn't the API's shows its own message, or the fallback", () => {
    expect(httpErrorMessage(new Error('Failed to fetch'))).toBe('Failed to fetch');
    expect(httpErrorMessage(null, { fallback: 'Nope' })).toBe('Nope');
    expect(httpErrorMessage(undefined)).toBe('Something went wrong.');
  });
});
