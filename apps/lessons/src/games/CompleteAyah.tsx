import { useMemo, useRef, useState } from 'react';
import type { Ayah } from '../quran/dataset';
import type { ResolvedContent } from '../content/lesson-content';
import { wordsOf } from '../content/lesson-content';
import { shuffled, visitSeed } from './shuffle';

type Item = ResolvedContent['complete'][number];

/**
 * A round's three choices: its word, and two OTHER game words (never a
 * hand-typed distractor, never the same word twice), in an order fixed by the
 * seed -- they do not move under the child's finger.
 */
export function optionsFor(items: readonly Item[], i: number, seed: number): string[] {
  const answer = items[i]!.text;
  const others = [...new Set(items.filter((_, j) => j !== i).map((x) => x.text))].filter((t) => t !== answer);
  return shuffled([answer, ...shuffled(others, seed + i).slice(0, 2)], seed * 31 + i);
}

/** The verse with the item's word hidden, or shown once found. */
function verseWith(verse: string, word: number, shown: boolean): string {
  let n = 0;
  const letterTokens = new Set(wordsOf(verse));
  return verse
    .split(' ')
    .map((t) => (letterTokens.has(t) && ++n === word && !shown ? '____' : t))
    .join(' ');
}

/**
 * Complete the ayah (the old "أكمل الآية" and "الكلمة الناقصة" games, as one):
 * the verified verse with one word hidden. A wrong pick may be retried; the
 * section is complete when every word has been found.
 */
export function CompleteAyah({ ayahs, items, seed, onComplete }: { ayahs: Ayah[]; items: Item[]; seed?: number; onComplete: () => void }) {
  const [visit] = useState(() => seed ?? visitSeed());
  const [round, setRound] = useState(0);
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null);
  const completed = useRef(false);
  const item = items[round]!;
  const options = useMemo(() => optionsFor(items, round, visit), [items, round, visit]);
  const verse = ayahs[item.ayah - 1]?.text ?? '';
  const found = verdict === 'right';

  const pick = (word: string) => {
    if (found) return;
    const right = word === item.text;
    setVerdict(right ? 'right' : 'wrong');
    if (right && round === items.length - 1 && !completed.current) {
      completed.current = true;
      onComplete();
    }
  };

  return (
    <section className="game" aria-label="أكمل الآية">
      <p className="game__round">
        الكلمة {(round + 1).toLocaleString('ar-EG')} من {items.length.toLocaleString('ar-EG')}
      </p>
      <p className="complete__verse" data-testid="complete-verse">
        {verseWith(verse, item.word, found)}
      </p>
      <div className="choices" role="group" aria-label="الاختيارات">
        {options.map((w) => (
          <button key={w} type="button" className="choice" disabled={found} onClick={() => pick(w)}>
            {w}
          </button>
        ))}
      </div>
      {verdict === 'right' ? (
        <p className="verdict verdict--right" role="status">
          أحسنت!
        </p>
      ) : verdict === 'wrong' ? (
        <p className="verdict verdict--wrong" role="status">
          حاول مرة أخرى.
        </p>
      ) : null}
      {found && round < items.length - 1 ? (
        <div className="game__actions">
          <button type="button" onClick={() => { setRound(round + 1); setVerdict(null); }}>
            التالي
          </button>
        </div>
      ) : null}
    </section>
  );
}
