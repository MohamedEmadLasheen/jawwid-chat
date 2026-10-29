import { Fragment, useMemo, useState } from 'react';
import { shuffled } from '../../games/shuffle';
import type { Band } from '../../content/quran-content';
import type { Ayah } from '../../quran/dataset';
import { GameEnd, VerseCard, arabic, firstLetter, skeleton, splitMark, tilesOf, type GameProps } from './common';

/**
 * The fading ayah (المحو التدريجي), 6-8 and 9-12: the ayah is shown whole; the child
 * recites it aloud, and at each step more of its words are HIDDEN -- never changed --
 * until none is left (6-8, three steps). For 9-12 a hidden word leaves its first letter,
 * shown as a cue in a box and never as the word, so the fifth step is first letters
 * only (each step harder than the last, whatever the ayah's length). A hidden
 * word can be touched to see it again (the child checks themself), and at the end the
 * whole verified ayah is shown. Nothing is scored and nothing is recorded; with
 * recitation, the ayah can be heard.
 */

/** Steps from the whole ayah to the last one (plan §C.2: 3 for 6-8; 5 for 9-12, ending in first letters only), never more than the ayah has words. */
export const STEPS: Readonly<Record<Band, number>> = { '3-5': 0, '6-8': 3, '9-12': 5 };
/** Ayat faded in one game. */
export const FADES = 3;

export interface Fade {
  ayah: Ayah;
  tiles: string[];
  /** The order the words are hidden in, decided once. */
  order: number[];
}

/** The ayat to fade: the segment's, of two words or more, up to FADES. */
export function planFades(ayahs: readonly Ayah[], seed: number): Fade[] {
  return ayahs
    .map((ayah) => ({ ayah, tiles: tilesOf(ayah.text) }))
    .filter((f) => f.tiles.length >= 2)
    .slice(0, FADES)
    .map((f) => ({ ...f, order: shuffled(f.tiles.map((_, i) => i), seed + f.ayah.ayah) }));
}

/** How many words are hidden at a step (0 = the whole ayah; the last step hides them all). */
export function hiddenAt(words: number, step: number, steps: number): number {
  return Math.min(words, Math.ceil((words * step) / steps));
}

export const fitsFading = (ayahs: readonly Ayah[]) => planFades(ayahs, 0).length > 0;

export function FadingAyah({ surah, ayahs, audio, band, seed, onComplete }: GameProps) {
  const fades = useMemo(() => planFades(ayahs, seed), [ayahs, seed]);
  const [round, setRound] = useState(0);
  // 0 is the whole ayah; each step hides more; then the reveal.
  const [step, setStep] = useState(0);
  const [peeked, setPeeked] = useState<ReadonlySet<number>>(new Set());
  const [revealed, setRevealed] = useState(false);

  const current = fades[round];
  if (!current) return <GameEnd band={band} missed={[]} onComplete={onComplete} />;

  // No more steps than words, so every step hides at least one more.
  const steps = Math.min(STEPS[band], current.tiles.length);

  // 9-12 keeps a hidden word's first letter as its cue.
  const letters = band === '9-12';
  const hidden = new Set(current.order.slice(0, hiddenAt(current.tiles.length, step, steps)));
  const nextRound = () => {
    audio?.stop();
    setRound(round + 1);
    setStep(0);
    setPeeked(new Set());
    setRevealed(false);
  };

  return (
    <section className="play" aria-label="نخفي ونتذكّر">
      <p className="play__ask">
        {revealed ? 'هذه هي الآية كاملة' : step === 0 ? `لنقرأ الآية ${arabic(current.ayah.ayah)} بصوت مسموع` : 'لنقرأها مرة أخرى، ونتذكّر الكلمات المخفية'}
      </p>
      {revealed ? (
        <div className="play-cards">
          <VerseCard ayah={current.ayah} shape={round} disabled={!audio} onPress={() => audio?.play(surah, current.ayah.ayah)} />
        </div>
      ) : (
        <p className="play__line">
          <span className="sr-only">{`الآية ${arabic(current.ayah.ayah)}، عدد الكلمات المخفية: ${arabic(hidden.size)}. `}</span>
          {current.tiles.map((t, i) => {
            const { word, mark } = splitMark(t);
            // A space between words, so the line reads as words (the flex gap lays them out).
            const gap = i > 0 ? ' ' : null;
            if (!hidden.has(i) || peeked.has(i)) {
              return (
                <Fragment key={i}>
                  {gap}
                  <span className="play__slot">{t}</span>
                </Fragment>
              );
            }
            return (
              <Fragment key={i}>
                {gap}
                <span className="play__slot">
                <button type="button" className="play__hidden" onClick={() => setPeeked(new Set([...peeked, i]))}>
                  {letters ? (
                    // A one-letter word (as نٓ) is its own cue: a bare letter would drop its marks.
                    skeleton(word).length <= 1 ? (
                      <span className="play__cue">
                        <span className="sr-only">الكلمة: </span>
                        {word}
                      </span>
                    ) : (
                      <span className="play__cue">
                        <span className="sr-only">أول حرف: </span>
                        {firstLetter(word)}
                      </span>
                    )
                  ) : (
                    <span className="sr-only">كلمة مخفية، تظهر عند اختيارها</span>
                  )}
                </button>
                {mark ? ` ${mark}` : null}
                </span>
              </Fragment>
            );
          })}
        </p>
      )}
      {audio && !revealed ? (
        <button type="button" className="play__big" onClick={() => audio.play(surah, current.ayah.ayah)}>
          🔊 لنستمع إليها
        </button>
      ) : null}
      {revealed ? (
        <button type="button" className="primary play__big" onClick={nextRound}>
          التالي ←
        </button>
      ) : step < steps ? (
        <button type="button" className="primary play__big" onClick={() => (setStep(step + 1), setPeeked(new Set()))}>
          {band === '9-12' && step + 1 === steps ? 'إبقاء الحرف الأول فقط' : 'إخفاء كلمات أخرى'}
        </button>
      ) : (
        <button type="button" className="primary play__big" onClick={() => setRevealed(true)}>
          إظهار الآية كاملة
        </button>
      )}
      <p className="note">
        الآية {arabic(round + 1)} من {arabic(fades.length)} · الخطوة {arabic(step)} من {arabic(steps)}
      </p>
    </section>
  );
}
