import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    allowedHosts: true,

    proxy: {
      '/api-analysis': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/api-analysis/, ''),
      },

      '/api-mix': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/api-mix/, ''),
      },

      '/rooms-api': {
        target: 'http://127.0.0.1:8003',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/rooms-api/, ''),
      },

      '/account-api': {
        target: 'http://127.0.0.1:8004',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/account-api/, ''),
      },
    },
  },
})
