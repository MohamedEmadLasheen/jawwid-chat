import { defineConfig } from 'vitest/config';

// Tests need only esbuild's automatic JSX; the React plugin belongs to vite.config.ts
// (vitest 2 carries its own vite 5, whose plugin types differ from the app's vite 6).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
