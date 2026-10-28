import { route } from './route';
import { SurahLesson } from './lesson/SurahLesson';

export function App({ pathname = window.location.pathname }: { pathname?: string }) {
  const r = route(pathname);
  if (r.kind === 'surah') return <SurahLesson surah={r.surah} />;
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
