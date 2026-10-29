import { Fragment, useMemo, useState } from 'react';
import { shuffled } from '../../games/shuffle';
import type { Band } from '../../content/quran-content';
import type { Ayah } from '../../quran/dataset';
import { GameEnd, VerseCard, arabic, firstLetter, splitMark, tilesOf, type GameProps } from './common';

/**
 * The fading ayah (المحو التدريجي), 6-8 and 9-12: the ayah is shown whole; the child
 * recites it aloud, and at each step more of its words are HIDDEN -- never changed --
 * until none is left (6-8, three steps) or, for 9-12, the fifth step leaves only each
 * word's first letter, shown as a cue in a box, never as the word. A hidden
 * word can be touched to see it again (the child checks themself), and at the end the
 * whole verified ayah is shown. Nothing is scored and nothing is recorded; with
 * recitation, the ayah can be heard.
 */

/** Steps from the whole ayah to the last cue (plan §C.2: 3 for 6-8; 5 for 9-12, the last first letters only). */
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
  const steps = STEPS[band];
  const [round, setRound] = useState(0);
  // 0 is the whole ayah; each step hides more; for 9-12 the last step is "first letters only"; then the reveal.
  const [step, setStep] = useState(0);
  const [peeked, setPeeked] = useState<ReadonlySet<number>>(new Set());
  const [revealed, setRevealed] = useState(false);

  const current = fades[round];
  if (!current) return <GameEnd band={band} missed={[]} onComplete={onComplete} />;

  const letters = band === '9-12' && step === steps;
  const hidden = new Set(letters ? current.order : current.order.slice(0, hiddenAt(current.tiles.length, step, steps)));
  const nextRound = () => {
    audio?.stop();
    setRound(round + 1);
    setStep(0);
    setPeeked(new Set());
    setRevealed(false);
  };

  return (
    <section className="play" aria-label="المحو التدريجي">
      <p className="play__ask">
        {revealed ? 'هذه هي الآية كاملة' : step === 0 ? `اقرأ الآية ${arabic(current.ayah.ayah)} بصوتك` : 'اقرأها بصوتك مرة أخرى، ولو بلا الكلمات المخفية'}
      </p>
      {revealed ? (
        <div className="play-cards">
          <VerseCard ayah={current.ayah} shape={round} disabled={!audio} onPress={() => audio?.play(surah, current.ayah.ayah)} />
        </div>
      ) : (
        <p className="play__line" aria-label={`الآية ${arabic(current.ayah.ayah)}، وفيها ${arabic(hidden.size)} من الكلمات مخفية`}>
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
                    <span className="play__cue">
                      <span className="sr-only">أول حرف: </span>
                      {firstLetter(word)}
                    </span>
                  ) : (
                    <span className="sr-only">كلمة مخفية، المسها لتراها</span>
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
          🔊 استمع إليها
        </button>
      ) : null}
      {revealed ? (
        <button type="button" className="primary play__big" onClick={nextRound}>
          التالي ←
        </button>
      ) : step < steps ? (
        <button type="button" className="primary play__big" onClick={() => (setStep(step + 1), setPeeked(new Set()))}>
          {band === '9-12' && step + 1 === steps ? 'أبقِ أوائل الحروف فقط' : 'أخفِ كلمات أكثر'}
        </button>
      ) : (
        <button type="button" className="primary play__big" onClick={() => setRevealed(true)}>
          اكشف الآية
        </button>
      )}
      <p className="note">
        الآية {arabic(round + 1)} من {arabic(fades.length)} · الخطوة {arabic(step)} من {arabic(steps)}
      </p>
    </section>
  );
}
