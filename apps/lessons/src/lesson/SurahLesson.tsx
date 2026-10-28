import { useEffect, useMemo, useState } from 'react';
import { AudioController, NO_AUDIO, htmlAudio, type AudioFactory, type AudioSource } from '../audio/audio-controller';
import { BUILD_ANCHOR, loadSurah, type Fetcher, type QuranAnchor, type Surah } from '../quran/dataset';
import { OrderAyat } from '../games/OrderAyat';
import { CompleteAyah } from '../games/CompleteAyah';
import { Quiz } from '../games/Quiz';
import { contentFor } from '../content';
import { resolveContent, type ResolvedContent } from '../content/lesson-content';
import { Benefits } from './Benefits';
import { SectionHeader } from './SectionHeader';
import { CONTENT_SECTIONS, QURAN_SECTIONS, StarLedger, type SectionId } from './stars';
import { Verses } from './Verses';

/**
 * One surah lesson, the same for all 114 (PD-29 materials quality P0-3): the
 * verified text, one audio controller, one section header, one star model.
 * A surah with reviewed content (src/content/, P0-4) adds its tafsir, word
 * meanings, games, quiz and lessons learned; content that does not resolve
 * against the verified text is refused whole, and the Quran sections remain.
 * The Quran text itself only ever comes from the dataset.
 * The listening star needs an ayah actually played, so while recitation is
 * off (until the owner confirms the rights) it cannot be earned.
 */
export function SurahLesson({
  surah,
  fetcher,
  anchor = BUILD_ANCHOR,
  audioSource = NO_AUDIO,
  audioFactory = htmlAudio,
  shuffleSeed,
  content,
}: {
  surah: number;
  fetcher?: Fetcher;
  anchor?: QuranAnchor | null;
  audioSource?: AudioSource;
  audioFactory?: AudioFactory;
  shuffleSeed?: number;
  /** The reviewed content; defaults to src/content/ for this surah. null: none. */
  content?: unknown;
}) {
  const raw = content === undefined ? contentFor(surah) : content;
  const [state, setState] = useState<{ surah: Surah } | { error: string } | null>(null);
  const [section, setSection] = useState<SectionId>('listen');
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [heard, setHeard] = useState(false);
  const [audio, setAudio] = useState<AudioController | null>(null);
  const [, setStarsVersion] = useState(0);
  const loaded = state && 'surah' in state ? state.surah : null;
  // undefined: this surah has no content; null: it has content that did not resolve (refused).
  const resolved: ResolvedContent | null | undefined = useMemo(
    () => (raw === null ? undefined : loaded ? resolveContent(raw, loaded) : undefined),
    [raw, loaded],
  );
  const sections = resolved ? CONTENT_SECTIONS : QURAN_SECTIONS;
  const stars = useMemo(() => new StarLedger(sections), [surah, sections]);

  useEffect(() => {
    let live = true;
    setState(null);
    loadSurah(surah, fetcher, anchor).then(
      (s) => live && setState({ surah: s }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [surah, fetcher, anchor]);

  // The controller is created by the effect that disposes it, so StrictMode's
  // mount -> unmount -> mount leaves exactly one live controller, never a
  // disposed one in use.
  useEffect(() => {
    const controller = new AudioController(audioSource, audioFactory);
    const off = controller.onChange((key) => {
      setPlaying(key ? Number(key.split(':')[1]) : null);
      if (key) setHeard(true);
    });
    setAudio(controller);
    setHeard(false);
    return () => {
      off();
      controller.dispose(); // the lesson closed: nothing keeps playing
    };
  }, [audioSource, audioFactory, surah]);

  const earn = (s: SectionId) => {
    if (stars.award(s)) setStarsVersion((v) => v + 1);
  };

  if (state === null) return <p className="note" role="status">جارٍ التحميل…</p>;
  if ('error' in state) {
    return (
      <main className="lesson">
        <p className="refused" role="alert">
          تعذّر التحقق من نص السورة، فلم يُعرض شيء منه.
        </p>
      </main>
    );
  }

  const { info, ayahs } = state.surah;
  const available = audio?.available ?? false;
  const select = (ayah: number) => {
    audio?.select();
    setSelected(ayah);
  };
  const go = (s: SectionId) => {
    audio?.stop();
    setSection(s);
  };

  return (
    <main className="lesson">
      <header className="lesson__head">
        <h1>سورة {info.nameAr}</h1>
        <p className="lesson__stars" aria-label="النجوم">
          {'★'.repeat(stars.total)}
          {'☆'.repeat(stars.max - stars.total)}
        </p>
      </header>
      {resolved?.intro ? <p className="intro">{resolved.intro}</p> : null}
      {resolved === null ? (
        <p className="note">محتوى الدرس قيد المراجعة، فعُرض نص السورة وحده.</p>
      ) : null}
      <SectionHeader sections={sections} current={section} done={(s) => stars.has(s)} onSelect={go} />

      {section === 'listen' ? (
        <section aria-label="الاستماع">
          {available ? null : (
            <p className="note" role="note">
              التلاوة غير متاحة بعد.
            </p>
          )}
          <Verses ayahs={ayahs} selected={selected} playing={playing} onSelect={(a) => { select(a); audio?.play(info.number, a); }} />
          <button type="button" className="primary" disabled={!heard} onClick={() => earn('listen')}>
            أنهيت الاستماع
          </button>
        </section>
      ) : null}

      {section === 'verses' ? (
        <section aria-label="الآيات">
          <Verses ayahs={ayahs} selected={selected} playing={playing} onSelect={select} />
          {selected !== null ? (
            <div className="verse-actions">
              <button type="button" disabled={!available} onClick={() => audio?.play(info.number, selected)}>
                استمع
              </button>
              <button type="button" disabled={!available} onClick={() => audio?.repeat(info.number, selected, 300)}>
                كرّر
              </button>
            </div>
          ) : null}
          {selected !== null && resolved ? (
            <p className="tafsir" data-testid="tafsir">
              {resolved.tafsir.get(selected) ?? 'شرح هذه الآية قيد المراجعة.'}
            </p>
          ) : null}
          <button type="button" className="primary" onClick={() => earn('verses')}>
            أنهيت الآيات
          </button>
        </section>
      ) : null}

      {section === 'meanings' && resolved ? (
        <section aria-label="المعاني">
          <ul className="meanings">
            {resolved.words.map((w) => (
              <li key={`${w.ayah}:${w.text}`}>
                <span className="meanings__word">{w.text}</span>
                <span className="meanings__meaning">{w.meaning}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="primary" onClick={() => earn('meanings')}>
            أنهيت المعاني
          </button>
        </section>
      ) : null}

      {section === 'complete' && resolved ? (
        <CompleteAyah ayahs={ayahs} items={resolved.complete} seed={shuffleSeed} onComplete={() => earn('complete')} />
      ) : null}

      {section === 'order' ? <OrderAyat ayahs={ayahs} seed={shuffleSeed} onComplete={() => earn('order')} /> : null}

      {section === 'quiz' && resolved ? <Quiz quiz={resolved.quiz} seed={shuffleSeed} onComplete={() => earn('quiz')} /> : null}

      {section === 'benefits' && resolved ? <Benefits content={resolved} onDone={() => earn('benefits')} /> : null}

      <footer className="attribution">
        نص القرآن الكريم: <a href={state.surah.sourceUrl} rel="noreferrer">{state.surah.attribution}</a>
      </footer>
    </main>
  );
}
