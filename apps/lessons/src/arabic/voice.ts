import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILD_AUDIO_ORIGINS, READY_MESSAGE, drainEarlyAudioMessages, verifiedAudioFor, type AudioOrigins, type VerifiedAudioDeps } from '../audio/audio-manifest';
import type { Playable } from '../audio/audio-controller';
import { sha256Hex } from '../quran/sha256';

/**
 * PD-48: voice-over for an Arabic letters lesson (docs/product/pd048-lesson-voice-over-design.md §7.5).
 *
 * The engine never talks to the API. The app that opened the lesson, signed
 * in, asks GET /lesson-audio/arabic-NNN -- where the server serves only clips
 * TWO teachers approved for exactly this text, of a voice listed in code,
 * through its release gate -- and posts the answer as DATA:
 *
 *   postMessage({ type: 'jawwid:lesson-audio', lesson: 'arabic-001', clips: [{ id, audio: { key, url, sha256, textSha256 } }] })
 *
 * The engine checks it a second time, on its own:
 *   - only from an allowed origin, exactly these fields, else the whole list is refused;
 *   - each key is exactly `lesson-audio/<lesson>/<id>/<sha256>.mp3`, each URL on an allowed media origin;
 *   - each clip's textSha256 must be the SHA-256 of THIS build's text for that id: a clip for other text
 *     (an API and a lesson build out of step) is dropped;
 *   - a file plays only once its bytes hash to its sha256 (verifiedAudioFor); if they do not, its button goes.
 * A string without a clip has NO play button: never a placeholder, never the browser's own voice.
 * This is a different message, key prefix and check from Quran recitation (jawwid:quran-audio).
 */
export const VOICE_MESSAGE = 'jawwid:lesson-audio';

export interface VoiceClip {
  key: string;
  url: string;
  sha256: string;
}

const ID = /^[a-z][a-z0-9_]*(-[0-9]{3}|\.(name|note))$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_CLIPS = 3000;
const MAX_URL = 2048;
const only = (o: object, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));

export function lessonKeyOf(lesson: number): string {
  return `arabic-${String(lesson).padStart(3, '0')}`;
}

export async function acceptVoiceMessage(
  event: { origin: string; data: unknown },
  lessonKey: string,
  texts: ReadonlyMap<string, string>,
  origins: AudioOrigins,
): Promise<Map<string, VoiceClip> | null> {
  if (event.origin !== origins.self && !origins.parents.includes(event.origin)) return null;
  const data = event.data as { type?: unknown; lesson?: unknown; clips?: unknown };
  if (!data || typeof data !== 'object' || !only(data, ['type', 'lesson', 'clips'])) return null;
  if (data.type !== VOICE_MESSAGE || data.lesson !== lessonKey || !Array.isArray(data.clips) || data.clips.length > MAX_CLIPS) return null;
  const checked: Array<{ id: string; clip: VoiceClip; textSha256: string }> = [];
  const ids = new Set<string>();
  for (const entry of data.clips as Array<{ id?: unknown; audio?: unknown }>) {
    if (!entry || typeof entry !== 'object' || !only(entry, ['id', 'audio'])) return null;
    const id = entry.id;
    if (typeof id !== 'string' || !ID.test(id) || ids.has(id)) return null;
    ids.add(id);
    const a = entry.audio as { key?: unknown; url?: unknown; sha256?: unknown; textSha256?: unknown } | null;
    if (!a || typeof a !== 'object' || !only(a, ['key', 'url', 'sha256', 'textSha256'])) return null;
    if (typeof a.sha256 !== 'string' || !HEX64.test(a.sha256) || typeof a.textSha256 !== 'string' || !HEX64.test(a.textSha256)) return null;
    // Exactly this string's own key: never another string's file, never a Quran file.
    if (a.key !== `lesson-audio/${lessonKey}/${id}/${a.sha256}.mp3`) return null;
    if (typeof a.url !== 'string' || a.url.length > MAX_URL) return null;
    let url: URL;
    try {
      url = new URL(a.url);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !origins.media.includes(url.origin)) return null;
    checked.push({ id, clip: { key: a.key, url: url.href, sha256: a.sha256 }, textSha256: a.textSha256 });
  }
  const clips = new Map<string, VoiceClip>();
  for (const c of checked) {
    const text = texts.get(c.id);
    // Not a string this build shows, or a clip for other text: dropped, that string stays silent.
    if (text === undefined || (await sha256Hex(text)) !== c.textSha256) continue;
    clips.set(c.id, c.clip);
  }
  return clips.size ? clips : null;
}

export interface Voice {
  /** Whether this string has a verified clip (only then is there a play button). */
  has(id: string): boolean;
  play(id: string): void;
  playing: string | null;
}

/**
 * The lesson's voice-over, once the opener has sent a list this account may
 * have. One clip plays at a time; a clip whose bytes do not match is removed.
 */
export function useVoice(lesson: number, texts: ReadonlyMap<string, string>, origins: AudioOrigins = BUILD_AUDIO_ORIGINS, deps?: VerifiedAudioDeps): Voice {
  const lessonKey = lessonKeyOf(lesson);
  const [clips, setClips] = useState<Map<string, VoiceClip> | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const current = useRef<Playable | null>(null);
  useEffect(() => {
    let live = true;
    const consider = (e: { origin: string; data: unknown }) => {
      void acceptVoiceMessage(e, lessonKey, texts, origins).then((m) => {
        if (live && m) setClips(m);
      });
    };
    const onMessage = (e: MessageEvent) => consider({ origin: e.origin, data: e.data });
    for (const e of drainEarlyAudioMessages()) consider(e);
    window.addEventListener('message', onMessage);
    if (window.parent !== window) for (const p of origins.parents) window.parent.postMessage({ type: READY_MESSAGE, lesson: lessonKey }, p);
    return () => {
      live = false;
      window.removeEventListener('message', onMessage);
      current.current?.pause();
      current.current = null;
    };
  }, [lessonKey, texts, origins]);
  const factory = useMemo(() => (clips ? verifiedAudioFor(new Map([...clips.values()].map((c) => [c.url, c.sha256])), deps) : null), [clips, deps]);
  return {
    has: (id) => !!clips?.has(id),
    playing,
    play(id) {
      const clip = clips?.get(id);
      if (!clip || !factory) return;
      current.current?.pause();
      const audio = factory(clip.url);
      current.current = audio;
      setPlaying(id);
      audio.onended = () => setPlaying((p) => (p === id ? null : p));
      audio.play().catch(() => {
        // The bytes did not match (or the file did not load): this string has no audio any more.
        setPlaying((p) => (p === id ? null : p));
        setClips((m) => {
          if (!m?.has(id)) return m;
          const next = new Map(m);
          next.delete(id);
          return next.size ? next : null;
        });
      });
    },
  };
}
