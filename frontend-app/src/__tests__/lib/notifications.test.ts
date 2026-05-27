import {
  requestNotificationPermission,
  hasNotificationPermission,
  displayLocalNotification,
  scheduleActivityReminder,
  cancelAllNotifications,
} from '@/lib/notifications';

// notifee is mocked in jest.setup.ts
import notifee from '@notifee/react-native';

describe('notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requestNotificationPermission returns true when authorized', async () => {
    const result = await requestNotificationPermission();
    expect(result).toBe(true);
    expect(notifee.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('hasNotificationPermission checks getNotificationSettings', async () => {
    const result = await hasNotificationPermission();
    expect(result).toBe(true);
    expect(notifee.getNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it('displayLocalNotification calls notifee.displayNotification', async () => {
    await displayLocalNotification('Test Title', 'Test Body');
    expect(notifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test Title', body: 'Test Body' }),
    );
  });

  it('scheduleActivityReminder calls createTriggerNotification with timestamp', async () => {
    const futureDate = new Date(Date.now() + 60_000);
    await scheduleActivityReminder('Reminder', 'Do your activity', futureDate);
    expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Reminder', body: 'Do your activity' }),
      expect.objectContaining({ timestamp: futureDate.getTime() }),
    );
  });

  it('cancelAllNotifications delegates to notifee', async () => {
    await cancelAllNotifications();
    expect(notifee.cancelAllNotifications).toHaveBeenCalledTimes(1);
  });
});
