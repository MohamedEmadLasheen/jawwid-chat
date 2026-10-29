import { useMemo, useState } from 'react';
import { Quiz } from '../games/Quiz';
import { scrambled, visitSeed } from '../games/shuffle';
import { SectionHeader } from '../lesson/SectionHeader';
import { StarLedger } from '../lesson/stars';
import { arabicLessonFor } from '../arabic/index';
import { resolveReadingLesson, wordsOf } from './reading';

export type ReadingSection = 'read' | 'order' | 'quiz';
export const READING_SECTIONS: readonly ReadingSection[] = ['read', 'order', 'quiz'];
const LABELS: Record<ReadingSection, string> = { read: 'اِقْرَأْ', order: 'رَتِّبِ الْكَلِمَاتِ', quiz: 'الِاخْتِبَارُ' };
const KIND_LABEL = { syllables: 'مَقَاطِعُ', word: 'كَلِمَةٌ', sentence: 'جُمْلَةٌ' } as const;

/**
 * Put the words of a sentence in order. The order is shuffled ONCE per sentence
 * (from the visit's seed) into state, and the answer is the sentence itself --
 * never a stored order, so the two cannot disagree.
 */
export function OrderWords({ sentences, seed, onComplete }: { sentences: string[]; seed?: number; onComplete: () => void }) {
  const [visit] = useState(() => seed ?? visitSeed());
  const [round, setRound] = useState(0);
  const target = useMemo(() => (wordsOf(sentences[round] ?? '') ?? []).map((w, i) => ({ w, i })), [sentences, round]);
  const [order, setOrder] = useState(() => scrambled(target, visit));
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null);
  if (sentences.length === 0) return <p className="note">لَا جُمَلَ فِي هَذَا الدَّرْسِ.</p>;
  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[index], next[to]] = [next[to]!, next[index]!];
    setOrder(next);
    setVerdict(null);
  };
  const check = () => {
    // By the words' text, so a word that repeats in a sentence cannot fail a correct order.
    const right = order.every((x, i) => x.w === target[i]!.w);
    setVerdict(right ? 'right' : 'wrong');
    if (right && round === sentences.length - 1) onComplete();
  };
  const nextRound = () => {
    const r = round + 1;
    setRound(r);
    setOrder(scrambled((wordsOf(sentences[r] ?? '') ?? []).map((w, i) => ({ w, i })), visit + r));
    setVerdict(null);
  };
  return (
    <section className="game" aria-label="رتّب الكلمات">
      <p className="game__round">
        الجملة {(round + 1).toLocaleString('ar-EG')} من {sentences.length.toLocaleString('ar-EG')}
      </p>
      <ol className="cards">
        {order.map((x, i) => (
          <li key={x.i} className="card">
            <span className="card__text">{x.w}</span>
            <span className="card__moves">
              <button type="button" aria-label="قبلها" onClick={() => move(i, -1)} disabled={i === 0}>
                ▶
              </button>
              <button type="button" aria-label="بعدها" onClick={() => move(i, 1)} disabled={i === order.length - 1}>
                ◀
              </button>
            </span>
          </li>
        ))}
      </ol>
      {verdict ? (
        <p className={verdict === 'right' ? 'verdict verdict--right' : 'verdict verdict--wrong'} role="status">
          {verdict === 'right' ? 'أَحْسَنْتَ!' : 'حَاوِلْ مَرَّةً أُخْرَى.'}
        </p>
      ) : null}
      <div className="game__actions">
        <button type="button" className="primary" onClick={check}>
          تحقّق
        </button>
        {verdict === 'right' && round < sentences.length - 1 ? (
          <button type="button" onClick={nextRound}>
            الجملة التالية
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A reading lesson (PD-29 P0-5c). Nothing is shown until the Teachers
 * department approved the file; a file that fails a proof (reading.ts) is
 * refused whole.
 */
export function ReadingLesson({ lesson, content, shuffleSeed }: { lesson: number; content?: unknown; shuffleSeed?: number }) {
  const raw = content === undefined ? arabicLessonFor(lesson) : content;
  const resolved = useMemo(() => (raw === null ? undefined : resolveReadingLesson(raw, lesson)), [raw, lesson]);
  const stars = useMemo(() => new StarLedger<ReadingSection>(READING_SECTIONS), [lesson]);
  const [section, setSection] = useState<ReadingSection>('read');
  const [stageId, setStageId] = useState<string | null>(null);
  const [, setStarsVersion] = useState(0);
  const earn = (s: ReadingSection) => {
    if (stars.award(s)) setStarsVersion((v) => v + 1);
  };

  if (resolved === undefined || resolved === null || !resolved.approved) {
    return (
      <main className="lesson">
        <p className={resolved === null ? 'refused' : 'note'} role={resolved === null ? 'alert' : 'status'}>
          {resolved === undefined ? 'هذا الدرس قيد الإعداد.' : resolved === null ? 'تعذّر التحقق من هذا الدرس، فلم يُعرض شيء منه.' : 'هذا الدرس قيد المراجعة.'}
        </p>
      </main>
    );
  }

  const stages = resolved.stages.filter((s) => s.items.length > 0);
  const stage = stages.find((s) => s.id === stageId) ?? stages[0];
  // The order game plays the current stage's sentences (a passage's sentences live in a stage too).
  const sentences = stage ? stage.items.filter((it) => it.kind === 'sentence').map((it) => it.text) : [];

  return (
    <main className="lesson">
      <header className="lesson__head">
        <h1>الْقِرَاءَةُ</h1>
        <p className="lesson__stars" aria-label="النجوم">
          {'★'.repeat(stars.total)}
          {'☆'.repeat(stars.max - stars.total)}
        </p>
      </header>
      <SectionHeader sections={READING_SECTIONS} current={section} done={(s) => stars.has(s)} onSelect={setSection} labels={LABELS} />
      {stages.length > 1 ? (
        <nav className="letters-units" aria-label="المراحل">
          {stages.map((s) => (
            <button key={s.id} type="button" className={s.id === stage?.id ? 'section section--current' : 'section'} aria-current={s.id === stage?.id ? 'true' : undefined} onClick={() => setStageId(s.id)}>
              {s.name}
            </button>
          ))}
        </nav>
      ) : null}

      {section === 'read' && stage ? (
        <section aria-label={stage.name}>
          <ul className="reading-items">
            {stage.items.map((it) => (
              <li key={it.id} data-kind={it.kind}>
                <span className="reading-items__kind">{KIND_LABEL[it.kind]}</span> <span className="reading-items__text">{it.text}</span>
              </li>
            ))}
          </ul>
          {resolved.passages.map((p) => (
            <article key={p.id} className="reading-passage">
              <h2>{p.title}</h2>
              <p>{p.sentences.join(' ')}</p>
            </article>
          ))}
          <button type="button" className="primary" onClick={() => earn('read')}>
            قَرَأْتُ
          </button>
        </section>
      ) : null}
      {section === 'order' ? <OrderWords key={stage?.id} sentences={sentences} seed={shuffleSeed} onComplete={() => earn('order')} /> : null}
      {section === 'quiz' ? (
        resolved.quiz.length ? <Quiz quiz={resolved.quiz} seed={shuffleSeed} onComplete={() => earn('quiz')} /> : <p className="note">لَا أَسْئِلَةَ بَعْدُ.</p>
      ) : null}
    </main>
  );
}
