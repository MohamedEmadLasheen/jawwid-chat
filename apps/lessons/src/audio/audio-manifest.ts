import { useEffect, useState } from 'react';
import { sha256Bytes } from '../quran/sha256';
import type { AudioFactory, AudioSource, Playable } from './audio-controller';

/**
 * How recitation reaches a lesson (PD-29 materials quality, audio).
 *
 * The engine never talks to the API and holds no token. The app that opened
 * the lesson -- signed in -- reads GET /quran/ayahs, where the API's release
 * gate decides whether THIS account gets audio at all (apps/api/src/quran/
 * audio-gate.ts), and passes the answer's `ayahs` entries to the lesson:
 *
 *   postMessage({ type: 'jawwid:quran-audio', surah, ayahs: [{ ayah, audio }] })
 *
 * from a parent page, or injected by the mobile app's WebView into the lesson
 * itself. The engine accepts it only from an allowed origin, refuses the WHOLE
 * list if any entry is not exactly that ayah's own key on an allowed media
 * origin, and then plays a file only after its bytes hash to the listed
 * SHA-256 (verifiedAudio). The allowed origins are fixed when CI builds the
 * lesson (vite.config.ts, LESSONS_PARENT_ORIGINS / LESSONS_MEDIA_ORIGINS);
 * a build without them accepts no audio.
 */
export const AUDIO_MESSAGE = 'jawwid:quran-audio';
/** Sent to the opener when a lesson is ready for its audio list. */
export const READY_MESSAGE = 'jawwid:lesson-ready';

export interface AudioOrigins {
  /** The lesson's own origin (a WebView injecting the list). */
  self: string;
  /** Pages allowed to open the lesson and hand it audio. */
  parents: readonly string[];
  /** Where audio files may be fetched from. */
  media: readonly string[];
}

export interface AudioManifest {
  surah: number;
  reciter: string;
  ayahs: Map<number, { key: string; url: string; sha256: string }>;
}

declare const __LESSONS_AUDIO__: { parents: string[]; media: string[] };

export const BUILD_AUDIO_ORIGINS: AudioOrigins = {
  self: typeof window === 'undefined' ? '' : window.location.origin,
  parents: __LESSONS_AUDIO__.parents,
  media: __LESSONS_AUDIO__.media,
};

const RECITER = /^[a-z0-9][a-z0-9-]{1,39}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const pad = (n: number) => String(n).padStart(3, '0');

export function acceptAudioMessage(event: { origin: string; data: unknown }, surah: number, origins: AudioOrigins): AudioManifest | null {
  if (event.origin !== origins.self && !origins.parents.includes(event.origin)) return null;
  const data = event.data as { type?: unknown; surah?: unknown; ayahs?: unknown };
  if (!data || data.type !== AUDIO_MESSAGE || data.surah !== surah || !Array.isArray(data.ayahs)) return null;
  const ayahs: AudioManifest['ayahs'] = new Map();
  let reciter: string | null = null;
  for (const entry of data.ayahs as Array<{ ayah?: unknown; audio?: unknown }>) {
    const ayah = entry?.ayah;
    if (typeof ayah !== 'number' || !Number.isInteger(ayah) || ayah < 1 || ayah > 286 || ayahs.has(ayah)) return null;
    const a = entry.audio as { reciter?: unknown; key?: unknown; url?: unknown; sha256?: unknown } | null | undefined;
    if (a === null || a === undefined) continue;
    if (typeof a.reciter !== 'string' || !RECITER.test(a.reciter) || (reciter !== null && a.reciter !== reciter)) return null;
    reciter = a.reciter;
    // Exactly this ayah's own key: never another verse's file.
    if (a.key !== `quran/audio/${reciter}/${pad(surah)}${pad(ayah)}.mp3`) return null;
    if (typeof a.sha256 !== 'string' || !HEX64.test(a.sha256)) return null;
    let url: URL;
    try {
      url = new URL(String(a.url));
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !origins.media.includes(url.origin)) return null;
    ayahs.set(ayah, { key: a.key, url: url.href, sha256: a.sha256 });
  }
  if (reciter === null || ayahs.size === 0) return null;
  return { surah, reciter, ayahs };
}

export function manifestSource(m: AudioManifest): AudioSource {
  return (surah, ayah) => (surah === m.surah ? m.ayahs.get(ayah)?.url ?? null : null);
}

export interface VerifiedAudioDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  element: (url: string) => Playable;
  objectUrl: (blob: Blob) => string;
  revoke: (url: string) => void;
}

const browserDeps = (): VerifiedAudioDeps => ({
  fetch: (url, init) => fetch(url, init),
  element: (url) => {
    const el = new Audio(url);
    let ended: (() => void) | null = null;
    return {
      play: () => el.play(),
      pause: () => el.pause(),
      get currentTime() {
        return el.currentTime;
      },
      set currentTime(t: number) {
        el.currentTime = t;
      },
      get onended() {
        return ended;
      },
      set onended(fn: (() => void) | null) {
        ended = fn;
        el.onended = fn ? () => fn() : null;
      },
    };
  },
  objectUrl: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
});

/**
 * An AudioFactory that plays a file only once its bytes hash to the manifest's
 * SHA-256 -- from memory (a blob: URL), so what plays is exactly what was checked.
 */
export function verifiedAudio(m: AudioManifest, deps: VerifiedAudioDeps = browserDeps()): AudioFactory {
  const expected = new Map([...m.ayahs.values()].map((a) => [a.url, a.sha256]));
  return (url) => {
    let el: Playable | null = null;
    let blobUrl: string | null = null;
    let stopped = false;
    let ended: (() => void) | null = null;
    const release = () => {
      if (blobUrl) deps.revoke(blobUrl);
      blobUrl = null;
    };
    return {
      async play() {
        const sha256 = expected.get(url);
        if (!sha256) throw new Error(`${url} is not in the audio list`);
        const res = await deps.fetch(url, { credentials: 'omit', cache: 'no-store' });
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        const bytes = await res.arrayBuffer();
        if ((await sha256Bytes(bytes)) !== sha256) throw new Error(`${url} does not match its SHA-256`);
        if (stopped) return;
        blobUrl = deps.objectUrl(new Blob([bytes], { type: 'audio/mpeg' }));
        el = deps.element(blobUrl);
        el.onended = () => {
          release();
          ended?.();
        };
        await el.play();
      },
      pause() {
        stopped = true;
        el?.pause();
        release();
      },
      get currentTime() {
        return el?.currentTime ?? 0;
      },
      set currentTime(t: number) {
        if (el) el.currentTime = t;
      },
      get onended() {
        return ended;
      },
      set onended(fn: (() => void) | null) {
        ended = fn;
      },
    };
  };
}

/**
 * The lesson's audio list, if the opener has sent one this account may have.
 * Says "ready" to the allowed parents, so the opener knows when to send it.
 */
export function useAudioManifest(surah: number, origins: AudioOrigins = BUILD_AUDIO_ORIGINS): AudioManifest | null {
  const [manifest, setManifest] = useState<AudioManifest | null>(null);
  useEffect(() => {
    setManifest(null);
    const onMessage = (e: MessageEvent) => {
      const m = acceptAudioMessage({ origin: e.origin, data: e.data }, surah, origins);
      if (m) setManifest(m);
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) for (const p of origins.parents) window.parent.postMessage({ type: READY_MESSAGE, surah }, p);
    return () => window.removeEventListener('message', onMessage);
  }, [surah, origins]);
  return manifest;
}
