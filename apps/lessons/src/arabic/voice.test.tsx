import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { AUDIO_MESSAGE, clearEarlyAudioMessages, type AudioOrigins } from '../audio/audio-manifest';
import { sha256Bytes, sha256Hex } from '../quran/sha256';
import { standIn } from '../test/arabic-stand-in';
import { ArabicLesson } from './ArabicLesson';
import { VOICE_MESSAGE, acceptVoiceMessage, lessonKeyOf } from './voice';

/**
 * PD-48: the lesson checks the voice-over list itself, a second time after the
 * API. A string without a verified clip has no play button; nothing falls back
 * to another clip or to the browser's own voice.
 */
const ORIGINS: AudioOrigins = { self: 'https://lessons.example.test', parents: ['https://admin.example.test'], media: ['https://media.example.test'] };
const AUDIO = 'a'.repeat(64);
// Test strings only (the stand-in lesson's words), not lesson content.
const TEXTS = new Map([
  ['alif-001', 'كِتَابْ'],
  ['alif.name', 'أَلِفْ'],
]);

async function entry(id: string, text: string, over: Record<string, unknown> = {}) {
  const key = `lesson-audio/arabic-001/${id}/${AUDIO}.mp3`;
  return { id, audio: { key, url: `https://media.example.test/${key}?sig=x`, sha256: AUDIO, textSha256: await sha256Hex(text), ...over } };
}
async function message(clips?: unknown[]) {
  return { type: VOICE_MESSAGE, lesson: 'arabic-001', clips: clips ?? [await entry('alif-001', 'كِتَابْ'), await entry('alif.name', 'أَلِفْ')] };
}
const from = (data: unknown, origin = 'https://admin.example.test') => ({ origin, data });

describe('accepting the voice-over list', () => {
  beforeEach(() => clearEarlyAudioMessages());

  it('accepts exactly the clips whose text hash is this build\'s text', async () => {
    const m = await acceptVoiceMessage(from(await message()), 'arabic-001', TEXTS, ORIGINS);
    expect([...m!.keys()]).toEqual(['alif-001', 'alif.name']);
    expect(lessonKeyOf(1)).toBe('arabic-001');
  });

  it('drops a clip for other text (an API and a lesson out of step) or for a string this build does not show', async () => {
    const m = await acceptVoiceMessage(from(await message([await entry('alif-001', 'كِتَابٌ'), await entry('alif.name', 'أَلِفْ'), await entry('ba-001', 'بَابْ')])), 'arabic-001', TEXTS, ORIGINS);
    expect([...m!.keys()]).toEqual(['alif.name']);
    // A valid list with nothing left is EMPTY, not refused: it clears what an earlier list gave.
    expect((await acceptVoiceMessage(from(await message([await entry('alif-001', 'other')])), 'arabic-001', TEXTS, ORIGINS))?.size).toBe(0);
    expect((await acceptVoiceMessage(from(await message([])), 'arabic-001', TEXTS, ORIGINS))?.size).toBe(0);
  });

  it('refuses the WHOLE list for a bad origin, another lesson, an extra field, a foreign key or a media host not allowed', async () => {
    const refused = async (data: unknown, origin?: string) => expect(await acceptVoiceMessage(from(data, origin), 'arabic-001', TEXTS, ORIGINS)).toBeNull();
    await refused(await message(), 'https://evil.example.test');
    await refused({ ...(await message()), lesson: 'arabic-002' });
    await refused({ ...(await message()), token: 'x' });
    await refused(await message([{ ...(await entry('alif-001', 'كِتَابْ')), extra: 1 }]));
    await refused(await message([await entry('alif-001', 'كِتَابْ', { key: `lesson-audio/arabic-001/ba-001/${AUDIO}.mp3` })]));
    await refused(await message([await entry('alif-001', 'كِتَابْ', { key: 'quran/audio/x/001001.mp3' })]));
    await refused(await message([await entry('alif-001', 'كِتَابْ', { url: 'https://evil.example.test/x.mp3' })]));
    await refused(await message([await entry('alif-001', 'كِتَابْ', { url: 'http://media.example.test/x.mp3' })]));
    await refused(await message([await entry('alif-001', 'كِتَابْ'), await entry('alif-001', 'كِتَابْ')]));
    // A Quran recitation message is not a voice-over message.
    await refused({ type: AUDIO_MESSAGE, surah: 85, ayahs: [] });
  });
});

describe('the play button', () => {
  beforeEach(() => clearEarlyAudioMessages());

  it('is there only for a string with a verified clip; without a list there is none at all', async () => {
    render(<ArabicLesson lesson={1} content={standIn()} />);
    expect(screen.queryAllByRole('button', { name: 'اِسْتَمِعْ' })).toEqual([]);
    const data = await message();
    // The lesson's own origin (a WebView injecting the list) is allowed by the build's origins.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data }));
    });
    // The test build allows no media origin, so even this list is refused: still no button.
    expect(screen.queryAllByRole('button', { name: 'اِسْتَمِعْ' })).toEqual([]);
  });

});

describe('the voice hook: one clip at a time, only verified bytes', () => {
  beforeEach(() => clearEarlyAudioMessages());
  const BYTES = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]); // synthetic, never a voice
  function deps(bytes: Uint8Array, played: string[]) {
    return {
      fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer }) as Response,
      element: (url: string) => ({ currentTime: 0, onended: null as (() => void) | null, play: async () => void played.push(url), pause: () => {} }),
      objectUrl: () => 'blob:verified',
      revoke: () => {},
    };
  }
  async function listOf(bytes: Uint8Array<ArrayBuffer>) {
    const digest = await sha256Bytes(bytes);
    const e = async (id: string, text: string) => {
      const key = `lesson-audio/arabic-001/${id}/${digest}.mp3`;
      return { id, audio: { key, url: `https://media.example.test/${key}?sig=x`, sha256: digest, textSha256: await sha256Hex(text) } };
    };
    return { type: VOICE_MESSAGE, lesson: 'arabic-001', clips: [await e('alif-001', 'كِتَابْ'), await e('alif.name', 'أَلِفْ')] };
  }

  it('has a clip only for the listed strings, plays it from verified bytes, and drops one whose bytes do not match', async () => {
    const { useVoice } = await import('./voice');
    const played: string[] = [];
    const good = deps(BYTES, played);
    const { result } = renderHook(() => useVoice(1, TEXTS, ORIGINS, good));
    expect(result.current.has('alif-001')).toBe(false);
    const data = await listOf(BYTES);
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://admin.example.test', data }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(result.current.has('alif-001')).toBe(true));
    expect(result.current.has('alif-002')).toBe(false);
    await act(async () => {
      result.current.play('alif-001');
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(played).toEqual(['blob:verified']);
    expect(result.current.playing).toBe('alif-001');

    // The same list, but the file served is not the approved one: the button goes.
    const swapped = renderHook(() => useVoice(1, TEXTS, ORIGINS, deps(new Uint8Array([9, 9, 9]), [])));
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://admin.example.test', data }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(swapped.result.current.has('alif-001')).toBe(true));
    await act(async () => {
      swapped.result.current.play('alif-001');
      await new Promise((r) => setTimeout(r, 10));
    });
    await waitFor(() => expect(swapped.result.current.has('alif-001')).toBe(false));
    expect(swapped.result.current.has('alif.name')).toBe(true);

    // An empty list from the opener (the gate closed, the clip was withdrawn) clears the buttons.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://admin.example.test', data: { type: VOICE_MESSAGE, lesson: 'arabic-001', clips: [] } }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(swapped.result.current.has('alif.name')).toBe(false));
  });
});
