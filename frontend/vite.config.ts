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

  if (env.ASSETS_BUCKET_NAME) {
    proxy['/app-assets'] = {
      target: `https://${env.ASSETS_BUCKET_NAME}.s3.us-east-1.amazonaws.com`,
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
