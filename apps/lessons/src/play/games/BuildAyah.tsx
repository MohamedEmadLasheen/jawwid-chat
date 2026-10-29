import { Fragment, useMemo, useState } from 'react';
import { scrambled } from '../../games/shuffle';
import type { Band } from '../../content/quran-content';
import type { Ayah } from '../../quran/dataset';
import { KNOBS } from '../adapt';
import { Beads, GameEnd, VerseCard, arabic, tilesOf, type GameProps } from './common';

/**
 * Build the ayah (ركّب الآية), 6-8 and 9-12: an ayah's own words are tiles; the child
 * taps them in order into the line. The words are only ever that ayah's, each whole
 * (with its pause mark), and they are tiles in a line -- never objects to catch, stack,
 * feed or throw. A tile that is not next is refused where it sits: the line only ever
 * holds the ayah's words in their order, and what is not yet built is shown as blanks.
 * Once built, the whole verified ayah is shown. 6-8 starts with the first word placed.
 */

/** Words an ayah may have for this band (the plan's "≤ 6 words" for 6-8; long ayat are not built). */
export const MAX_TILES: Readonly<Record<Band, number>> = { '3-5': 0, '6-8': 6, '9-12': 10 };
/** Ayat built in one game. */
export const BUILDS = 3;

export interface Build {
  ayah: Ayah;
  tiles: string[];
  /** Tiles placed before the child starts (the first word, for 6-8). */
  given: number;
  /** The tray: indexes into `tiles`, in the order shown, decided once. */
  tray: number[];
}

/** The ayat that can be built: three to MAX_TILES words, so there is an order to find. */
export function buildable(ayahs: readonly Ayah[], band: Band): Ayah[] {
  return ayahs.filter((a) => {
    const n = tilesOf(a.text).length;
    return n >= 3 && n <= MAX_TILES[band];
  });
}

export const fitsBuild = (ayahs: readonly Ayah[], _pool: readonly Ayah[], band: Band) => buildable(ayahs, band).length > 0;

export function planBuilds(ayahs: readonly Ayah[], band: Band, seed: number): Build[] {
  return buildable(ayahs, band)
    .slice(0, BUILDS)
    .map((ayah, r) => {
      const tiles = tilesOf(ayah.text);
      const given = band === '6-8' ? 1 : 0;
      const rest = tiles.map((_, i) => i).slice(given);
      // Text, not index: two equal words are the same tile to the child, so the original order is never offered.
      const order = scrambled(rest.map((i) => tiles[i]!), seed + r);
      const left = [...rest];
      const tray = order.map((t) => left.splice(left.findIndex((i) => tiles[i] === t), 1)[0]!);
      return { ayah, tiles, given, tray };
    });
}

export function BuildAyah({ ayahs, band, seed, onComplete }: GameProps) {
  const knobs = KNOBS[band];
  const builds = useMemo(() => planBuilds(ayahs, band, seed), [ayahs, band, seed]);
  const [round, setRound] = useState(0);
  const [placed, setPlaced] = useState<number[]>(() => builds[0]?.tiles.slice(0, builds[0].given).map((_, i) => i) ?? []);
  const [tries, setTries] = useState(0);
  const [again, setAgain] = useState(false);
  const [missed, setMissed] = useState<Ayah[]>([]);

  const current = builds[round];
  if (!current) return <GameEnd band={band} missed={missed} onComplete={onComplete} />;

  const built = placed.length === current.tiles.length;
  const want = current.tiles[placed.length];
  const shown = tries >= knobs.triesBeforeShown;

  const tap = (i: number) => {
    if (built) return;
    // Equal words are interchangeable: the word, not the tile, is what must come next.
    if (current.tiles[i] === want) {
      setPlaced([...placed, i]);
      setTries(0);
      setAgain(false);
      return;
    }
    setTries(tries + 1);
    setAgain(true);
    if (!missed.includes(current.ayah)) setMissed([...missed, current.ayah]);
  };
  const nextRound = () => {
    const r = round + 1;
    setRound(r);
    setPlaced(builds[r]?.tiles.slice(0, builds[r]!.given).map((_, i) => i) ?? []);
    setTries(0);
    setAgain(false);
  };

  return (
    <section className="play" aria-label="ركّب الآية">
      <p className="play__ask">
        لنركّب الآية {arabic(current.ayah.ayah)}: نلمس الكلمات بترتيبها
      </p>
      {built ? (
        <div className="play-cards">
          <VerseCard ayah={current.ayah} shape={round} mark="right" disabled />
        </div>
      ) : (
        <>
          <p className="play__line">
            <span className="sr-only">{`الكلمات المرتّبة: ${arabic(placed.length)} من ${arabic(current.tiles.length)}: `}</span>
            {current.tiles.map((t, i) => (
              // A space between words, so the line reads as words (the flex gap lays them out).
              <Fragment key={i}>
                {i > 0 ? ' ' : null}
                {i < placed.length ? <span className="play__slot">{t}</span> : <span className="play__slot play__slot--empty" aria-hidden="true" />}
              </Fragment>
            ))}
          </p>
          <div className="play__tiles" role="group" aria-label="الكلمات">
            {current.tray
              .filter((i) => !placed.includes(i))
              .map((i) => (
                <button key={i} type="button" className={`play-tile${shown && current.tiles[i] === want ? ' play-tile--shown' : ''}`} onClick={() => tap(i)}>
                  {current.tiles[i]}
                  {shown && current.tiles[i] === want ? <span className="play-tile__mark">✓ هذه هي</span> : null}
                </button>
              ))}
          </div>
          {again ? (
            <p className="play__again" role="status">
              {shown ? 'هذه هي الكلمة التالية' : 'لنحاول مرة أخرى'}
            </p>
          ) : null}
        </>
      )}
      {built ? (
        <button type="button" className="primary play__big" onClick={nextRound}>
          التالي ←
        </button>
      ) : null}
      <Beads done={round + (built ? 1 : 0)} total={builds.length} label="الآيات" />
    </section>
  );
}
