import { defineConfig } from 'vitest/config';
import path from 'node:path';

const pkg = (n: string) => path.resolve(__dirname, `packages/dark-${n}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@dark/core': pkg('core'), '@dark/geo': pkg('geo'), '@dark/visual-grammar': pkg('visual-grammar'),
      '@dark/somatostratum': pkg('somatostratum'), '@dark/subjects': pkg('subjects'), '@dark/travel': pkg('travel'),
    },
  },
  test: { include: ['packages/*/test/**/*.test.ts', 'apps/homeless-web/test/**/*.test.ts'], environment: 'node' },
});
