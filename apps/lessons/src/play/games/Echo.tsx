import { useEffect, useRef, useState } from 'react';
import { KNOBS } from '../adapt';
import { Beads, Praise, VerseCard, arabic, usePlaying, type GameProps, useCompleteOnce } from './common';

/**
 * Echo (ردّد معي): one ayah is recited, then it is the child's turn to repeat it
 * aloud. Nothing is recorded: a grown-up touches "repeated" when the child has
 * said it. Each ayah is echoed KNOBS.echoes times (3 for 3-5). Needs recitation.
 */
export function Echo({ surah, ayahs, audio, band, onComplete }: GameProps) {
  const echoes = KNOBS[band].echoes;
  const playing = usePlaying(audio);
  const [index, setIndex] = useState(0);
  const [reps, setReps] = useState(0);
  const [turn, setTurn] = useState(false);
  const started = useRef<string | null>(null);
  const ayah = ayahs[index];
  const done = index >= ayahs.length;

  // The recitation of this ayah ended: the child's turn.
  useEffect(() => {
    if (!ayah) return;
    const key = `${surah}:${ayah.ayah}`;
    if (playing === key) started.current = key;
    else if (playing === null && started.current === key) {
      started.current = null;
      setTurn(true);
    }
  }, [playing, surah, ayah]);

  useCompleteOnce(done, onComplete);

  if (done || !ayah) return <Praise />;

  const listen = () => {
    setTurn(false);
    audio?.play(surah, ayah.ayah);
  };
  const repeated = () => {
    setTurn(false);
    if (reps + 1 < echoes) setReps(reps + 1);
    else {
      setReps(0);
      setIndex(index + 1);
    }
  };

  return (
    <section className="play" aria-label="ردّد معي">
      <p className="play__ask">
        الآية {arabic(index + 1)} من {arabic(ayahs.length)}
      </p>
      <VerseCard ayah={ayah} shape={index} glow={playing === `${surah}:${ayah.ayah}`} onPress={listen} />
      {turn ? (
        <div className="play__turn">
          <p className="play__ask">والآن دورنا: نردّد الآية معًا</p>
          <button type="button" className="primary play__big" onClick={repeated}>
            ✓ ردّدناها
          </button>
        </div>
      ) : (
        <button type="button" className="primary play__big" onClick={listen}>
          🔊 لنستمع
        </button>
      )}
      <Beads done={reps} total={echoes} label="مرات الترديد" />
    </section>
  );
}
