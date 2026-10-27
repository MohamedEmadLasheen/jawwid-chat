import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioController, NO_AUDIO, type Playable } from './audio-controller';

class FakeAudio implements Playable {
  static made: FakeAudio[] = [];
  playing = false;
  currentTime = 0;
  onended: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeAudio.made.push(this);
  }
  async play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
}

const source = (s: number, a: number) => `/audio/${s}/${a}.mp3`;
const make = () => new AudioController(source, (url) => new FakeAudio(url));
const audible = () => FakeAudio.made.filter((a) => a.playing).map((a) => a.url);

beforeEach(() => {
  FakeAudio.made = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('one audio controller: the right ayah, and only one', () => {
  it('plays the ayah asked for, and stops the previous one first', () => {
    const c = make();
    c.play(91, 5);
    c.play(91, 6);
    expect(audible()).toEqual(['/audio/91/6.mp3']);
    expect(c.playing).toBe('91:6');
  });

  it('"repeat" replays the CURRENT ayah, never a stale object (the old "previous verse" bug)', () => {
    const c = make();
    c.play(102, 3);
    c.select(); // the child moves on to ayah 4
    c.repeat(102, 4);
    vi.runAllTimers();
    expect(audible()).toEqual(['/audio/102/4.mp3']);
  });

  it('a pending repeat is cancelled when the selection moves (the old delayed replays)', () => {
    const c = make();
    c.repeat(108, 1, 1000);
    c.select();
    vi.runAllTimers();
    expect(audible()).toEqual([]);
  });

  it('nothing keeps playing after the lesson closes, and nothing starts after', () => {
    const c = make();
    c.play(85, 1);
    c.repeat(85, 2, 500);
    c.dispose();
    vi.runAllTimers();
    expect(audible()).toEqual([]);
    expect(c.play(85, 3)).toBe(false);
  });

  it('a finished ayah clears the playing marker; an old ayah\'s end never clears a new one', () => {
    const c = make();
    c.play(1, 1);
    const first = FakeAudio.made[0]!;
    c.play(1, 2);
    first.onended?.();
    expect(c.playing).toBe('1:2');
    FakeAudio.made[1]!.onended?.();
    expect(c.playing).toBeNull();
  });

  it('with no recitation configured there is no audio at all', () => {
    const c = new AudioController(NO_AUDIO, (url) => new FakeAudio(url));
    expect(c.available).toBe(false);
    expect(c.play(1, 1)).toBe(false);
    expect(FakeAudio.made).toEqual([]);
  });
});
