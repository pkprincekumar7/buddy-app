const mockSpeak = jest.fn();
jest.mock('@mhpdev/react-native-speech', () => ({
  __esModule: true,
  default: {
    stop: jest.fn(() => Promise.resolve()),
    configure: jest.fn(),
    speak: (...args: unknown[]) => mockSpeak(...args),
    onFinish: jest.fn(() => ({ remove: jest.fn() })),
    onStopped: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

import { speakText } from '@/lib/tts';

describe('speakText', () => {
  it('still calls onDone when speak() rejects', async () => {
    mockSpeak.mockReturnValueOnce(Promise.reject(new Error('no voice')));
    const onDone = jest.fn();
    speakText('hello', { onDone });
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
