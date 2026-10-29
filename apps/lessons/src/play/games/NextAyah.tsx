import { useMemo, useState } from 'react';
import { rng, shuffled } from '../../games/shuffle';
import type { Ayah } from '../../quran/dataset';
import { KNOBS, type Knobs } from '../adapt';
import { GameEnd, VerseCard, arabic, type GameProps } from './common';

/**
 * What comes next? (ما الآية التالية؟), 6-8 and 9-12, longer surahs: an ayah is shown
 * whole, with its number; the child chooses the ayah that follows it among whole, real
 * ayat of the same surah, shown without their numbers. 9-12 is also asked what comes
 * before, every other round, with the neighbouring ayat as the wrong choices. A wrong
 * choice is refused where it sits; then the right one is shown. With recitation, the
 * shown ayah can be heard.
 */
export interface Ask {
  /** The ayah shown. */
  prompt: Ayah;
  /** Which way: the ayah after it, or (9-12) before it. */
  way: 'next' | 'previous';
  answer: Ayah;
  options: Ayah[];
}

/**
 * The questions, decided ONCE from the seed. Prompts walk the segment. Wrong choices are other ayat of
 * the surah with other words: for 6-8 never a neighbour of the prompt or the answer ("apart"), for 9-12
 * the nearest ones ("near").
 *
 * One answer only: a refrain (an ayah whose words come again in the surah, as in Ar-Rahman) is never
 * the prompt, since each of its copies is followed by another ayah. And no wrong choice is itself
 * next to (or, asking "before", just before) an ayah with the prompt's words.
 */
export function planAsks(ayahs: readonly Ayah[], pool: readonly Ayah[], knobs: Knobs, seed: number): Ask[] {
  const next = rng(seed);
  const by = new Map(pool.map((a) => [a.ayah, a]));
  const asks: Ask[] = [];
  const copies = (text: string) => pool.filter((a) => a.text === text).length;
  for (const prompt of ayahs) {
    if (asks.length >= knobs.rounds) break;
    if (copies(prompt.text) > 1) continue;
    const way = knobs.distractors === 'near' && asks.length % 2 === 1 && by.has(prompt.ayah - 1) ? 'previous' : 'next';
    const answer = by.get(prompt.ayah + (way === 'next' ? 1 : -1));
    if (!answer || answer.text === prompt.text) continue;
    const near = (a: Ayah) => Math.min(Math.abs(a.ayah - prompt.ayah), Math.abs(a.ayah - answer.ayah));
    // The ayah a wrong choice would answer for: the one before it (asking "next"), or after it.
    const beside = (a: Ayah) => by.get(a.ayah + (way === 'next' ? -1 : 1));
    const others = pool
      .filter((a) => a.ayah !== prompt.ayah && a.ayah !== answer.ayah && a.text !== answer.text && a.text !== prompt.text)
      .filter((a) => beside(a)?.text !== prompt.text)
      .filter((a) => knobs.distractors !== 'apart' || near(a) > 1)
      .map((a) => ({ a, k: (knobs.distractors === 'near' ? near(a) : 0) + next() }))
      .sort((x, y) => x.k - y.k)
      .map((x) => x.a);
    const picked: Ayah[] = [];
    for (const a of others) if (picked.length < knobs.options - 1 && !picked.some((p) => p.text === a.text)) picked.push(a);
    if (picked.length === 0) continue;
    const options = shuffled(picked, seed + asks.length);
    options.splice(Math.floor(next() * (options.length + 1)), 0, answer);
    asks.push({ prompt, way, answer, options });
  }
  return asks;
}

export const fitsNext = (ayahs: readonly Ayah[], pool: readonly Ayah[], band: GameProps['band']) => planAsks(ayahs, pool, KNOBS[band], 0).length > 0;

export function NextAyah({ surah, ayahs, pool, audio, band, seed, onComplete }: GameProps) {
  const knobs = KNOBS[band];
  const asks = useMemo(() => planAsks(ayahs, pool, knobs, seed), [ayahs, pool, knobs, seed]);
  const [round, setRound] = useState(0);
  const [tries, setTries] = useState(0);
  const [right, setRight] = useState(false);
  const [missed, setMissed] = useState<Ayah[]>([]);

  const current = asks[round];
  if (!current) return <GameEnd band={band} missed={missed} onComplete={onComplete} />;

  const shown = tries >= knobs.triesBeforeShown;
  const answered = right || shown;
  const choose = (a: Ayah) => {
    if (answered) return;
    if (a.ayah === current.answer.ayah) return setRight(true);
    setTries(tries + 1);
    if (!missed.includes(current.answer)) setMissed([...missed, current.answer]);
  };
  const nextRound = () => {
    audio?.stop();
    setRound(round + 1);
    setTries(0);
    setRight(false);
  };
  const ask = current.way === 'next' ? 'ما الآية التي تأتي بعدها؟' : 'ما الآية التي تأتي قبلها؟';

  return (
    <section className="play" aria-label="نتذكّر الآية التالية">
      <div className="play-cards">
        <VerseCard ayah={current.prompt} shape={0} disabled={!audio} onPress={() => audio?.play(surah, current.prompt.ayah)} />
      </div>
      <p className="play__ask">{ask}</p>
      <div className="play-cards" role="group" aria-label="الاختيارات">
        {current.options.map((a, i) => (
          <VerseCard
            key={a.ayah}
            ayah={a}
            shape={i + 1}
            numbered={answered}
            mark={answered && a === current.answer ? (right ? 'right' : 'shown') : null}
            onPress={() => choose(a)}
          />
        ))}
      </div>
      {tries > 0 && !answered ? (
        <p className="play__again" role="status">
          لنحاول مرة أخرى
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
