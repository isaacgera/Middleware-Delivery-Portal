import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server for the MDP SPA. Proxies /api to the Fastify backend so the browser
// talks to one origin in dev (keeps the session cookie simple).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
