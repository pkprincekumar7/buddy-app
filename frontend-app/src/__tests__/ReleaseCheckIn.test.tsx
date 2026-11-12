import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ReleaseCheckIn from '@/components/kids/ReleaseCheckIn';
import type { KidActivity } from '@/api/kids';

const DAY = '2026-11-11';
const activity = (moods: KidActivity['moods'] = {}): KidActivity => ({
  stars: 0,
  circles_done: {
    discover: false,
    grow: false,
    transform: false,
    release: false,
    connect: false,
  },
  flipped_powers: [],
  discover_badge: false,
  tried_today: [],
  best_times: {},
  moods,
});

describe('ReleaseCheckIn', () => {
  it('saves the picked mood, with the note only when there is one', async () => {
    const send = jest.fn().mockResolvedValue(activity());
    const { getByLabelText, getByText } = render(
      <ReleaseCheckIn
        activity={activity()}
        day={DAY}
        sending={false}
        send={send}
      />,
    );
    expect(getByText('Check in today to start a streak')).toBeTruthy();
    fireEvent.press(getByLabelText('Low'));
    expect(getByText('You feel low today.')).toBeTruthy();
    fireEvent.press(getByLabelText('Save'));
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith({ type: 'mood', mood: 'low' }),
    );
    expect(getByText('Saved. Thanks for telling us.')).toBeTruthy();

    fireEvent.changeText(getByLabelText('What happened today?'), '  Rainy.  ');
    fireEvent.press(getByLabelText('Save'));
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith({
        type: 'mood',
        mood: 'low',
        note: 'Rainy.',
      }),
    );
  });

  it("starts from today's saved mood and shows the streak", () => {
    const { getByLabelText, getByText } = render(
      <ReleaseCheckIn
        activity={activity({
          [DAY]: { mood: 'great', note: 'Won!' },
          '2026-11-10': { mood: 'okay', note: null },
        })}
        day={DAY}
        sending={false}
        send={jest.fn()}
      />,
    );
    expect(getByLabelText('Great').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    expect(getByLabelText('What happened today?').props.value).toBe('Won!');
    expect(getByText('2-day streak')).toBeTruthy();
  });

  it('keeps the message when a save fails', async () => {
    const send = jest.fn().mockResolvedValue(null);
    const { getByLabelText, getByText, queryByText } = render(
      <ReleaseCheckIn
        activity={activity()}
        day={DAY}
        sending={false}
        send={send}
      />,
    );
    fireEvent.press(getByLabelText('Good'));
    fireEvent.press(getByLabelText('Save'));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(queryByText('Saved. Thanks for telling us.')).toBeNull();
    expect(getByText('You feel good today.')).toBeTruthy();
  });
});
