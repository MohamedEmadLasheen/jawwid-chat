import { useEffect, useRef, useState } from 'react';
import type { AudioController } from '../../audio/audio-controller';
import type { Band } from '../../content/quran-content';
import type { Ayah } from '../../quran/dataset';
import { KNOBS } from '../adapt';

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

// An Arabic letter (hamza..yaa, and alef wasla): a token without one is a pause mark (as lesson-content's wordsOf).
const LETTER = new RegExp('[' + String.fromCodePoint(0x621) + '-' + String.fromCodePoint(0x64a) + String.fromCodePoint(0x671) + ']');

/**
 * The words of a verse as tiles, in order: each tile is one word with any pause mark after it
 * (a mark alone is never a tile, and never lost), so the tiles joined by spaces ARE the verse.
 * A game may hide or reorder whole tiles; it never changes one.
 */
export function tilesOf(verse: string): string[] {
  const out: string[] = [];
  for (const t of verse.split(' ')) {
    if (LETTER.test(t) || out.length === 0) out.push(t);
    else out[out.length - 1] += ' ' + t;
  }
  return out;
}

/** A tile as its word and the pause mark after it ('' if none): a game hides the word, the mark stays where it is. */
export function splitMark(tile: string): { word: string; mark: string } {
  const at = tile.indexOf(' ');
  return at < 0 ? { word: tile, mark: '' } : { word: tile.slice(0, at), mark: tile.slice(at + 1) };
}

/** A word's letters only, without its vowel and recitation marks: two words that look alike to a child share it. */
export function skeleton(word: string): string {
  return [...word].filter((c) => LETTER.test(c)).join('');
}

/** A word's first letter, bare: the cue a reciter is given, shown as a cue and never as the word. */
export function firstLetter(word: string): string {
  return [...word].find((c) => LETTER.test(c)) ?? '';
}

/** Shapes, so a card is never told apart by colour alone. */
export const SHAPES = ['●', '▲', '■', '★', '◆'] as const;
/** Their names, for a screen reader. */
export const SHAPE_NAMES = ['الدائرة', 'المثلث', 'المربع', 'النجمة', 'المعيّن'] as const;

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

/**
 * A whole ayah on a big card. The text is the verified verse, verbatim; nothing animates it.
 * Its accessible name is what it shows ("the ayah N", then the verse itself), never a label
 * that would hide the verse from a screen reader.
 */
export function VerseCard({
  ayah,
  shape,
  glow = false,
  mark = null,
  disabled = false,
  numbered = true,
  onPress,
}: {
  ayah: Ayah;
  shape: number;
  glow?: boolean;
  mark?: 'right' | 'shown' | null;
  disabled?: boolean;
  /** False where the number would give the answer away (ordering, what comes next): the shape stays. */
  numbered?: boolean;
  onPress?: () => void;
}) {
  const cls = ['play-card', glow ? 'play-card--glow' : '', mark ? `play-card--${mark}` : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} data-ayah={ayah.ayah} disabled={disabled} onClick={onPress}>
      <span className="play-card__shape">
        <span aria-hidden="true">{SHAPES[shape % SHAPES.length]} </span>
        {numbered ? (
          <>
            <span className="sr-only">الآية </span>
            {arabic(ayah.ayah)}
          </>
        ) : null}
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

/** Beads: progress as a count of filled beads, never a colour alone; a screen reader hears the count as text. */
export function Beads({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <p className="beads">
      <span aria-hidden="true">
        {'●'.repeat(done)}
        {'○'.repeat(Math.max(0, total - done))}
      </span>
      <span className="sr-only">{`${label}: ${arabic(done)} من ${arabic(total)}`}</span>
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

/**
 * The end of a game. 9-12 keeps a score, so what was missed is listed to review -- whole,
 * verified ayat, never the wrong choices -- and the child moves on when ready. Otherwise
 * (and when nothing was missed) it is praise, and the sitting moves on.
 */
export function GameEnd({ band, missed, onComplete }: { band: GameProps['band']; missed: readonly Ayah[]; onComplete: () => void }) {
  const review = KNOBS[band].reviewList && missed.length > 0;
  const [left, setLeft] = useState(false);
  useCompleteOnce(!review || left, onComplete);
  if (!review) return <Praise />;
  const unique = missed.filter((a, i) => missed.findIndex((b) => b.ayah === a.ayah) === i).sort((x, y) => x.ayah - y.ayah);
  return (
    <section className="play__review" aria-label="راجع هذه الآيات">
      <Praise text="أحسنت! انتهت اللعبة" />
      <h2>راجع هذه الآيات</h2>
      <div className="play-cards">
        {unique.map((a, i) => (
          <VerseCard key={a.ayah} ayah={a} shape={i} disabled />
        ))}
      </div>
      <button type="button" className="primary play__big" disabled={left} onClick={() => setLeft(true)}>
        التالي ←
      </button>
    </section>
  );
}
