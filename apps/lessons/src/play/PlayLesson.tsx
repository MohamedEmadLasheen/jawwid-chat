import { useEffect, useMemo, useState } from 'react';
import { AudioController, NO_AUDIO, htmlAudio, type AudioFactory, type AudioSource } from '../audio/audio-controller';
import type { Band } from '../content/quran-content';
import { visitSeed } from '../games/shuffle';
import { BUILD_ANCHOR, loadSurah, type Fetcher, type QuranAnchor, type Surah } from '../quran/dataset';
import { segmentsFor } from './adapt';
import { MECHANICS, approvedMechanics, type Mechanic } from './mechanics';
import { buildSession } from './session';
import { CountAyat } from './games/CountAyat';
import { Echo } from './games/Echo';
import { ListenGlow } from './games/ListenGlow';
import { WhichHeard } from './games/WhichHeard';
import { Praise, arabic, type GameProps } from './games/common';

const GAMES: Readonly<Record<string, (p: GameProps) => JSX.Element>> = {
  listen_glow: ListenGlow,
  echo: Echo,
  which_heard: WhichHeard,
  count_ayat: CountAyat,
};

/**
 * PD-49: a sitting of games for one surah (plan §B, §C). It plays only the
 * mechanics a teacher and the scholar signed (mechanics.ts); none is signed yet,
 * so a child sees "the games are under review" and nothing else. The session
 * is built for the band and the surah's length (session.ts), a segment at a time.
 * Recitation arrives as in the lesson (the release gate); without it, only the
 * mechanics that work without recitation are offered.
 */
export function PlayLesson({
  surah,
  band = '3-5',
  fetcher,
  anchor = BUILD_ANCHOR,
  audioSource = NO_AUDIO,
  audioFactory = htmlAudio,
  approvals,
  mechanics = MECHANICS,
  seed,
}: {
  surah: number;
  band?: Band;
  fetcher?: Fetcher;
  anchor?: QuranAnchor | null;
  audioSource?: AudioSource;
  audioFactory?: AudioFactory;
  /** The signed mechanics (approvals/play.json by default). */
  approvals?: unknown;
  mechanics?: readonly Mechanic[];
  seed?: number;
}) {
  const [loaded, setLoaded] = useState<Surah | 'refused' | null>(null);
  const [approved, setApproved] = useState<ReadonlySet<string> | null>(null);
  const [audio, setAudio] = useState<AudioController | null>(null);
  const [segment, setSegment] = useState(0);
  const [step, setStep] = useState(0);
  const [visit] = useState(() => seed ?? visitSeed());

  useEffect(() => {
    let live = true;
    loadSurah(surah, fetcher, anchor).then(
      (s) => live && setLoaded(s),
      () => live && setLoaded('refused'),
    );
    approvedMechanics(mechanics, approvals).then((a) => live && setApproved(a));
    return () => {
      live = false;
    };
  }, [surah, fetcher, anchor, mechanics, approvals]);

  useEffect(() => {
    const controller = new AudioController(audioSource, audioFactory);
    setAudio(controller);
    return () => controller.dispose();
  }, [audioSource, audioFactory]);

  const s = loaded && loaded !== 'refused' ? loaded : null;
  const hasAudio = !!s && !!audio?.availableFor(s.info.number);
  const segments = useMemo(() => (s ? segmentsFor(band, s.ayahs.length) : []), [s, band]);
  const seg = segments[segment];
  const session = useMemo(
    () =>
      s && seg && approved
        ? buildSession(mechanics, { band, ayahCount: s.ayahs.length, segment: seg, audio: hasAudio, approved, seed: visit + segment })
        : [],
    [s, seg, approved, mechanics, band, hasAudio, visit, segment],
  );

  if (loaded === null || approved === null) return <p className="note" role="status">جارٍ التحميل…</p>;
  if (loaded === 'refused' || !s) {
    return (
      <main className="lesson">
        <p className="refused" role="alert">تعذّر التحقق من نص السورة، فلم يُعرض شيء منه.</p>
      </main>
    );
  }

  const header = <h1 className="play__title">ألعاب سورة {s.info.nameAr}</h1>;
  if (approved.size === 0) {
    return (
      <main className="lesson">
        {header}
        <p className="note">الألعاب قيد المراجعة: لا تظهر لعبة قبل أن يعتمدها المعلم والمراجع الشرعي.</p>
      </main>
    );
  }
  if (session.length === 0) {
    return (
      <main className="lesson">
        {header}
        <p className="note">لا توجد لعبة لهذه السورة بعد.</p>
      </main>
    );
  }

  const activity = session[step];
  const ayahs = activity ? s.ayahs.filter((a) => a.ayah >= activity.from && a.ayah <= activity.to) : [];
  const Game = activity ? GAMES[activity.mechanic] : undefined;
  const nextSegment = () => {
    audio?.stop();
    setSegment((segment + 1) % segments.length);
    setStep(0);
  };

  return (
    <main className="lesson">
      {header}
      <p className="note">
        الآيات {arabic(seg![0])}–{arabic(seg![1])} · اللعبة {arabic(Math.min(step + 1, session.length))} من {arabic(session.length)}
      </p>
      {activity && Game ? (
        <Game
          key={`${segment}:${step}`}
          surah={s.info.number}
          // count_ayat counts the whole (short) surah; the others play the segment.
          ayahs={activity.mechanic === 'count_ayat' ? s.ayahs : ayahs}
          pool={s.ayahs}
          audio={hasAudio ? audio : null}
          band={band}
          seed={visit + segment * 31 + step}
          onComplete={() => setTimeout(() => setStep((x) => x + 1), 0)}
        />
      ) : (
        <>
          <Praise text="أحسنت! انتهت ألعاب هذه الآيات" />
          {segments.length > 1 ? (
            <button type="button" className="primary play__big" onClick={nextSegment}>
              الآيات التالية ←
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}
