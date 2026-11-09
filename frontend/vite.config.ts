import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // The split services, through the local gateway (docs/getting-started.md), which routes
  // as the ALB does. API_PROXY_TARGET points elsewhere, e.g. a dev environment.
  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: env.API_PROXY_TARGET || 'http://127.0.0.1:8088',
      changeOrigin: true,
    },
  };

  // /app-assets/* from an environment's CloudFront site (ASSETS_ORIGIN, https://<fqdn>), not
  // the assets bucket: its policy lets only that distribution read it.
  if (env.ASSETS_ORIGIN) {
    proxy['/app-assets'] = {
      target: env.ASSETS_ORIGIN.replace(/\/+$/, ''),
      changeOrigin: true,
    };
  }

  return {
    logLevel: 'error',
    plugins: [react()],
    resolve: {
      alias: { '@': resolve(import.meta.dirname, './src') },
    },
    server: { proxy },
  };
});
