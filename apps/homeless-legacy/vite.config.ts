import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const pkg = (n: string) => path.resolve(__dirname, `../../packages/dark-${n}/src/index.ts`);

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@dark/core': pkg('core'), '@dark/geo': pkg('geo'), '@dark/visual-grammar': pkg('visual-grammar'),
      '@dark/somatostratum': pkg('somatostratum'), '@dark/subjects': pkg('subjects'), '@dark/travel': pkg('travel'),
    },
  },
  plugins: [
    react(),
  ],
  publicDir: '../homeless-web/public',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: false },
  server: { host: true },
});
