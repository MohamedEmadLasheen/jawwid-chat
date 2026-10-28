import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pin from './quran-pin.json';
import snapshot from './public/data/quran/manifest.json';

// The lessons engine (PD-29 materials quality P0-3). Production builds come only
// from CI. Nothing is inlined into index.html, so the page runs under a CSP with
// script-src 'self' (deploy/headers.md); the dev server may read only this folder.
//
// THE TRUST ANCHOR. CI builds the snapshot from the verified dataset first
// (scripts/lessons/build-quran-snapshot.py), and this build writes that
// snapshot's fingerprints -- the file's SHA-256 and every surah's rangeSha256 --
// into the bundle itself. The engine then refuses any served snapshot that is
// not the one this build saw, so whoever can change files on the host cannot
// change the text: the CI build is what the browser trusts, not the server.
// Without a snapshot there is no build (this import fails).
if (snapshot.datasetId !== pin.datasetId || snapshot.fileSha256 !== pin.fileSha256 || snapshot.surahs.length !== 114) {
  throw new Error(`the snapshot is ${snapshot.datasetId} (${snapshot.fileSha256}), not the pinned ${pin.datasetId}`);
}
const anchor = {
  datasetId: snapshot.datasetId,
  fileSha256: snapshot.fileSha256,
  rangeSha256: snapshot.surahs.map((s) => s.rangeSha256),
};

export default defineConfig({
  plugins: [react()],
  base: '/',
  define: { __QURAN_ANCHOR__: JSON.stringify(anchor) },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  server: { fs: { strict: true, allow: ['.'] } },
});
