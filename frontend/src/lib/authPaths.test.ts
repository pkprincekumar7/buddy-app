import { describe, expect, it } from 'vitest';
import { afterSignIn, isPublicAuthPath } from './authPaths';

describe('afterSignIn', () => {
  it('goes back to the page that sent you to sign in', () => {
    expect(afterSignIn({ from: '/Observations/c1' }, '/Home')).toBe('/Observations/c1');
  });

  it.each([
    ['no state', undefined],
    ['no page', {}],
    ['not a string', { from: 42 }],
    ['another site', { from: '//evil.example/x' }],
    ['a full address', { from: 'https://evil.example/' }],
    ['a backslash trick', { from: '/\\evil.example' }],
    ['a sign-in page', { from: '/Register' }],
  ])('falls back to Home for %s', (_, state) => {
    expect(afterSignIn(state, '/Home')).toBe('/Home');
  });
});

describe('isPublicAuthPath', () => {
  it('is true only for the sign-in pages', () => {
    expect(isPublicAuthPath('/Login')).toBe(true);
    expect(isPublicAuthPath('/Register')).toBe(true);
    expect(isPublicAuthPath('/Home')).toBe(false);
  });
});
