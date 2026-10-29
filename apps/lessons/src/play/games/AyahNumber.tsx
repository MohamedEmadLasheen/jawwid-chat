import { useMemo, useState } from 'react';
import { rng } from '../../games/shuffle';
import type { Ayah } from '../../quran/dataset';
import { KNOBS, type Knobs } from '../adapt';
import { GameEnd, VerseCard, arabic, type GameProps } from './common';

/**
 * The ayah number (رقم الآية), 9-12, longer surahs: two kinds of question, in turn.
 *   - "What number is this ayah?": a whole ayah without its number, and consecutive numbers
 *     to choose from, in order, the answer anywhere among them.
 *   - "Which comes first?": two whole ayat of the surah without their numbers.
 * Every ayah is the verified text, whole. An ayah whose words appear again elsewhere in the
 * surah is never asked (its number could not be told from its words). A wrong choice is
 * refused; then the answer is shown, with the numbers.
 */
export type NumberAsk =
  | { kind: 'number'; ayah: Ayah; options: number[] }
  | { kind: 'first'; pair: [Ayah, Ayah]; first: Ayah };

export function planNumbers(ayahs: readonly Ayah[], pool: readonly Ayah[], knobs: Knobs, seed: number): NumberAsk[] {
  const next = rng(seed);
  const unique = (a: Ayah) => pool.filter((b) => b.text === a.text).length === 1;
  const asks: NumberAsk[] = [];
  const prompts = ayahs.filter(unique);
  for (let i = 0; i < prompts.length && asks.length < knobs.rounds; i++) {
    const ayah = prompts[i]!;
    if (asks.length % 2 === 0) {
      // Consecutive numbers around it, the window placed at random: the answer is not always the middle one.
      const count = Math.min(knobs.options, pool.length);
      if (count < 2) continue;
      const lo = Math.max(1, Math.min(ayah.ayah - Math.floor(next() * count), pool.length - count + 1));
      asks.push({ kind: 'number', ayah, options: Array.from({ length: count }, (_, k) => lo + k) });
    } else {
      // Its partner: another unique ayah of the surah, a few ayat away (not the next, which "what comes next" asks).
      const others = pool.filter((b) => unique(b) && Math.abs(b.ayah - ayah.ayah) >= 2);
      if (others.length === 0) continue;
      const other = others[Math.floor(next() * others.length)]!;
      const first = other.ayah < ayah.ayah ? other : ayah;
      asks.push({ kind: 'first', pair: next() < 0.5 ? [ayah, other] : [other, ayah], first });
    }
  }
  return asks;
}

export const fitsNumber = (ayahs: readonly Ayah[], pool: readonly Ayah[], band: GameProps['band']) => planNumbers(ayahs, pool, KNOBS[band], 0).length > 0;

export function AyahNumber({ ayahs, pool, band, seed, onComplete }: GameProps) {
  const knobs = KNOBS[band];
  const asks = useMemo(() => planNumbers(ayahs, pool, knobs, seed), [ayahs, pool, knobs, seed]);
  const [round, setRound] = useState(0);
  const [tries, setTries] = useState(0);
  const [right, setRight] = useState(false);
  const [missed, setMissed] = useState<Ayah[]>([]);

  const current = asks[round];
  if (!current) return <GameEnd band={band} missed={missed} onComplete={onComplete} />;

  const shown = tries >= knobs.triesBeforeShown;
  const answered = right || shown;
  const target = current.kind === 'number' ? current.ayah : current.first;
  const answer = (ok: boolean) => {
    if (answered) return;
    if (ok) return setRight(true);
    setTries(tries + 1);
    if (!missed.includes(target)) setMissed([...missed, target]);
  };
  const nextRound = () => {
    setRound(round + 1);
    setTries(0);
    setRight(false);
  };
  const mark = (ok: boolean) => (answered && ok ? (right ? 'right' : 'shown') : null);

  return (
    <section className="play" aria-label="رقم الآية">
      {current.kind === 'number' ? (
        <>
          <p className="play__ask">ما رقم هذه الآية؟</p>
          <div className="play-cards">
            <VerseCard ayah={current.ayah} shape={0} numbered={answered} disabled />
          </div>
          <div className="play__tiles" role="group" aria-label="الأرقام">
            {current.options.map((n) => (
              <button key={n} type="button" className={`play-tile play-number${mark(n === current.ayah.ayah) ? ' play-tile--shown' : ''}`} onClick={() => answer(n === current.ayah.ayah)}>
                {arabic(n)}
                {mark(n === current.ayah.ayah) ? <span className="play-tile__mark">{right ? '✓ أحسنت' : '✓ هذه هي'}</span> : null}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="play__ask">أيّ الآيتين تأتي أولًا في السورة؟</p>
          <div className="play-cards" role="group" aria-label="الآيتان">
            {current.pair.map((a, i) => (
              <VerseCard key={a.ayah} ayah={a} shape={i} numbered={answered} mark={mark(a === current.first)} onPress={() => answer(a === current.first)} />
            ))}
          </div>
        </>
      )}
      {tries > 0 && !answered ? (
        <p className="play__again" role="status">
          حاول مرة أخرى
        </p>
      ) : null}
      {answered ? (
        <button type="button" className="primary play__big" onClick={nextRound}>
          التالي ←
        </button>
      ) : null}
      <p className="note">
        السؤال {arabic(round + 1)} من {arabic(asks.length)}
      </p>
    </section>
  );
}
