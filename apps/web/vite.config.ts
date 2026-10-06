import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In der Entwicklung läuft die API auf :3000; Vite leitet /api dorthin weiter.
// WebSockets verbinden sich lokal direkt mit :3000 (siehe src/lib/live.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
