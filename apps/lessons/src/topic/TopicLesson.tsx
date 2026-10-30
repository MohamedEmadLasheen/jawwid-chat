import { useEffect, useMemo, useState } from 'react';
import { Quiz } from '../games/Quiz';
import { SectionHeader } from '../lesson/SectionHeader';
import { StarLedger } from '../lesson/stars';
import { BUILD_ANCHOR, fetchJson, loadSurah, type Fetcher, type QuranAnchor, type Surah } from '../quran/dataset';
import { islamicLessonFor } from '../islamic/index';
import { resolveTopicLesson } from './topic';

export type TopicPart = 'read' | 'quiz';
export const TOPIC_PARTS: readonly TopicPart[] = ['read', 'quiz'];
const LABELS: Record<TopicPart, string> = { read: 'الدَّرْسُ', quiz: 'الِاخْتِبَارُ' };

/**
 * A topic lesson (the Islamic Studies lessons). Nothing of its content is shown until the Teachers
 * department approved the file. A Quran block is drawn from the verified dataset (loadSurah, with the
 * build's anchor check), never from the lesson file; a reference the verified text does not have
 * refuses the whole lesson. A hadith is never shown (held until a verified source is approved).
 */
export function TopicLesson({ lesson, content, fetcher = fetchJson, anchor = BUILD_ANCHOR, shuffleSeed }: { lesson: number; content?: unknown; fetcher?: Fetcher; anchor?: QuranAnchor | null; shuffleSeed?: number }) {
  const raw = content === undefined ? islamicLessonFor(lesson) : content;
  const resolved = useMemo(() => (raw === null ? undefined : resolveTopicLesson(raw, lesson)), [raw, lesson]);
  const stars = useMemo(() => new StarLedger<TopicPart>(TOPIC_PARTS), [lesson]);
  const [part, setPart] = useState<TopicPart>('read');
  const [, setStarsVersion] = useState(0);
  const [surahs, setSurahs] = useState<Map<number, Surah> | 'refused' | null>(null);
  const earn = (p: TopicPart) => {
    if (stars.award(p)) setStarsVersion((v) => v + 1);
  };

  const wanted = useMemo(
    () => [...new Set((resolved?.approved ? resolved.sections : []).flatMap((s) => s.blocks.flatMap((b) => (b.kind === 'quran' ? [b.surah] : []))))],
    [resolved],
  );
  useEffect(() => {
    let live = true;
    setSurahs(null);
    Promise.all(wanted.map((n) => loadSurah(n, fetcher, anchor))).then(
      (list) => live && setSurahs(new Map(list.map((s) => [s.info.number, s]))),
      () => live && setSurahs('refused'),
    );
    return () => {
      live = false;
    };
  }, [wanted, fetcher, anchor]);

  const outOfRange =
    resolved?.approved && surahs instanceof Map
      ? resolved.sections.some((s) => s.blocks.some((b) => b.kind === 'quran' && (!surahs.has(b.surah) || b.to > surahs.get(b.surah)!.ayahs.length)))
      : false;

  if (resolved === undefined || resolved === null || !resolved.approved || surahs === 'refused' || outOfRange) {
    const refused = resolved === null || surahs === 'refused' || outOfRange;
    return (
      <main className="lesson">
        <p className={refused ? 'refused' : 'note'} role={refused ? 'alert' : 'status'}>
          {resolved === undefined ? 'هذا الدرس قيد الإعداد.' : refused ? 'تعذّر التحقق من هذا الدرس، فلم يُعرض شيء منه.' : 'هذا الدرس قيد المراجعة.'}
        </p>
      </main>
    );
  }

  return (
    <main className="lesson">
      <header className="lesson__head">
        <h1>{resolved.title ?? 'الدَّرْسُ'}</h1>
        <p className="lesson__stars" aria-label="النجوم">
          {'★'.repeat(stars.total)}
          {'☆'.repeat(stars.max - stars.total)}
        </p>
      </header>
      <SectionHeader sections={TOPIC_PARTS} current={part} done={(p) => stars.has(p)} onSelect={setPart} labels={LABELS} />
      {part === 'read' ? (
        <>
          {resolved.sections.map((s) => (
            <section key={s.id} className="topic-section" aria-label={s.title ?? s.id}>
              {s.title ? <h2>{s.title}</h2> : null}
              {s.blocks.map((b) =>
                b.kind === 'text' ? (
                  <p key={b.id} className="topic-text">
                    {b.text}
                  </p>
                ) : (
                  <QuranRef key={b.id} surah={surahs instanceof Map ? surahs.get(b.surah) : undefined} from={b.from} to={b.to} />
                ),
              )}
            </section>
          ))}
          <button type="button" className="primary" onClick={() => earn('read')}>
            قَرَأْتُ
          </button>
        </>
      ) : null}
      {part === 'quiz' ? (
        resolved.quiz.length ? <Quiz quiz={resolved.quiz} seed={shuffleSeed} onComplete={() => earn('quiz')} /> : <p className="note">لَا أَسْئِلَةَ بَعْدُ.</p>
      ) : null}
    </main>
  );
}

/** Verified ayat by reference: the text is the dataset's, drawn in the Quran font, with its surah and ayah numbers. */
function QuranRef({ surah, from, to }: { surah: Surah | undefined; from: number; to: number }) {
  if (!surah) return <p className="note">…</p>;
  const ayahs = surah.ayahs.filter((a) => a.ayah >= from && a.ayah <= to);
  return (
    <figure className="topic-quran">
      <blockquote className="quiz__quran">{ayahs.map((a) => `${a.text} ﴿${a.ayah.toLocaleString('ar-EG')}﴾`).join(' ')}</blockquote>
      <figcaption className="attribution">
        سُورَةُ {surah.info.nameAr} {from === to ? from.toLocaleString('ar-EG') : `${from.toLocaleString('ar-EG')}–${to.toLocaleString('ar-EG')}`}
      </figcaption>
    </figure>
  );
}
