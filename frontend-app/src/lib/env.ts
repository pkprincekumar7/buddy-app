import Config from 'react-native-config';
import { Platform } from 'react-native';

// In development the web Vite server (port 5173) proxies /app-assets/* → S3.
// Mobile can hit the same Vite server directly — no S3 credentials needed.
// Android emulator reaches the host machine via 10.0.2.2; iOS simulator uses localhost.
const DEV_ASSETS_BASE =
  Platform.OS === 'android' ? 'http://10.0.2.2:5173' : 'http://localhost:5173';

// On Android emulator, 'localhost' in .env resolves to the emulator's own loopback,
// not the host machine. Remap it to 10.0.2.2 so API calls reach the dev server.
// Production URLs (non-localhost) and iOS simulator are unaffected.
function resolveApiUrl(raw: string): string {
  if (Platform.OS === 'android' && raw.includes('localhost')) {
    return raw.replace('localhost', '10.0.2.2');
  }
  return raw;
}

export const env = {
  GOOGLE_CLIENT_ID: Config.GOOGLE_CLIENT_ID ?? '',
  IOS_CLIENT_ID: Config.IOS_CLIENT_ID ?? '',
  API_URL: resolveApiUrl(Config.API_URL ?? ''),
  // Base URL for static assets (/app-assets/*).
  // Set CDN_BASE_URL in .env to point at the production web URL or S3 bucket.
  // Falls back to the local Vite dev server so dev just works without extra config.
  CDN_BASE_URL: Config.CDN_BASE_URL || DEV_ASSETS_BASE,
};
