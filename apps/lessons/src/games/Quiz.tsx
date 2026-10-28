import { useMemo, useRef, useState } from 'react';
import type { ResolvedQuiz } from '../content/lesson-content';
import { shuffled, visitSeed } from './shuffle';

const arabic = (n: number) => n.toLocaleString('ar-EG');

/**
 * The lesson's quiz: each question once, one answer each (the options lock),
 * options in an order fixed per visit. A question's ayah, prompt or word comes
 * from the verified text (lesson-content.ts); only the prose is reviewed content.
 */
export function Quiz({ quiz, seed, onComplete }: { quiz: ResolvedQuiz[]; seed?: number; onComplete: () => void }) {
  const [visit] = useState(() => seed ?? visitSeed());
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const completed = useRef(false);
  const q = quiz[index]!;
  const order = useMemo(() => shuffled(q.options.map((_, i) => i), visit + index), [q, visit, index]);

  if (finished) {
    return (
      <section className="game" aria-label="الاختبار">
        <p className="verdict" role="status">
          نتيجتك: {arabic(score)} من {arabic(quiz.length)}
        </p>
      </section>
    );
  }

  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    if (i === q.answer) setScore((s) => s + 1);
  };
  const next = () => {
    if (index < quiz.length - 1) {
      setIndex(index + 1);
      setPicked(null);
      return;
    }
    setFinished(true);
    if (!completed.current) {
      completed.current = true;
      onComplete();
    }
  };

  return (
    <section className="game" aria-label="الاختبار">
      <p className="game__round">
        السؤال {arabic(index + 1)} من {arabic(quiz.length)}
      </p>
      <h2 className="quiz__question">{q.question}</h2>
      {q.prompt ? (
        <p className="quiz__quran" data-testid="quiz-prompt">
          {q.prompt} …
        </p>
      ) : null}
      {q.word ? (
        <p className="quiz__quran" data-testid="quiz-word">
          {q.word}
        </p>
      ) : null}
      <div className="choices choices--stacked" role="group" aria-label="الاختيارات">
        {order.map((i) => (
          <button
            key={i}
            type="button"
            className={picked !== null && i === q.answer ? 'choice choice--right' : 'choice'}
            disabled={picked !== null}
            onClick={() => pick(i)}
          >
            {q.options[i]}
          </button>
        ))}
      </div>
      {picked === null ? null : picked === q.answer ? (
        <p className="verdict verdict--right" role="status">
          أحسنت!
        </p>
      ) : (
        <p className="verdict verdict--wrong" role="status">
          الإجابة الصحيحة: {q.options[q.answer]}
        </p>
      )}
      {picked !== null ? (
        <div className="game__actions">
          <button type="button" onClick={next}>
            {index < quiz.length - 1 ? 'التالي' : 'النتيجة'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
