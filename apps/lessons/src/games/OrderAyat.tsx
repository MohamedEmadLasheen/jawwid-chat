import { useMemo, useState } from 'react';
import type { Ayah } from '../quran/dataset';
import { rounds, shuffled } from './shuffle';

/**
 * Put the ayat in order (#16). Each round's order is shuffled ONCE, from a seed,
 * into state: tapping never reorders the cards. The answer is checked by ayah
 * number, so two ayat with the same words cannot fail a correct order. Rounds
 * walk the whole surah, so every ayah is asked.
 */
export function OrderAyat({ surah, ayahs, onComplete }: { surah: number; ayahs: Ayah[]; onComplete: () => void }) {
  const plan = useMemo(() => rounds(ayahs.length), [ayahs.length]);
  const [round, setRound] = useState(0);
  const [order, setOrder] = useState<number[]>(() => shuffled(plan[0] ?? [], surah * 1000));
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null);
  const window = plan[round] ?? [];
  const byNumber = useMemo(() => new Map(ayahs.map((a) => [a.ayah, a])), [ayahs]);

  if (window.length < 2) return <p className="note">هذه السورة قصيرة جدًّا للعبة الترتيب.</p>;

  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[index], next[to]] = [next[to]!, next[index]!];
    setOrder(next);
    setVerdict(null);
  };

  const check = () => {
    const right = order.every((a, i) => a === window[i]);
    setVerdict(right ? 'right' : 'wrong');
    if (right && round === plan.length - 1) onComplete();
  };

  const nextRound = () => {
    const r = round + 1;
    setRound(r);
    setOrder(shuffled(plan[r] ?? [], surah * 1000 + r));
    setVerdict(null);
  };

  return (
    <section className="game" aria-label="رتّب الآيات">
      <p className="game__round">
        الجولة {(round + 1).toLocaleString('ar-EG')} من {plan.length.toLocaleString('ar-EG')}
      </p>
      <ol className="cards">
        {order.map((n, i) => (
          <li key={n} className="card" data-ayah={n}>
            <span className="card__text">{byNumber.get(n)?.text}</span>
            <span className="card__moves">
              <button type="button" aria-label="إلى الأعلى" onClick={() => move(i, -1)} disabled={i === 0}>
                ▲
              </button>
              <button type="button" aria-label="إلى الأسفل" onClick={() => move(i, 1)} disabled={i === order.length - 1}>
                ▼
              </button>
            </span>
          </li>
        ))}
      </ol>
      {verdict === 'right' ? (
        <p className="verdict verdict--right" role="status">
          أحسنت! ترتيب صحيح.
        </p>
      ) : verdict === 'wrong' ? (
        <p className="verdict verdict--wrong" role="status">
          ليس بعد، حاول مرة أخرى.
        </p>
      ) : null}
      <div className="game__actions">
        <button type="button" className="primary" onClick={check}>
          تحقّق
        </button>
        {verdict === 'right' && round < plan.length - 1 ? (
          <button type="button" onClick={nextRound}>
            الجولة التالية
          </button>
        ) : null}
      </div>
    </section>
  );
}
