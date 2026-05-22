import path from 'path'
import { fileURLToPath } from 'url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const proxy = {
    '/api': {
      target: 'http://127.0.0.1:8000',
      changeOrigin: true,
    },
  }

  if (env.BACKEND_BUCKET_NAME) {
    proxy['/assets'] = {
      target: `https://${env.BACKEND_BUCKET_NAME}.s3.us-east-1.amazonaws.com`,
      changeOrigin: true,
    }
  }

  return {
    logLevel: 'error',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: { proxy },
  }
})
