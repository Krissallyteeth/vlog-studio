import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.js so tests don't load the PWA / Tailwind plugins.
export default defineConfig({
  define: { __APP_VERSION__: '"test"' },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    setupFiles: ['tests/setup.js'],
  },
});
