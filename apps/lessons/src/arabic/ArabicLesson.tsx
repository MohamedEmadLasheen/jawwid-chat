import { useMemo, useState } from 'react';
import { Quiz } from '../games/Quiz';
import { SectionHeader } from '../lesson/SectionHeader';
import { StarLedger } from '../lesson/stars';
import { arabicLessonFor } from './index';
import { resolveArabicLesson, type ResolvedUnit } from './arabic-lesson';
import { FindLetter } from './FindLetter';
import { clusters, POSITIONS } from './letters';
import { PickWords } from './PickWords';
import { POSITION_LABEL, TEXT } from './ui-text';
import { useVoice, type Voice } from './voice';

export type LettersSection = 'letters' | 'find' | 'pick' | 'quiz';
export const LETTERS_SECTIONS: readonly LettersSection[] = ['letters', 'find', 'pick', 'quiz'];
const LABELS: Record<LettersSection, string> = { letters: 'الْحُرُوفُ', find: 'اِبْحَثْ عَنِ الْحَرْفِ', pick: 'اِخْتَرِ الْكَلِمَاتِ', quiz: 'الِاخْتِبَارُ' };

/** A word with its unit's letter picked out, by the one rule. */
function Word({ text, unit }: { text: string; unit: ResolvedUnit }) {
  return (
    <span className="letters-example">
      {clusters(text, unit).map((p, i) => (p.target ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/** PD-48: a play button, only for a string that has a verified clip. */
function Listen({ id, voice }: { id: string; voice: Voice }) {
  if (!voice.has(id)) return null;
  return (
    <button type="button" className="voice" aria-label={TEXT.listen} aria-pressed={voice.playing === id} onClick={() => voice.play(id)}>
      🔊
    </button>
  );
}

/**
 * An Arabic letters lesson (PD-29 P0-5). Nothing of its content is shown until
 * the Teachers department approved the file; a file that fails a proof
 * (arabic-lesson.ts) is refused whole.
 */
export function ArabicLesson({ lesson, content, shuffleSeed }: { lesson: number; content?: unknown; shuffleSeed?: number }) {
  const raw = content === undefined ? arabicLessonFor(lesson) : content;
  const resolved = useMemo(() => (raw === null ? undefined : resolveArabicLesson(raw, lesson)), [raw, lesson]);
  const stars = useMemo(() => new StarLedger<LettersSection>(LETTERS_SECTIONS), [lesson]);
  const [section, setSection] = useState<LettersSection>('letters');
  const [unitId, setUnitId] = useState<string | null>(null);
  const [, setStarsVersion] = useState(0);
  // PD-48: the text of every string this build SHOWS, by id -- what a clip's textSha256 must match.
  const texts = useMemo(() => {
    const m = new Map<string, string>();
    if (resolved && resolved.approved) {
      for (const u of resolved.units) {
        m.set(`${u.id}.name`, u.name);
        if (u.note) m.set(u.note.id, u.note.text);
        for (const w of u.words) m.set(w.id, w.text);
      }
    }
    return m;
  }, [resolved]);
  const voice = useVoice(lesson, texts);
  const earn = (s: LettersSection) => {
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

  const units = resolved.units.filter((u) => u.words.length > 0);
  const unit = units.find((u) => u.id === unitId) ?? units[0];
  const words = unit ? unit.words.map((w) => w.text) : [];
  const others = unit ? units.filter((u) => u.id !== unit.id).flatMap((u) => u.words.map((w) => w.text)) : [];
  // The quiz runs one unit at a time, as the old lesson's did (34 units would be one endless quiz).
  const unitQuiz = unit ? resolved.quiz.filter((q) => q.unit === unit.id) : [];

  return (
    <main className="lesson">
      <header className="lesson__head">
        <h1>الْحُرُوفُ</h1>
        <p className="lesson__stars" aria-label="النجوم">
          {'★'.repeat(stars.total)}
          {'☆'.repeat(stars.max - stars.total)}
        </p>
      </header>
      <SectionHeader sections={LETTERS_SECTIONS} current={section} done={(s) => stars.has(s)} onSelect={setSection} labels={LABELS} />

      {unit ? (
        <nav className="letters-units" aria-label="الحروف">
          {units.map((u) => (
            <button key={u.id} type="button" className={u.id === unit.id ? 'section section--current' : 'section'} aria-current={u.id === unit.id ? 'true' : undefined} onClick={() => setUnitId(u.id)}>
              {u.forms[0] ?? u.name}
            </button>
          ))}
        </nav>
      ) : null}

      {section === 'letters' && unit ? (
        <section aria-label={unit.name}>
          <h2>
            {unit.name}
            <Listen id={`${unit.id}.name`} voice={voice} />
          </h2>
          <p className="note">{TEXT.forms}</p>
          <p className="letters-forms">{unit.forms.join('  ')}</p>
          {unit.note ? (
            <p className="intro">
              {unit.note.text}
              <Listen id={unit.note.id} voice={voice} />
            </p>
          ) : null}
          {POSITIONS.map((p) => {
            const at = unit.words.filter((w) => w.positions.includes(p));
            return at.length ? (
              <div key={p} data-testid={`examples-${p}`}>
                <h3>{POSITION_LABEL[p]}</h3>
                <ul className="letters-examples">
                  {at.map((w) => (
                    <li key={w.id}>
                      <Word text={w.text} unit={unit} />
                      <Listen id={w.id} voice={voice} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })}
          <button type="button" className="primary" onClick={() => earn('letters')}>
            {TEXT.done}
          </button>
        </section>
      ) : null}

      {section === 'find' && unit ? <FindLetter key={unit.id} unit={unit} name={unit.name} words={words.slice(0, 5)} onComplete={() => earn('find')} /> : null}

      {section === 'pick' && unit ? (
        <PickWords key={unit.id} unit={unit} name={unit.name} withLetter={words} others={others} seed={shuffleSeed} onComplete={() => earn('pick')} />
      ) : null}

      {section === 'quiz' && unit && unitQuiz.length ? <Quiz key={unit.id} quiz={unitQuiz} seed={shuffleSeed} onComplete={() => earn('quiz')} /> : null}
    </main>
  );
}
