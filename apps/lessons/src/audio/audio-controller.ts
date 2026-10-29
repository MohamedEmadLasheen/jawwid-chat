/**
 * The one player of a lesson (PD-29 materials quality, §B1). The old lessons
 * played the wrong verse because each component kept its own audio object:
 * "repeat" replayed a stale one, a delayed replay fired after the selection
 * moved, two players overlapped, and audio kept playing after the lesson
 * closed. Here there is exactly one, and:
 *   - play(key) always stops whatever is playing and starts THAT key's file;
 *   - repeat() replays the CURRENT key, never an old object;
 *   - select(key) (moving to another ayah) stops the audio and cancels any
 *     pending repeat;
 *   - dispose() (the lesson closing) stops everything for good.
 * One file per ayah: no timing tables; playThrough() recites verse by verse.
 * Audio reaches a lesson only through the API's release gate (audio-manifest.ts);
 * without it the source is NO_AUDIO and availableFor() is false.
 */
export interface Playable {
  play(): Promise<void>;
  pause(): void;
  currentTime: number;
  onended: (() => void) | null;
}

export type AudioSource = (surah: number, ayah: number) => string | null;
export type AudioFactory = (url: string) => Playable;

/** No recitation is configured yet. */
export const NO_AUDIO: AudioSource = () => null;

/** The browser's audio element, behind the small Playable surface. */
export const htmlAudio: AudioFactory = (url) => {
  const el = new Audio(url);
  el.preload = 'auto';
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
};

export class AudioController {
  private current: { key: string; audio: Playable } | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private listeners = new Set<(key: string | null) => void>();

  constructor(
    private readonly source: AudioSource,
    private readonly create: AudioFactory = htmlAudio,
  ) {}

  /** Whether this surah has audio (its first ayah has a source). */
  availableFor(surah: number): boolean {
    return this.source(surah, 1) !== null;
  }

  /** Whether this one ayah has a source (a manifest may cover only part of a surah). */
  has(surah: number, ayah: number): boolean {
    return this.source(surah, ayah) !== null;
  }

  get playing(): string | null {
    return this.current?.key ?? null;
  }

  onChange(listener: (key: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stop what is playing and play this ayah's own file. Returns false when there is no audio. */
  play(surah: number, ayah: number): boolean {
    this.stop();
    if (this.disposed) return false;
    const url = this.source(surah, ayah);
    if (!url) return false;
    const key = `${surah}:${ayah}`;
    const audio = this.create(url);
    this.current = { key, audio };
    audio.onended = () => {
      if (this.current?.audio === audio) this.setCurrent(null);
    };
    void audio.play().catch(() => this.current?.audio === audio && this.setCurrent(null));
    this.emit();
    return true;
  }

  /**
   * Recite from `from` to `to`, verse by verse: each ayah's own file, the next
   * starting when one ends. Any select/stop/play ends the run.
   */
  playThrough(surah: number, from: number, to: number): boolean {
    if (!this.play(surah, from)) return false;
    const audio = this.current!.audio;
    audio.onended = () => {
      if (this.current?.audio !== audio) return;
      if (from < to) this.playThrough(surah, from + 1, to);
      else this.setCurrent(null);
    };
    return true;
  }

  /** Replay the CURRENT ayah after `delayMs`; cancelled by any select/stop/play. */
  repeat(surah: number, ayah: number, delayMs = 0): void {
    this.cancelPending();
    this.pending = setTimeout(() => {
      this.pending = null;
      this.play(surah, ayah);
    }, delayMs);
  }

  /** The child moved to another ayah: nothing of the previous one may keep playing. */
  select(): void {
    this.stop();
  }

  stop(): void {
    this.cancelPending();
    if (this.current) {
      this.current.audio.onended = null;
      this.current.audio.pause();
      this.setCurrent(null);
    }
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.listeners.clear();
  }

  private cancelPending() {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = null;
  }

  private setCurrent(value: { key: string; audio: Playable } | null) {
    this.current = value;
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l(this.playing);
  }
}
