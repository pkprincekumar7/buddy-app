/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// Smoke test: the provider tree + navigator mount without throwing. The auth
// check hits the (mocked-empty) API and settles on the signed-out Login stack.
beforeAll(() => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve('{"detail":"Not authenticated"}'),
    json: () => Promise.resolve({ detail: 'Not authenticated' }),
  }) as unknown as typeof fetch;
});

test('renders correctly', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
