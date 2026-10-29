import { useEffect, useMemo, useState } from 'react';
import { AudioController, NO_AUDIO, htmlAudio, type AudioFactory, type AudioSource } from '../audio/audio-controller';
import { APPROVAL_KEYS, type ApprovalKey, type Band } from '../content/quran-content';
import { BUILD_ANCHOR, loadSurah, type Fetcher, type QuranAnchor, type Surah } from '../quran/dataset';
import { segmentsFor } from './adapt';
import { MECHANICS, approvedMechanics, type Mechanic } from './mechanics';
import { buildSession, seedOf, sessionSeed, today, type Activity } from './session';
import { CountAyat } from './games/CountAyat';
import { Echo } from './games/Echo';
import { ListenGlow } from './games/ListenGlow';
import { WhichHeard } from './games/WhichHeard';
import { Praise, arabic, type GameProps } from './games/common';

export const GAMES: Readonly<Record<string, (p: GameProps) => JSX.Element>> = {
  listen_glow: ListenGlow,
  echo: Echo,
  which_heard: WhichHeard,
  count_ayat: CountAyat,
};

/** How long a sitting waits for the recitation list before it starts without it. */
export const AUDIO_WAIT_MS = 2000;

/** Verse sizes the grown-up can choose (plan §C.4). */
const SCALES = [1, 1.25, 1.5, 1.75] as const;

/** One segment's sitting, built once and then frozen: nothing arriving later changes it under the child. */
interface Sitting {
  key: string;
  seed: number;
  activities: Activity[];
  audio: boolean;
}

/**
 * PD-49: a sitting of games for one surah (plan §B, §C). It plays only the
 * mechanics a teacher and the scholar signed (mechanics.ts) and that have a game
 * here; none is signed yet, so a child sees "the games are under review" and
 * nothing else. The session is built for the band and the surah's length
 * (session.ts), a segment at a time.
 *
 * Recitation arrives as in the lesson (the release gate). The sitting waits for
 * it up to AUDIO_WAIT_MS, then is built and FROZEN for its segment: a list that
 * arrives later is used from the next segment on. A segment gets the mechanics
 * that need recitation only when every one of its ayat has a file.
 *
 * The grown-up can always replay, skip forward or stop (plan §C.3.4), turn the
 * recitation off (the sitting restarts without it: there is no other sound to
 * mute) and change the verse size (§C.4).
 */
