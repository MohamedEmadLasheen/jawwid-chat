import { useMemo, useState } from 'react';
import { scrambled, shuffled } from '../../games/shuffle';
import type { Band } from '../../content/quran-content';
import type { Ayah } from '../../quran/dataset';
import { KNOBS } from '../adapt';
import { Beads, GameEnd, SHAPE_NAMES, VerseCard, type GameProps } from './common';

/**
 * Order the ayat (رتّب الآيات), every band. Each card is a whole, real ayah, shown
 * without its number until it is in place (the number would give the order away).
 *
 *   - 3-5: two neighbouring ayat -- which comes first? With recitation, each can be heard.
 *   - 6-8 and 9-12: a few ayat of the segment, shuffled once; the child touches the one
 *     that comes next, and it joins the ordered list above. A card out of turn is refused
 *     where it sits, so the list only ever holds ayat in their true order.
 *
 * Works without recitation (a grown-up can read the cards to a 3-5 child).
 */

/** Cards in one ordering round (more would not fit a phone). */
export const WINDOW: Readonly<Record<Band, number>> = { '3-5': 2, '6-8': 5, '9-12': 6 };
/** Ordering rounds in one game. */
export const ROUNDS = 3;

/** One round: the ayat in their true order, and the order the cards are shown in, decided once. */
export interface Order {
  ayat: Ayah[];
  shown: Ayah[];
}

/**
 * n cards cut into rounds of at most `size`, as even as can be (7 by 6 is 4 and 3, never 6 and 1 or
 * 7): a round never holds more than the band allows, and none is left with one card.
 */
export function windows(n: number, size: number): number[][] {
  if (n < 2) return [];
  const count = Math.ceil(n / size);
  const base = Math.floor(n / count);
  const out: number[][] = [];
  let at = 1;
  for (let w = 0; w < count; w++) {
    const len = base + (w < n % count ? 1 : 0);
    out.push(Array.from({ length: len }, (_, k) => at + k));
    at += len;
  }
  return out;
}

/** 3-5: neighbouring pairs, starting from each ayah of the segment; two ayat with the same words are never a pair. */
function pairs(ayahs: readonly Ayah[], pool: readonly Ayah[]): Ayah[][] {
  const by = new Map(pool.map((a) => [a.ayah, a]));
  const out: Ayah[][] = [];
  for (const a of ayahs) {
    const next = by.get(a.ayah + 1);
    const prev = by.get(a.ayah - 1);
    const pair = next ? [a, next] : prev ? [prev, a] : null;
    if (pair && pair[0]!.text !== pair[1]!.text && !out.some((p) => p[0]!.ayah === pair[0]!.ayah)) out.push(pair);
  }
  return out;
}

export function planOrders(ayahs: readonly Ayah[], pool: readonly Ayah[], band: Band, seed: number): Order[] {
  const groups =
    band === '3-5'
      ? pairs(ayahs, pool)
      : windows(ayahs.length, WINDOW[band])
          .map((w) => w.map((i) => ayahs[i - 1]!))
          // Two cards with the same words could not be told apart: such a window is not asked.
          .filter((w) => w.length >= 2 && new Set(w.map((a) => a.text)).size === w.length);
  return groups.slice(0, band === '3-5' ? KNOBS[band].rounds : ROUNDS).map((ayat, r) => ({
    ayat,
    // A pair may come in its own order (uniform): "which is first?" must not always be the second card.
    shown: band === '3-5' ? shuffled(ayat, seed + r) : scrambled(ayat, seed + r),
  }));
}

export const fitsOrder = (ayahs: readonly Ayah[], pool: readonly Ayah[], band: Band) => planOrders(ayahs, pool, band, 0).length > 0;

export function OrderAyat({ surah, ayahs, pool, audio, band, seed, onComplete }: GameProps) {
  const knobs = KNOBS[band];
  const orders = useMemo(() => planOrders(ayahs, pool, band, seed), [ayahs, pool, band, seed]);
  const [round, setRound] = useState(0);
  const [placed, setPlaced] = useState(0);
  const [tries, setTries] = useState(0);
  const [missed, setMissed] = useState<Ayah[]>([]);

  const current = orders[round];
  if (!current) return <GameEnd band={band} missed={missed} onComplete={onComplete} />;

  const shownAnswer = tries >= knobs.triesBeforeShown;
  // A pair is done when its first is found, or shown (and praised: a 3-5 child never fails);
  // a longer round when every card is in place.
  const done = band === '3-5' ? placed >= 1 || shownAnswer : placed >= current.ayat.length;
  const want = current.ayat[placed];

  const touch = (a: Ayah) => {
    if (done || !want) return;
    if (a.ayah === want.ayah) {
      setPlaced(placed + 1);
      setTries(0);
      // The last card of a longer round has nowhere else to go: it is placed with the one before.
      if (band !== '3-5' && placed + 2 === current.ayat.length) setPlaced(current.ayat.length);
      return;
    }
    setTries(tries + 1);
    if (!missed.includes(want)) setMissed([...missed, want]);
  };
  const nextRound = () => {
    audio?.stop();
    setRound(round + 1);
    setPlaced(0);
    setTries(0);
  };

  const tray = current.shown.filter((a) => !current.ayat.slice(0, placed).includes(a));
  return (
    <section className="play" aria-label="نرتّب الآيات">
      <p className="play__ask">
        {band === '3-5' ? 'أيّ الآيتين تأتي أولًا؟' : done ? 'أحسنت! هذا ترتيبها' : placed === 0 ? 'لنختر الآية التي تأتي أولًا' : 'لنختر الآية التي تليها'}
      </p>
      {band === '3-5' ? (
        <div className="play-cards">
          {current.shown.map((a, i) => (
            <div key={a.ayah} className="play__pair">
              <VerseCard ayah={a} shape={i} numbered={false} mark={a === current.ayat[0] && done ? (placed >= 1 ? 'right' : 'shown') : null} onPress={() => touch(a)} />
              {audio ? (
                <button type="button" className="play__big" onClick={() => audio.play(surah, a.ayah)}>
                  🔊 لنستمع<span className="sr-only">{` إلى الآية التي في ${SHAPE_NAMES[i % SHAPE_NAMES.length]}`}</span>
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <>
          {placed > 0 ? (
            <ol className="play-cards" aria-label="الآيات المرتّبة">
              {current.ayat.slice(0, placed).map((a, i) => (
                <li key={a.ayah}>
                  <VerseCard ayah={a} shape={i} disabled mark={done && i === placed - 1 ? 'right' : null} />
                </li>
              ))}
            </ol>
          ) : null}
          {done ? null : (
            <div className="play-cards" role="group" aria-label="الآيات">
              {tray.map((a, i) => (
                <VerseCard key={a.ayah} ayah={a} shape={i + placed} numbered={false} mark={shownAnswer && a === want ? 'shown' : null} onPress={() => touch(a)} />
              ))}
            </div>
          )}
        </>
      )}
      {tries > 0 && !done ? (
        <p className="play__again" role="status">
          {shownAnswer ? (placed === 0 ? 'هذه هي الآية الأولى' : 'هذه هي الآية التالية') : 'لنحاول مرة أخرى'}
        </p>
      ) : null}
      {done ? (
        <button type="button" className="primary play__big" onClick={nextRound}>
          التالي ←
        </button>
      ) : null}
      <Beads done={round + (done ? 1 : 0)} total={orders.length} label="الجولات" />
    </section>
  );
}
