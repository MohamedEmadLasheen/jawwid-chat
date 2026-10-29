import { Fragment, useMemo, useState } from 'react';
import { rng, shuffled } from '../../games/shuffle';
import type { Band } from '../../content/quran-content';
import type { Ayah } from '../../quran/dataset';
import { KNOBS } from '../adapt';
import { GameEnd, VerseCard, arabic, skeleton, splitMark, tilesOf, type GameProps } from './common';

/**
 * Complete the ayah (أكمل الآية), 6-8 and 9-12: an ayah with one word hidden (two for
 * 9-12), shown as a BLANK, never as a guess. The choices are real words of the same
 * surah, shown as words. A wrong choice is refused where it is -- it is never put into
 * the blank, so no false ayah is ever on screen -- and a right one fills the blank.
 * Then the whole verified ayah is shown. A hidden word's pause mark stays in its place.
 */

/** Words hidden in one ayah. */
export const BLANKS: Readonly<Record<Band, number>> = { '3-5': 0, '6-8': 1, '9-12': 2 };

export interface Blank {
  /** The tile's index in the ayah. */
  at: number;
  /** The hidden word (without its pause mark), and the choices for it, decided once. */
  word: string;
  options: string[];
}

export interface Gap {
  ayah: Ayah;
  tiles: string[];
  blanks: Blank[];
}

/**
 * The questions. An ayah needs a word on each side of what is hidden (so three words, four for two
 * blanks). The wrong choices are other words of the surah that do not look like the answer (another
 * spelling of the same letters would be a trick): for 9-12 from the nearest ayat, else from anywhere.
 *
 * One answer only: no wrong choice may complete ANOTHER ayah of the surah -- a near copy that differs
 * from this one only in the hidden word (the same letters, read as words).
 */
export function planGaps(ayahs: readonly Ayah[], pool: readonly Ayah[], band: Band, seed: number): Gap[] {
  const knobs = KNOBS[band];
  const next = rng(seed);
  const need = BLANKS[band];
  const out: Gap[] = [];
  // Each ayah as its words' letters: what a child reads, whatever the marks.
  const form = (tiles: readonly string[]) => tiles.map((t) => skeleton(splitMark(t).word)).join(' ');
  for (const ayah of ayahs) {
    if (out.length >= knobs.rounds || need === 0) break;
    const tiles = tilesOf(ayah.text);
    if (tiles.length < need + 2) continue;
    const others = new Set(pool.filter((a) => a.ayah !== ayah.ayah).map((a) => form(tilesOf(a.text))));
    const completesAnother = (at: number, w: string) => others.has(form(tiles.map((t, i) => (i === at ? w : t))));
    // Positions in reading order; never the first word, so the ayah is recognised from its start.
    const places = shuffled(tiles.map((_, i) => i).slice(1), seed + ayah.ayah).slice(0, need).sort((a, b) => a - b);
    const blanks: Blank[] = [];
    for (const at of places) {
      const word = splitMark(tiles[at]!).word;
      const words = pool
        .filter((a) => a.ayah !== ayah.ayah)
        .flatMap((a) => tilesOf(a.text).map((t) => ({ w: splitMark(t).word, d: Math.abs(a.ayah - ayah.ayah) })))
        .filter((x) => skeleton(x.w) !== skeleton(word) && skeleton(x.w).length > 0 && !completesAnother(at, x.w))
        .map((x) => ({ ...x, k: (knobs.distractors === 'near' ? x.d : 0) + next() }))
        .sort((x, y) => x.k - y.k);
      const picked: string[] = [];
      for (const x of words) if (picked.length < knobs.options - 1 && !picked.some((p) => skeleton(p) === skeleton(x.w))) picked.push(x.w);
      if (picked.length < 1) break;
      const options = shuffled(picked, seed + at);
      options.splice(Math.floor(next() * (options.length + 1)), 0, word);
      blanks.push({ at, word, options });
    }
    if (blanks.length === need) out.push({ ayah, tiles, blanks });
  }
  return out;
}

export const fitsComplete = (ayahs: readonly Ayah[], pool: readonly Ayah[], band: Band) => planGaps(ayahs, pool, band, 0).length > 0;

export function CompleteAyah({ ayahs, pool, band, seed, onComplete }: GameProps) {
  const knobs = KNOBS[band];
  const gaps = useMemo(() => planGaps(ayahs, pool, band, seed), [ayahs, pool, band, seed]);
  const [round, setRound] = useState(0);
  const [filled, setFilled] = useState(0);
  const [tries, setTries] = useState(0);
  const [refused, setRefused] = useState<string | null>(null);
  const [missed, setMissed] = useState<Ayah[]>([]);

  const current = gaps[round];
  if (!current) return <GameEnd band={band} missed={missed} onComplete={onComplete} />;

  const done = filled >= current.blanks.length;
  const blank = current.blanks[filled];
  const shown = tries >= knobs.triesBeforeShown;

  const choose = (w: string) => {
    if (done || !blank) return;
    if (w === blank.word) {
      setFilled(filled + 1);
      setTries(0);
      setRefused(null);
      return;
    }
    setTries(tries + 1);
    setRefused(w);
    if (!missed.includes(current.ayah)) setMissed([...missed, current.ayah]);
  };
  const nextRound = () => {
    setRound(round + 1);
    setFilled(0);
    setTries(0);
    setRefused(null);
  };

  return (
    <section className="play" aria-label="أكمل الآية">
      <p className="play__ask">
        أكمل الآية {arabic(current.ayah.ayah)}
      </p>
      {done ? (
        <div className="play-cards">
          <VerseCard ayah={current.ayah} shape={round} mark="right" disabled />
        </div>
      ) : (
        <>
          <p className="play__line">
            {current.tiles.map((t, i) => {
              const b = current.blanks.findIndex((x) => x.at === i);
              const { mark } = splitMark(t);
              return (
                // A space between words, so the line reads as words (the flex gap lays them out).
                <Fragment key={i}>
                  {i > 0 ? ' ' : null}
                  {b < 0 || b < filled ? (
                    <span className="play__slot">{t}</span>
                  ) : (
                    <span className="play__slot">
                      <span className={`play__slot--empty${b === filled ? ' play__slot--now' : ''}`}>
                        <span className="sr-only">{b === filled ? 'الكلمة الناقصة' : 'كلمة ناقصة أخرى'}</span>
                      </span>
                      {mark ? ` ${mark}` : null}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </p>
          <div className="play__tiles" role="group" aria-label="الاختيارات">
            {blank!.options.map((w) => (
              <button
                key={w}
                type="button"
                className={`play-tile${shown && w === blank!.word ? ' play-tile--shown' : ''}`}
                aria-disabled={refused === w}
                onClick={() => choose(w)}
              >
                {w}
                {shown && w === blank!.word ? <span className="play-tile__mark">✓ هذه هي</span> : null}
              </button>
            ))}
          </div>
          {refused ? (
            <p className="play__again" role="status">
              {shown ? 'هذه هي الكلمة' : 'حاول مرة أخرى'}
            </p>
          ) : null}
        </>
      )}
      {done ? (
        <button type="button" className="primary play__big" onClick={nextRound}>
          التالي ←
        </button>
      ) : null}
      <p className="note">
        السؤال {arabic(round + 1)} من {arabic(gaps.length)}
      </p>
    </section>
  );
}
