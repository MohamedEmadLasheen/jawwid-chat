import { useMemo, useState } from 'react';
import { shuffled, visitSeed } from '../games/shuffle';
import { has, type LetterUnit } from './letters';
import { TEXT, askPick } from './ui-text';

/**
 * Pick every word that contains the letter. The words with it come from the
 * unit; the words without it come from other units and are checked by the same
 * rule, so a hamza word is never offered as "without hamza" (the old ء game) and
 * an أ word never counts as alif.
 */
export function PickWords({
  unit,
  name,
  withLetter,
  others,
  seed,
  onComplete,
}: {
  unit: LetterUnit;
  name: string;
  withLetter: string[];
  others: string[];
  seed?: number;
  onComplete: () => void;
}) {
  const [visit] = useState(() => seed ?? visitSeed());
  const words = useMemo(() => {
    const yes = shuffled(withLetter, visit).slice(0, 3);
    const no = shuffled(others.filter((w) => !has(w, unit) && !yes.includes(w)), visit + 1).slice(0, 3);
    return shuffled([...new Set([...yes, ...no])], visit + 2);
  }, [withLetter, others, unit, visit]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null);
  if (!words.some((w) => has(w, unit))) return null;

  const toggle = (w: string) => {
    if (verdict === 'right') return;
    setVerdict(null);
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(w)) n.delete(w);
      else n.add(w);
      return n;
    });
  };
  const checkAnswer = () => {
    const right = words.every((w) => has(w, unit) === picked.has(w));
    setVerdict(right ? 'right' : 'wrong');
    if (right) onComplete();
  };
  return (
    <section className="game" aria-label="اختر الكلمات">
      <p className="game__round">{askPick(name)}</p>
      <div className="choices" role="group" aria-label="الكلمات">
        {words.map((w) => (
          <button key={w} type="button" aria-pressed={picked.has(w)} className={picked.has(w) ? 'choice choice--picked' : 'choice'} onClick={() => toggle(w)}>
            {w}
          </button>
        ))}
      </div>
      {verdict === 'right' ? (
        <p className="verdict verdict--right" role="status">
          {TEXT.right}
        </p>
      ) : verdict === 'wrong' ? (
        <p className="verdict verdict--wrong" role="status">
          {TEXT.notYet}
        </p>
      ) : null}
      {verdict === 'right' ? null : (
        <div className="game__actions">
          <button type="button" onClick={checkAnswer}>
            {TEXT.check}
          </button>
        </div>
      )}
    </section>
  );
}
