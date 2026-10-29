import { defineConfig, loadEnv, type Plugin } from 'vite';
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

// AUDIO ORIGINS. Recitation reaches a lesson only from the app that opened it
// (src/audio/audio-manifest.ts), so the build fixes which pages may hand it an
// audio list (LESSONS_PARENT_ORIGINS) and where the files may come from
// (LESSONS_MEDIA_ORIGINS, also added to the CSP's connect-src). Comma-separated
// https origins; unset means a build that accepts no audio at all.
function origins(value: string | undefined, name: string): string[] {
  const list = (value ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  for (const o of list) {
    if (!/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(o)) throw new Error(`${name}: ${JSON.stringify(o)} is not an https origin`);
  }
  return list;
}

function audioCsp(media: string[]): Plugin {
  return {
    name: 'lessons-audio-csp',
    transformIndexHtml(html) {
      // Verified audio plays from memory (blob:); its bytes are fetched from the media origins.
      const out = html
        .replace("media-src 'self';", "media-src 'self' blob:;")
        .replace("connect-src 'self';", `connect-src 'self'${media.map((o) => ` ${o}`).join('')};`);
      if (!out.includes("media-src 'self' blob:;")) throw new Error('index.html: the CSP has no media-src to extend');
      return out;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'LESSONS_');
  const audio = {
    parents: origins(env.LESSONS_PARENT_ORIGINS, 'LESSONS_PARENT_ORIGINS'),
    media: origins(env.LESSONS_MEDIA_ORIGINS, 'LESSONS_MEDIA_ORIGINS'),
  };
  return {
  plugins: [react(), audioCsp(audio.media)],
  base: '/',
  define: { __QURAN_ANCHOR__: JSON.stringify(anchor), __LESSONS_AUDIO__: JSON.stringify(audio) },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  server: { fs: { strict: true, allow: ['.'] } },
  };
});
