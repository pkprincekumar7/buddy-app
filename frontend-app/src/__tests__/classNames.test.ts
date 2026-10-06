import { splitTextClasses } from '@/lib/classNames';

describe('splitTextClasses', () => {
  it('routes text classes to the label and keeps layout classes on the container', () => {
    expect(
      splitTextClasses(
        'h-11 flex-1 rounded-xl bg-error-strong text-base text-white font-bold',
      ),
    ).toEqual({
      text: 'text-base text-white font-bold',
      rest: 'h-11 flex-1 rounded-xl bg-error-strong',
    });
  });
  it('handles empty input', () => {
    expect(splitTextClasses(undefined)).toEqual({ text: '', rest: '' });
  });
});
