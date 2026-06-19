import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const proxy: Record<string, ProxyOptions> = {
    '/api': {
      target: 'http://127.0.0.1:8000',
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
