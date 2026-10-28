import { useMemo } from 'react';
import { route } from './route';
import { SurahLesson } from './lesson/SurahLesson';
import { ArabicLesson } from './arabic/ArabicLesson';
import { NO_AUDIO } from './audio/audio-controller';
import { manifestSource, useAudioManifest, verifiedAudio } from './audio/audio-manifest';

/** A surah's lesson, with recitation only if the opener handed over an audio list the API let this account have. */
function Lesson({ surah }: { surah: number }) {
  const manifest = useAudioManifest(surah);
  const audio = useMemo(() => (manifest ? { source: manifestSource(manifest), factory: verifiedAudio(manifest) } : null), [manifest]);
  return <SurahLesson surah={surah} audioSource={audio?.source ?? NO_AUDIO} audioFactory={audio?.factory} />;
}

export function App({ pathname = window.location.pathname }: { pathname?: string }) {
  const r = route(pathname);
  if (r.kind === 'surah') return <Lesson surah={r.surah} />;
  if (r.kind === 'arabic') return <ArabicLesson lesson={r.lesson} />;
  if (r.kind === 'index') {
    return (
      <main className="lesson">
        <h1>دروس جوّد</h1>
        <p className="note">تُفتح الدروس من تطبيق جوّد.</p>
      </main>
    );
  }
  return (
    <main className="lesson">
      <p className="refused" role="alert">
        هذا الدرس غير موجود.
      </p>
    </main>
  );
}
