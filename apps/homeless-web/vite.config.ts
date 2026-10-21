import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
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
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: {
        name: 'HOMELESS', short_name: 'HOMELESS', description: 'HOMELESS on the DARK engine', theme_color: '#0b0d12', background_color: '#0b0d12',
        display: 'fullscreen', orientation: 'any', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        // Opening scene and runtime are precached; terrain tiles stream with a bounded runtime cache.
        globPatterns: ['**/*.{js,css,html,svg,wasm}', 'assets/**/*.{glb,jpg,wav,json}', 'data/*.{json,png}', 'data/terrain/index.json'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: /\/data\/terrain\/.*\.i16$/,
          handler: 'CacheFirst',
          options: { cacheName: 'dark-terrain-v1', expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 } },
        }],
      },
    }),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: false },
  server: { host: true },
});
