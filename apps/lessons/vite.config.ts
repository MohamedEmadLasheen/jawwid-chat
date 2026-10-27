import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The lessons engine (PD-29 materials quality P0-3). Production builds come only
// from CI. Nothing is inlined into index.html, so the page runs under a CSP with
// script-src 'self' (deploy/headers.md); the dev server may read only this folder.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  server: { fs: { strict: true, allow: ['.'] } },
});
