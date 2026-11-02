import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { releaseContent, ReleaseRefused, type Release } from './src/content/release';
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

// WHAT FAMILIES DOWNLOAD (PD-29, owner 2026-10-30/31). Every JSON import is
// inlined into the public bundle, so each one passes through releaseContent()
// (src/content/release.ts) before Vite's own JSON plugin sees it: an approved
// lesson ships byte for byte, a pending one only as {"withheld":true}, and a
// JSON file that is not on the allowlist, or an approved file that still holds
// an item, fails the build. `vite build --mode preview` (the reviewer preview
// build, PR #330) ships every file as written. The build records what it
// shipped in release-manifest.json, next to dist/ and never inside it.
//
// Leave unsigned PD-49 mechanics out of the bundle. OFF: the owner has not
// decided (a mechanic plays only once signed either way, mechanics.ts).
const DROP_UNSIGNED_MECHANICS = false;

function lessonsRelease(preview: boolean): Plugin {
  let root = '';
  let building = false;
  const shipped = new Map<string, Omit<Release, 'code'>>();
  const manifest = () => ({
    v: 1,
    mode: preview ? 'preview' : 'family',
    dropUnsignedMechanics: DROP_UNSIGNED_MECHANICS,
    files: [...shipped.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
  });
  return {
    name: 'lessons-release',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
      building = config.command === 'build';
    },
    async transform(code, id) {
      if (id.startsWith('\0')) return null;
      const q = id.indexOf('?');
      const file = q < 0 ? id : id.slice(0, q);
      const query = q < 0 ? '' : id.slice(q + 1);
      if (!file.endsWith('.json') || file.split(sep).includes('node_modules') || file.includes('/node_modules/')) return null;
      const path = relative(root, file).split(sep).join('/');
      // ?raw, ?url and the like would carry the file past this check (and past Vite's JSON plugin).
      if (query && query !== 'import') this.error(`${path}?${query}: a JSON import with a query is refused (it would skip the release check)`);
      try {
        const playApprovals = DROP_UNSIGNED_MECHANICS && path === 'src/play/mechanics.json' ? JSON.parse(readFileSync(join(root, 'src', 'content', 'approvals', 'play.json'), 'utf-8')) : undefined;
        const { code: out, ...release } = await releaseContent(path, code, { preview, dropUnsignedMechanics: DROP_UNSIGNED_MECHANICS, playApprovals });
        shipped.set(path, release);
        return out === code ? null : { code: out, map: null };
      } catch (e) {
        if (e instanceof ReleaseRefused) this.error(e.message);
        throw e;
      }
    },
    writeBundle() {
      if (building) writeFileSync(join(root, 'release-manifest.json'), JSON.stringify(manifest(), null, 2) + '\n');
    },
    api: { manifest },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'LESSONS_');
  const audio = {
    parents: origins(env.LESSONS_PARENT_ORIGINS, 'LESSONS_PARENT_ORIGINS'),
    media: origins(env.LESSONS_MEDIA_ORIGINS, 'LESSONS_MEDIA_ORIGINS'),
  };
  return {
  plugins: [lessonsRelease(mode === 'preview'), react(), audioCsp(audio.media)],
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
