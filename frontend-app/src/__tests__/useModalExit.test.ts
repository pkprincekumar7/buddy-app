import { act, renderHook } from '@testing-library/react-native';
import { modalFade, useModalExit } from '@/lib/useModalExit';

describe('useModalExit', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps the Modal up while the content fades out, then takes it down', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useModalExit(open),
      { initialProps: { open: true } },
    );
    expect(result.current).toBe(true);
    rerender({ open: false });
    expect(result.current).toBe(true); // still up for the fade
    act(() => jest.advanceTimersByTime(299));
    expect(result.current).toBe(true);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('stays up when opened again during the fade', () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useModalExit(open),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    act(() => jest.advanceTimersByTime(150));
    rerender({ open: true });
    act(() => jest.advanceTimersByTime(500));
    expect(result.current).toBe(true);
  });

  it('starts closed when closed', () => {
    const { result } = renderHook(() => useModalExit(false));
    act(() => jest.advanceTimersByTime(300));
    expect(result.current).toBe(false);
  });
});

describe('modalFade', () => {
  it('shows at once when open and fades when closing', () => {
    expect(modalFade(true)).toMatchObject({
      opacity: 1,
      transitionDuration: 0,
    });
    expect(modalFade(false)).toMatchObject({
      opacity: 0,
      transitionDuration: 250,
      pointerEvents: 'none',
    });
  });
});
