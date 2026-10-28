import { useState } from 'react';
import { Beads, Praise, VerseCard, arabic, type GameProps, useCompleteOnce } from './common';

/**
 * Count the ayat (عُدّ الآيات), 3-5, short surahs: the ayat are shown whole and
 * in order; the next one to count is lit by its frame. A grown-up reads it to
 * the child -- or, where recitation is allowed, touching it plays it -- and the
 * child touches it to count. Touching another card does nothing (no penalty).
 * Works without recitation.
 */
export function CountAyat({ surah, ayahs, audio, onComplete }: GameProps) {
  const [count, setCount] = useState(0);
  const done = count >= ayahs.length;

  useCompleteOnce(done, onComplete);

  const touch = (index: number) => {
    if (index !== count) return;
    audio?.play(surah, ayahs[index]!.ayah);
    setCount(count + 1);
  };

  return (
    <section className="play" aria-label="عُدّ الآيات">
      <p className="play__ask">{audio ? 'المس الآية المضيئة لتسمعها وتعدّها' : 'يقرأ لك الكبير الآية المضيئة، ثم المسها لتعدّها'}</p>
      <div className="play-cards">
        {ayahs.map((a, i) => (
          <VerseCard key={a.ayah} ayah={a} shape={i} glow={i === count} onPress={() => touch(i)} />
        ))}
      </div>
      <Beads done={count} total={ayahs.length} label="الآيات التي عددتها" />
      {done ? <Praise text={`أحسنت! عددها ${arabic(ayahs.length)} آيات`} /> : null}
    </section>
  );
}
