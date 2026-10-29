import { useEffect, useState } from 'react';
import { Beads, Praise, VerseCard, usePlaying, type GameProps, useCompleteOnce } from './common';

/**
 * Listen & Glow (اسمع والمس), 3-5: each ayah is a big card; touching it plays
 * that ayah, and its frame glows while it is recited. A bead fills for each ayah
 * heard; when every ayah has been heard once, the game is done. Needs recitation.
 */
export function ListenGlow({ surah, ayahs, audio, onComplete }: GameProps) {
  const playing = usePlaying(audio);
  const [heard, setHeard] = useState<ReadonlySet<number>>(new Set());
  const done = heard.size === ayahs.length;

  useEffect(() => {
    const n = playing ? Number(playing.split(':')[1]) : null;
    if (n !== null && ayahs.some((a) => a.ayah === n) && !heard.has(n)) setHeard(new Set([...heard, n]));
  }, [playing, ayahs, heard]);

  useCompleteOnce(done, onComplete);

  return (
    <section className="play" aria-label="اسمع والمس">
      <p className="play__ask">لنلمس الآية ونسمعها</p>
      <div className="play-cards">
        {ayahs.map((a, i) => (
          <VerseCard key={a.ayah} ayah={a} shape={i} glow={playing === `${surah}:${a.ayah}`} onPress={() => audio?.play(surah, a.ayah)} />
        ))}
      </div>
      <Beads done={heard.size} total={ayahs.length} label="الآيات التي سمعتها" />
      {done ? <Praise /> : null}
    </section>
  );
}
