import { useEffect, useRef, useState } from 'react';
import type { AudioController } from '../../audio/audio-controller';
import type { Band } from '../../content/quran-content';
import type { Ayah } from '../../quran/dataset';

/**
 * What every PD-49 game gets. The respect rules (plan §C.4) live here once:
 * a VerseCard always shows a WHOLE verified ayah, still and unaltered -- only
 * its frame may glow -- with a shape and a number beside its colour, and a
 * target big enough for a small hand.
 */
export interface GameProps {
  surah: number;
  /** The ayat this game is about (a segment, or the whole of a short surah). */
  ayahs: Ayah[];
  /** The whole surah: where a distractor may come from. */
  pool: Ayah[];
  /** The one recitation controller; null when there is no recitation. */
  audio: AudioController | null;
  band: Band;
  seed: number;
  onComplete: () => void;
}

export const arabic = (n: number) => n.toLocaleString('ar-EG');

/** Shapes, so a card is never told apart by colour alone. */
export const SHAPES = ['●', '▲', '■', '★', '◆'] as const;

/** Calls onComplete once, the first time `done` is true. */
export function useCompleteOnce(done: boolean, onComplete: () => void): void {
  const fired = useRef(false);
  useEffect(() => {
    if (done && !fired.current) {
      fired.current = true;
      onComplete();
    }
  }, [done, onComplete]);
}

/** The ayah being recited, as "surah:ayah", or null. */
export function usePlaying(audio: AudioController | null): string | null {
  const [playing, setPlaying] = useState<string | null>(audio?.playing ?? null);
  useEffect(() => (audio ? audio.onChange(setPlaying) : undefined), [audio]);
  return playing;
}

/** A whole ayah on a big card. The text is the verified verse, verbatim; nothing animates it. */
export function VerseCard({
  ayah,
  shape,
  glow = false,
  mark = null,
  disabled = false,
  onPress,
  label,
}: {
  ayah: Ayah;
  shape: number;
  glow?: boolean;
  mark?: 'right' | 'shown' | null;
  disabled?: boolean;
  onPress?: () => void;
  label?: string;
}) {
  const cls = ['play-card', glow ? 'play-card--glow' : '', mark ? `play-card--${mark}` : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} data-ayah={ayah.ayah} disabled={disabled} onClick={onPress} aria-label={label ?? `الآية ${arabic(ayah.ayah)}`}>
      <span className="play-card__shape" aria-hidden="true">
        {SHAPES[shape % SHAPES.length]} {arabic(ayah.ayah)}
      </span>
      <span className="play-card__verse">{ayah.text}</span>
      {mark ? (
        <span className="play-card__mark" role="status">
          {mark === 'right' ? '✓ أحسنت' : '✓ هذه هي'}
        </span>
      ) : null}
    </button>
  );
}

/** Beads: progress as a count of filled beads, never a colour alone. */
export function Beads({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <p className="beads" aria-label={`${label}: ${arabic(done)} من ${arabic(total)}`}>
      {'●'.repeat(done)}
      {'○'.repeat(Math.max(0, total - done))}
    </p>
  );
}

/** Praise, shown once a game is done. */
export function Praise({ text = 'أحسنت! ما شاء الله' }: { text?: string }) {
  return (
    <p className="praise" role="status">
      {text}
    </p>
  );
}
