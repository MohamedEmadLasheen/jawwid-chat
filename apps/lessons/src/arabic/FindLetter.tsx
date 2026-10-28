import { useState } from 'react';
import { clusters, type LetterUnit } from './letters';
import { TEXT, askFind } from './ui-text';

/**
 * Find the letter: each word as tappable pieces, every piece with its own
 * marks (the old game stripped them). A tap is right only on a piece that IS
 * the unit's letter by the one rule, so أ in أَسَدْ is never "alif".
 */
export function FindLetter({ unit, name, words, onComplete }: { unit: LetterUnit; name: string; words: string[]; onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null);
  const [finished, setFinished] = useState(false);
  if (words.length === 0) return null;
  if (finished) {
    return (
      <section className="game" aria-label="ابحث عن الحرف">
        <p className="verdict verdict--right" role="status">
          {TEXT.right}
        </p>
      </section>
    );
  }
  const word = words[index]!;
  const next = () => {
    setVerdict(null);
    if (index < words.length - 1) setIndex(index + 1);
    else {
      setFinished(true);
      onComplete();
    }
  };
  return (
    <section className="game" aria-label="ابحث عن الحرف">
      <p className="game__round">{askFind(name)}</p>
      <div className="letters-word" role="group" aria-label="الكلمة">
        {clusters(word, unit).map((piece, i) => (
          <button
            key={i}
            type="button"
            className={verdict === 'right' && piece.target ? 'piece piece--right' : 'piece'}
            disabled={verdict === 'right'}
            onClick={() => setVerdict(piece.target ? 'right' : 'wrong')}
          >
            {piece.text}
          </button>
        ))}
      </div>
      {verdict === 'right' ? (
        <>
          <p className="verdict verdict--right" role="status">
            {TEXT.right}
          </p>
          <div className="game__actions">
            <button type="button" onClick={next}>
              {TEXT.next}
            </button>
          </div>
        </>
      ) : verdict === 'wrong' ? (
        <p className="verdict verdict--wrong" role="status">
          {TEXT.again}
        </p>
      ) : null}
    </section>
  );
}
