import { defineConfig, devices } from '@playwright/test';

// PD-49 P0: the verses are drawn in Amiri Quran, checked in headless Chromium against the
// production build (`npm run build` first; CI runs it in the lessons job). No pixel goldens:
// the test asserts the font itself, and keeps screenshots as artifacts for a person to look at.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  outputDir: 'test-results',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 390, height: 844 }, locale: 'ar' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: { command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173/lessons/quran/surah-1', reuseExistingServer: false, timeout: 60_000 },
});
