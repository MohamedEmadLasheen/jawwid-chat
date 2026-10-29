import { useMemo, useState } from 'react';
import { shuffled } from '../../games/shuffle';
import type { Band } from '../../content/quran-content';
import type { Ayah } from '../../quran/dataset';
import { KNOBS } from '../adapt';
import { GameEnd, VerseCard, tilesOf, type GameProps } from './common';

/**
 * Start and end (بداية ونهاية), 6-8 and 9-12: real ayat cut in two at a word boundary
 * of the verified text. The child touches a start, then its end. Each half is shown as
 * a half -- marked with "…" where it was cut, and named "the start of an ayah" or "the
 * end of an ayah" -- so it never reads as an ayah. A start is never joined to an end
 * that is not its own: a wrong end is refused where it sits. A matched pair becomes the
 * whole verified ayah. 9-12 matches more pairs, from neighbouring ayat, whose endings
 * are alike.
 */

/** Pairs in one game (the plan: 3 halves for 6-8, 5 for 9-12). */
export const PAIRS: Readonly<Record<Band, number>> = { '3-5': 0, '6-8': 3, '9-12': 5 };

export interface Pair {
  ayah: Ayah;
  start: string;
  end: string;
}

/**
 * The pairs, from the segment's ayat first, then the nearest of the surah: an ayah of at least four
 * words, cut in the middle. No two starts and no two ends have the same words, so every match is one.
 */
export function planPairs(ayahs: readonly Ayah[], pool: readonly Ayah[], band: Band): Pair[] {
  const first = ayahs[0]?.ayah ?? 1;
  const last = ayahs[ayahs.length - 1]?.ayah ?? first;
  const dist = (a: Ayah) => (a.ayah < first ? first - a.ayah : a.ayah > last ? a.ayah - last : 0);
  const out: Pair[] = [];
  for (const ayah of [...pool].sort((x, y) => dist(x) - dist(y) || x.ayah - y.ayah)) {
    if (out.length >= PAIRS[band]) break;
    const tiles = tilesOf(ayah.text);
    if (tiles.length < 4) continue;
    const cut = Math.floor(tiles.length / 2);
    const pair = { ayah, start: tiles.slice(0, cut).join(' '), end: tiles.slice(cut).join(' ') };
    if (out.some((p) => p.start === pair.start || p.end === pair.end)) continue;
    out.push(pair);
  }
  return out.length >= 2 ? out : [];
}

export const fitsStartEnd = (ayahs: readonly Ayah[], pool: readonly Ayah[], band: Band) => planPairs(ayahs, pool, band).length > 0;

export function StartEnd({ ayahs, pool, band, seed, onComplete }: GameProps) {
  const knobs = KNOBS[band];
  const pairs = useMemo(() => planPairs(ayahs, pool, band), [ayahs, pool, band]);
  const starts = useMemo(() => shuffled(pairs, seed), [pairs, seed]);
  const ends = useMemo(() => shuffled(pairs, seed + 1), [pairs, seed]);
  const [picked, setPicked] = useState<Pair | null>(null);
  const [matched, setMatched] = useState<Pair[]>([]);
  const [tries, setTries] = useState(0);
  const [note, setNote] = useState<'again' | 'start' | null>(null);
  const [missed, setMissed] = useState<Ayah[]>([]);
  const [finished, setFinished] = useState(false);

  if (finished || pairs.length === 0) return <GameEnd band={band} missed={missed} onComplete={onComplete} />;

  const all = matched.length === pairs.length;
  const shown = !!picked && tries >= knobs.triesBeforeShown;

  const pickStart = (p: Pair) => {
    setPicked(p);
    setTries(0);
    setNote(null);
  };
  const pickEnd = (p: Pair) => {
    if (!picked) return setNote('start');
    if (p === picked) {
      setMatched([...matched, p]);
      setPicked(null);
      setTries(0);
      setNote(null);
      return;
    }
    setTries(tries + 1);
    setNote('again');
    if (!missed.includes(picked.ayah)) setMissed([...missed, picked.ayah]);
  };

  return (
    <section className="play" aria-label="بداية ونهاية">
      <p className="play__ask">المس بداية آية، ثم نهايتها</p>
      {matched.length > 0 ? (
        <div className="play-cards" aria-label="آيات اكتملت">
          {[...matched]
            .sort((x, y) => x.ayah.ayah - y.ayah.ayah)
            .map((p, i) => (
              <VerseCard key={p.ayah.ayah} ayah={p.ayah} shape={i} mark={p === matched[matched.length - 1] ? 'right' : null} disabled />
            ))}
        </div>
      ) : null}
      {all ? (
        <button type="button" className="primary play__big" onClick={() => setFinished(true)}>
          التالي ←
        </button>
      ) : (
        <div className="play__columns">
          <h2>البدايات</h2>
          <div className="play__tiles" role="group" aria-label="البدايات">
            {starts
              .filter((p) => !matched.includes(p))
              .map((p) => (
                <button key={p.ayah.ayah} type="button" className="play-tile play-half" aria-pressed={picked === p} onClick={() => pickStart(p)}>
                  <span>
                    <span className="sr-only">بداية آية: </span>
                    {p.start}
                    <span className="play-half__cut" aria-hidden="true">
                      {' …'}
                    </span>
                  </span>
                </button>
              ))}
          </div>
          <h2>النهايات</h2>
          <div className="play__tiles" role="group" aria-label="النهايات">
            {ends
              .filter((p) => !matched.includes(p))
              .map((p) => (
                <button key={p.ayah.ayah} type="button" className={`play-tile play-half${shown && p === picked ? ' play-tile--shown' : ''}`} onClick={() => pickEnd(p)}>
                  <span>
                    <span className="play-half__cut" aria-hidden="true">
                      {'… '}
                    </span>
                    <span className="sr-only">نهاية آية: </span>
                    {p.end}
                  </span>
                  {shown && p === picked ? <span className="play-tile__mark">✓ هذه هي</span> : null}
                </button>
              ))}
          </div>
          {note ? (
            <p className="play__again" role="status">
              {note === 'start' ? 'اختر بداية أولًا' : shown ? 'هذه هي نهايتها' : 'حاول مرة أخرى'}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
