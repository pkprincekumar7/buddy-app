import * as SecureStore from 'expo-secure-store';
import { DeviceEventEmitter } from 'react-native';
import { AUTH_EXPIRED_EVENT } from '@/api/client';
import { isAbort } from '@/api/polling';
import { services, unwrap } from '@/api/services';

// How a refresh that didn't go through ends (the review of the secure-store move):
// a timeout is a plain failure, never an AbortError, and a pair the server rotated but
// the device couldn't save fails the refresh instead of keeping the spent token.

jest.mock('@/lib/env', () => ({ env: { API_URL: 'https://api.test' } }));

const ACCESS = 'superpower.access_token';
const REFRESH = 'superpower.refresh_token';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let expired: jest.Mock;
beforeEach(async () => {
  await SecureStore.setItemAsync(ACCESS, 'access-1');
  await SecureStore.setItemAsync(REFRESH, 'refresh-1');
  expired = jest.fn();
  DeviceEventEmitter.addListener(AUTH_EXPIRED_EVENT, expired);
});
afterEach(() => {
  DeviceEventEmitter.removeAllListeners(AUTH_EXPIRED_EVENT);
  jest.useRealTimers();
});

test('a refresh that times out fails plainly: not an AbortError, the session kept', async () => {
  jest.useFakeTimers();
  globalThis.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new Request(input as RequestInfo, init).url;
      if (!url.endsWith('/auth/refresh'))
        return json(401, { detail: 'expired' });
      // Never answers: only the client's own 10 s timeout ends it.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    },
  ) as typeof fetch;

  const call = unwrap(services.shared.GET('/api/v1/downloads/apk'));
  const outcome = call.then(
    () => null,
    (err: unknown) => err,
  );
  await jest.advanceTimersByTimeAsync(10_000);
  const err = await outcome;

  expect(err).toBeInstanceOf(Error);
  expect(isAbort(err)).toBe(false); // generation flows treat AbortError as "screen gone"
  expect(expired).not.toHaveBeenCalled();
  expect(await SecureStore.getItemAsync(REFRESH)).toBe('refresh-1');
});

test('a rotated pair the device cannot save fails the refresh, not silently kept', async () => {
  const calls: string[] = [];
  globalThis.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new Request(input as RequestInfo, init).url;
      calls.push(url);
      if (url.endsWith('/auth/refresh')) {
        return json(200, {
          access_token: 'access-2',
          refresh_token: 'refresh-2',
        });
      }
      return json(401, { detail: 'expired' });
    },
  ) as typeof fetch;
  (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(
    new Error('The device is locked'),
  );

  await expect(
    unwrap(services.shared.GET('/api/v1/downloads/apk')),
  ).rejects.toThrow('The device is locked');
  // No retry with a token the store didn't take, and not treated as a refused session.
  expect(calls.filter(u => u.endsWith('/downloads/apk'))).toHaveLength(1);
  expect(expired).not.toHaveBeenCalled();
});
