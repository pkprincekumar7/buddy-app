import notifee, {
  AuthorizationStatus,
  AndroidImportance,
  TriggerType,
} from '@notifee/react-native';
import { Platform } from 'react-native';

const CHANNEL_ID = 'buddy360';
const CHANNEL_NAME = 'Buddy360 Notifications';

async function ensureAndroidChannel(): Promise<string> {
  if (Platform.OS !== 'android') return CHANNEL_ID;
  return notifee.createChannel({
    id: CHANNEL_ID,
    name: CHANNEL_NAME,
    importance: AndroidImportance.HIGH,
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

export async function hasNotificationPermission(): Promise<boolean> {
  const settings = await notifee.getNotificationSettings();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

export async function displayLocalNotification(
  title: string,
  body: string,
): Promise<void> {
  const channelId = await ensureAndroidChannel();
  await notifee.displayNotification({
    title,
    body,
    android: {
      channelId,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
    },
  });
}

export async function scheduleActivityReminder(
  title: string,
  body: string,
  triggerDate: Date,
): Promise<string> {
  const channelId = await ensureAndroidChannel();
  return notifee.createTriggerNotification(
    {
      title,
      body,
      android: { channelId, smallIcon: 'ic_launcher' },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: triggerDate.getTime(),
    },
  );
}

export async function cancelNotification(id: string): Promise<void> {
  await notifee.cancelNotification(id);
}

export async function cancelAllNotifications(): Promise<void> {
  await notifee.cancelAllNotifications();
}

export function onForegroundEvent(
  handler: Parameters<typeof notifee.onForegroundEvent>[0],
): () => void {
  return notifee.onForegroundEvent(handler);
}