export function PlayLesson({
  surah,
  band = '3-5',
  fetcher,
  anchor = BUILD_ANCHOR,
  audioSource = NO_AUDIO,
  audioFactory = htmlAudio,
  approvals,
  approvalKeys = APPROVAL_KEYS,
  mechanics = MECHANICS,
  date,
  audioWaitMs = AUDIO_WAIT_MS,
}: {
  surah: number;
  band?: Band;
  fetcher?: Fetcher;
  anchor?: QuranAnchor | null;
  audioSource?: AudioSource;
  audioFactory?: AudioFactory;
  /** The signed mechanics (approvals/play.json by default), and the keys that may sign them. */
  approvals?: unknown;
  approvalKeys?: readonly ApprovalKey[];
  mechanics?: readonly Mechanic[];
  /** The day the sitting is for (YYYY-MM-DD); today by default. */
  date?: string;
  audioWaitMs?: number;
}) {
  const [loaded, setLoaded] = useState<Surah | 'refused' | null>(null);
  const [approved, setApproved] = useState<ReadonlySet<string> | null>(null);
  const [audio, setAudio] = useState<AudioController | null>(null);
  const [waited, setWaited] = useState(false);
  const [segment, setSegment] = useState(0);
  const [step, setStep] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [muted, setMuted] = useState(false);
  const [scale, setScale] = useState(0);
  const [sitting, setSitting] = useState<Sitting | null>(null);
  const [day] = useState(() => date ?? today());

  useEffect(() => {
    let live = true;
    loadSurah(surah, fetcher, anchor).then(
      (s) => live && setLoaded(s),
      () => live && setLoaded('refused'),
    );
    approvedMechanics(mechanics, approvals, undefined, approvalKeys).then((a) => live && setApproved(a));
    return () => {
      live = false;
    };
  }, [surah, fetcher, anchor, mechanics, approvals, approvalKeys]);

  useEffect(() => {
    const controller = new AudioController(audioSource, audioFactory);
    setAudio(controller);
    return () => controller.dispose();
  }, [audioSource, audioFactory]);

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), audioWaitMs);
    return () => clearTimeout(t);
  }, [audioWaitMs]);

  const s = loaded && loaded !== 'refused' ? loaded : null;
  const surahAudio = !!s && !!audio?.availableFor(s.info.number);
  const segments = useMemo(() => (s ? segmentsFor(band, s.ayahs.length) : []), [s, band]);
  const playable = useMemo(() => mechanics.filter((m) => GAMES[m.id] !== undefined), [mechanics]);
  const seg = segments[segment];
  const key = `${segment}:${muted}`;

  // Build this segment's sitting once: after the recitation list came, or the wait ran out.
  if (s && seg && approved && (surahAudio || waited) && sitting?.key !== key) {
    const segAudio = !muted && surahAudio && s.ayahs.every((a) => a.ayah < seg[0] || a.ayah > seg[1] || audio!.has(s.info.number, a.ayah));
    const seed = sessionSeed({ surah: s.info.number, segment, band, date: day });
    const activities = buildSession(playable, {
      band,
      ayahCount: s.ayahs.length,
      segment: seg,
      audio: segAudio,
      approved,
      seed,
      last: sitting?.activities[sitting.activities.length - 1]?.mechanic,
    });
    setSitting({ key, seed, activities, audio: segAudio });
  }

  if (loaded === 'refused' || (loaded !== null && !s)) {
    return (
      <main className="lesson">
        <p className="refused" role="alert">تعذّر التحقق من نص السورة، فلم يُعرض شيء منه.</p>
      </main>
    );
  }
  if (!s || approved === null) return <p className="note" role="status">جارٍ التحميل…</p>;

  const header = <h1 className="play__title">ألعاب سورة {s.info.nameAr}</h1>;
  if (approved.size === 0) {
    return (
      <main className="lesson">
        {header}
        <p className="note">الألعاب قيد المراجعة: لا تظهر لعبة قبل أن يعتمدها المعلم والمراجع الشرعي.</p>
      </main>
    );
  }
  if (!sitting || sitting.key !== key) {
    return (
      <main className="lesson">
        {header}
        <p className="note" role="status">
          جارٍ تجهيز الألعاب…
        </p>
      </main>
    );
  }

  const session = sitting.activities;
  const nextSegment = () => {
    audio?.stop();
    setSegment((segment + 1) % segments.length);
    setStep(0);
  };
  const nextButton =
    segments.length > 1 ? (
      <button type="button" className="primary play__big" onClick={nextSegment}>
        الآيات التالية ←
      </button>
    ) : null;

  if (session.length === 0) {
    return (
      <main className="lesson">
        {header}
        <p className="note">لا توجد لعبة لهذه الآيات بعد.</p>
        {nextButton}
      </main>
    );
  }

  const activity = session[step];
  const ayahs = activity ? s.ayahs.filter((a) => a.ayah >= activity.from && a.ayah <= activity.to) : [];
  const Game = activity ? GAMES[activity.mechanic] : undefined;
  const live = !!activity && !!Game && !stopped;
  const advance = () => {
    audio?.stop();
    setAttempt(0);
    setStep((x) => x + 1);
  };

  return (
    <main className="lesson" style={{ ['--verse-scale' as string]: SCALES[scale] }}>
      {header}
      <p className="note">
        الآيات {arabic(seg![0])}–{arabic(seg![1])} · اللعبة {arabic(Math.min(step + 1, session.length))} من {arabic(session.length)}
      </p>
      <nav className="play__grownup" aria-label="أدوات الكبير">
        {live ? (
          <>
            <button type="button" onClick={() => (audio?.stop(), setAttempt(attempt + 1))}>
              ↻ أعد اللعبة
            </button>
            <button type="button" onClick={advance}>
              ⏭ تخطَّ اللعبة
            </button>
            <button type="button" onClick={() => (audio?.stop(), setStopped(true))}>
              ■ أوقف
            </button>
          </>
        ) : null}
        {surahAudio ? (
          <button type="button" aria-pressed={muted} onClick={() => (audio?.stop(), setMuted(!muted), setStep(0), setAttempt(0))}>
            {muted ? '🔊 شغّل التلاوة' : '🔇 بلا تلاوة'}
          </button>
        ) : null}
        <button type="button" disabled={scale === 0} onClick={() => setScale(scale - 1)}>
          أ− تصغير الآيات
        </button>
        <button type="button" disabled={scale === SCALES.length - 1} onClick={() => setScale(scale + 1)}>
          أ+ تكبير الآيات
        </button>
      </nav>
      {stopped ? (
        <>
          <p className="note" role="status">
            توقّفت الألعاب.
          </p>
          <button type="button" className="primary play__big" onClick={() => setStopped(false)}>
            تابع
          </button>
        </>
      ) : activity && Game ? (
        <Game
          key={`${segment}:${muted}:${step}:${attempt}`}
          surah={s.info.number}
          ayahs={ayahs}
          pool={s.ayahs}
          audio={sitting.audio ? audio : null}
          band={band}
          seed={seedOf([sitting.seed, step, attempt])}
          onComplete={() => setTimeout(advance, 0)}
        />
      ) : (
        <>
          <Praise text="أحسنت! انتهت ألعاب هذه الآيات" />
          {nextButton}
        </>
      )}
    </main>
  );
}
