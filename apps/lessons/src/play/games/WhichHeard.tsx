import { useMemo, useState } from 'react';
import { rng, shuffled } from '../../games/shuffle';
import type { Ayah } from '../../quran/dataset';
import { KNOBS } from '../adapt';
import { Beads, Praise, VerseCard, type GameProps, useCompleteOnce } from './common';

/**
 * Which did you hear? (أيّ آية سمعت؟), 3-5: one ayah is recited; the child
 * touches its card among KNOBS.options (2 for 3-5). Every card is a whole, real
 * ayah of the surah, never an altered one. A wrong touch is refused where it is
 * ("try again"); after KNOBS.triesBeforeShown tries the right card is shown and
 * praised -- a 3-5 child never fails. Needs recitation.
 */
export interface Round {
  target: Ayah;
  options: Ayah[];
}

/**
 * The rounds, decided ONCE from the seed: targets walk the segment, distractors come from the rest of the
 * surah (far ones first; the plan's §B.3 records why not another surah), and the target's place is drawn.
 */
export function planRounds(ayahs: Ayah[], pool: Ayah[], count: number, options: number, seed: number): Round[] {
  const next = rng(seed);
  const rounds: Round[] = [];
  for (let r = 0; r < count; r++) {
    const target = ayahs[r % ayahs.length]!;
    // Distinct words only (two ayat with the same text cannot be told apart), far ones first for the youngest.
    const others = pool
      .filter((a) => a.ayah !== target.ayah && a.text !== target.text)
      .map((a) => ({ a, k: -Math.abs(a.ayah - target.ayah) + next() }))
      .sort((x, y) => x.k - y.k)
      .map((x) => x.a);
    const picked: Ayah[] = [];
    for (const a of others) if (picked.length < options - 1 && !picked.some((p) => p.text === a.text)) picked.push(a);
    // The target goes to an rng-chosen place among the shuffled distractors: never a fixed position.
    const opts = shuffled(picked, seed + r);
    opts.splice(Math.floor(next() * (opts.length + 1)), 0, target);
    rounds.push({ target, options: opts });
  }
  return rounds;
}

export function WhichHeard({ surah, ayahs, pool, audio, band, seed, onComplete }: GameProps) {
  const knobs = KNOBS[band];
  const rounds = useMemo(() => planRounds(ayahs, pool, knobs.rounds, knobs.options, seed), [ayahs, pool, knobs, seed]);
  const [round, setRound] = useState(0);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<'right' | 'shown' | 'again' | null>(null);
  const done = round >= rounds.length;

  useCompleteOnce(done, onComplete);

  const current = rounds[round];
  if (done || !current) return <Praise />;
  if (current.options.length < 2) return <p className="note">هذه السورة قصيرة جدًّا لهذه اللعبة.</p>;

  const touch = (a: Ayah) => {
    if (result === 'right' || result === 'shown') return;
    if (a.ayah === current.target.ayah) return setResult('right');
    const t = tries + 1;
    setTries(t);
    setResult(t >= knobs.triesBeforeShown ? 'shown' : 'again');
  };
  const nextRound = () => {
    audio?.stop();
    setRound(round + 1);
    setTries(0);
    setResult(null);
  };

  return (
    <section className="play" aria-label="أيّ آية سمعت؟">
      <button type="button" className="primary play__big" onClick={() => audio?.play(surah, current.target.ayah)}>
        🔊 لنستمع
      </button>
      <p className="play__ask">أيّ آية سمعنا؟</p>
      <div className="play-cards">
        {current.options.map((a, i) => (
          <VerseCard
            key={a.ayah}
            ayah={a}
            shape={i}
            onPress={() => touch(a)}
            mark={a.ayah === current.target.ayah && (result === 'right' || result === 'shown') ? result : null}
          />
        ))}
      </div>
      {result === 'again' ? (
        <p className="play__again" role="status">
          لنحاول مرة أخرى
        </p>
      ) : null}
      {result === 'right' || result === 'shown' ? (
        <button type="button" className="primary play__big" onClick={nextRound}>
          التالي ←
        </button>
      ) : null}
      <Beads done={round} total={rounds.length} label="الجولات" />
    </section>
  );
}
