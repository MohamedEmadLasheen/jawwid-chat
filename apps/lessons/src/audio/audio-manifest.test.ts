import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { AUDIO_MESSAGE, acceptAudioMessage, manifestSource, useAudioManifest, verifiedAudio, type AudioOrigins } from './audio-manifest';
import { sha256Bytes } from '../quran/sha256';

const ORIGINS: AudioOrigins = { self: 'https://lessons.example.test', parents: ['https://admin.example.test'], media: ['https://media.example.test'] };
const RECITER = 'kfgqpc-hudhaify';
const key = (s: number, a: number) => `quran/audio/${RECITER}/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`;
const BYTES = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]); // synthetic, never a recitation
let SHA = '';

async function message(change?: (d: { type: string; surah: number; ayahs: Array<{ ayah: number; audio: unknown }> }) => void) {
  SHA = await sha256Bytes(BYTES);
  const data = {
    type: AUDIO_MESSAGE,
    surah: 85,
    // The API's /quran/ayahs entries, as the opener received them.
    ayahs: [1, 2, 3].map((a) => ({ ayah: a, audio: { reciter: RECITER, key: key(85, a), url: `https://media.example.test/${encodeURIComponent(key(85, a))}?sig=x`, sha256: SHA } })),
  };
  change?.(data);
  return data;
}

describe('accepting the audio list from the opener', () => {
  it('accepts it from an allowed parent, or from the lesson itself (a WebView injecting it)', async () => {
    const m = acceptAudioMessage({ origin: 'https://admin.example.test', data: await message() }, 85, ORIGINS)!;
    expect(m.reciter).toBe(RECITER);
    expect([...m.ayahs.keys()]).toEqual([1, 2, 3]);
    expect(manifestSource(m)(85, 2)).toBe(`https://media.example.test/${encodeURIComponent(key(85, 2))}?sig=x`);
    expect(manifestSource(m)(86, 2)).toBeNull();
    expect(acceptAudioMessage({ origin: ORIGINS.self, data: await message() }, 85, ORIGINS)).not.toBeNull();
  });

  it('skips ayat without audio, but refuses the WHOLE list on any bad entry', async () => {
    expect([...acceptAudioMessage({ origin: ORIGINS.self, data: await message((d) => { d.ayahs[1]!.audio = null; }) }, 85, ORIGINS)!.ayahs.keys()]).toEqual([1, 3]);
    const refused = async (change: Parameters<typeof message>[0], origin = 'https://admin.example.test') =>
      acceptAudioMessage({ origin, data: await message(change) }, 85, ORIGINS);
    expect(await refused(undefined, 'https://evil.example.test')).toBeNull();
    expect(await refused((d) => { d.type = 'other'; })).toBeNull();
    expect(await refused((d) => { d.surah = 86; })).toBeNull();
    // A key that names another ayah (the old lessons' wrong-verse bug) refuses the list.
    expect(await refused((d) => { (d.ayahs[0]!.audio as { key: string }).key = key(80, 7); })).toBeNull();
    expect(await refused((d) => { (d.ayahs[0]!.audio as { url: string }).url = 'https://cdn.elsewhere.test/x.mp3'; })).toBeNull();
    expect(await refused((d) => { (d.ayahs[0]!.audio as { url: string }).url = 'http://media.example.test/x.mp3'; })).toBeNull();
    expect(await refused((d) => { (d.ayahs[0]!.audio as { sha256: string }).sha256 = 'nope'; })).toBeNull();
    expect(await refused((d) => { (d.ayahs[1]!.audio as { reciter: string }).reciter = 'someone-else'; })).toBeNull();
    expect(await refused((d) => { d.ayahs.push({ ayah: 1, audio: d.ayahs[0]!.audio }); })).toBeNull();
    // With no allowed media origin (a build without audio), nothing is ever accepted.
    expect(acceptAudioMessage({ origin: ORIGINS.self, data: await message() }, 85, { ...ORIGINS, media: [] })).toBeNull();
  });

  it('the hook keeps the last accepted list for this surah, and drops it when the surah changes', async () => {
    const data = await message();
    const { result, rerender } = renderHook(({ surah }) => useAudioManifest(surah, ORIGINS), { initialProps: { surah: 85 } });
    expect(result.current).toBeNull();
    act(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example.test', data })); });
    expect(result.current).toBeNull();
    act(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://admin.example.test', data })); });
    expect(result.current?.surah).toBe(85);
    rerender({ surah: 86 });
    expect(result.current).toBeNull();
  });
});

describe('playing only verified bytes', () => {
  function harness(bytes: Uint8Array) {
    const played: string[] = [];
    const revoked: string[] = [];
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer }) as Response);
    const element = (url: string) => ({
      currentTime: 0,
      onended: null as (() => void) | null,
      play: async () => { played.push(url); },
      pause: () => {},
    });
    return { played, revoked, fetcher, deps: { fetch: fetcher, element, objectUrl: () => 'blob:verified', revoke: (u: string) => revoked.push(u) } };
  }

  it('fetches the file, checks its SHA-256 against the list, and plays it from memory', async () => {
    const m = acceptAudioMessage({ origin: ORIGINS.self, data: await message() }, 85, ORIGINS)!;
    const h = harness(BYTES);
    const audio = verifiedAudio(m, h.deps)(manifestSource(m)(85, 1)!);
    await audio.play();
    expect(h.fetcher).toHaveBeenCalledWith(manifestSource(m)(85, 1), { credentials: 'omit', cache: 'no-store' });
    expect(h.played).toEqual(['blob:verified']);
    audio.pause();
    expect(h.revoked).toEqual(['blob:verified']);
  });

  it('never plays bytes that do not match: a swapped file is refused', async () => {
    const m = acceptAudioMessage({ origin: ORIGINS.self, data: await message() }, 85, ORIGINS)!;
    const h = harness(new Uint8Array([9, 9, 9]));
    await expect(verifiedAudio(m, h.deps)(manifestSource(m)(85, 1)!).play()).rejects.toThrow(/does not match/);
    expect(h.played).toEqual([]);
  });

  it('a pause before the bytes arrive means it never starts', async () => {
    const m = acceptAudioMessage({ origin: ORIGINS.self, data: await message() }, 85, ORIGINS)!;
    const h = harness(BYTES);
    const audio = verifiedAudio(m, h.deps)(manifestSource(m)(85, 1)!);
    const started = audio.play();
    audio.pause();
    await started.catch(() => {});
    expect(h.played).toEqual([]);
  });
});
