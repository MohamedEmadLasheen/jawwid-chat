import { useEffect, useMemo, useState } from 'react';
import { AudioController, NO_AUDIO, type AudioSource } from '../audio/audio-controller';
import { loadSurah, type Fetcher, type Surah } from '../quran/dataset';
import { OrderAyat } from '../games/OrderAyat';
import { SectionHeader } from './SectionHeader';
import { StarLedger, type SectionId } from './stars';
import { Verses } from './Verses';

/**
 * One surah lesson, the same for all 114 (PD-29 materials quality P0-3): the
 * verified text, one audio controller, one section header, one star model. The
 * lesson's own content (meanings, tafsir lines, more games) arrives as reviewed
 * data in P0-4; the Quran text itself only ever comes from the dataset.
 */
export function SurahLesson({
  surah,
  fetcher,
  audioSource = NO_AUDIO,
}: {
  surah: number;
  fetcher?: Fetcher;
  audioSource?: AudioSource;
}) {
  const [state, setState] = useState<{ surah: Surah } | { error: string } | null>(null);
  const [section, setSection] = useState<SectionId>('listen');
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [, setStarsVersion] = useState(0);
  const stars = useMemo(() => new StarLedger(), [surah]);
  const audio = useMemo(() => new AudioController(audioSource), [audioSource, surah]);

  useEffect(() => {
    let live = true;
    setState(null);
    loadSurah(surah, fetcher).then(
      (s) => live && setState({ surah: s }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [surah, fetcher]);

  useEffect(() => {
    const off = audio.onChange((key) => setPlaying(key ? Number(key.split(':')[1]) : null));
    return () => {
      off();
      audio.dispose(); // the lesson closed: nothing keeps playing
    };
  }, [audio]);

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
  const select = (ayah: number) => {
    audio.select();
    setSelected(ayah);
  };
  const go = (s: SectionId) => {
    audio.stop();
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
      <SectionHeader current={section} done={(s) => stars.has(s)} onSelect={go} />

      {section === 'listen' ? (
        <section aria-label="الاستماع">
          {audio.available ? null : (
            <p className="note" role="note">
              التلاوة غير متاحة بعد.
            </p>
          )}
          <Verses ayahs={ayahs} selected={selected} playing={playing} onSelect={(a) => { select(a); audio.play(info.number, a); }} />
          <button type="button" className="primary" onClick={() => earn('listen')}>
            أنهيت الاستماع
          </button>
        </section>
      ) : null}

      {section === 'verses' ? (
        <section aria-label="الآيات">
          <Verses ayahs={ayahs} selected={selected} playing={playing} onSelect={select} />
          {selected !== null ? (
            <div className="verse-actions">
              <button type="button" disabled={!audio.available} onClick={() => audio.play(info.number, selected)}>
                استمع
              </button>
              <button type="button" disabled={!audio.available} onClick={() => audio.repeat(info.number, selected, 300)}>
                كرّر
              </button>
            </div>
          ) : null}
          <button type="button" className="primary" onClick={() => earn('verses')}>
            أنهيت الآيات
          </button>
        </section>
      ) : null}

      {section === 'order' ? <OrderAyat surah={info.number} ayahs={ayahs} onComplete={() => earn('order')} /> : null}

      <footer className="attribution">
        نص القرآن الكريم: <a href={state.surah.sourceUrl} rel="noreferrer">{state.surah.attribution}</a>
      </footer>
    </main>
  );
}
