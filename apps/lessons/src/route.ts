/** The paths the lessons site has always used (Chat's items store them): /lessons/quran/surah-N, /lessons/arabic/lesson-N. */
export type Route =
  | { kind: 'surah'; surah: number }
  | { kind: 'play'; surah: number }
  | { kind: 'arabic'; lesson: number }
  | { kind: 'index' }
  | { kind: 'not-found' };

export const ARABIC_LESSONS: readonly number[] = [1, 2, 3];

export function route(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { kind: 'index' };
  const m = /^\/lessons\/quran\/surah-(\d{1,3})(\/play)?$/.exec(path);
  if (m) {
    const n = Number(m[1]);
    // PD-49: the surah's games, at /lessons/quran/surah-N/play.
    if (n >= 1 && n <= 114 && String(n) === m[1]) return m[2] ? { kind: 'play', surah: n } : { kind: 'surah', surah: n };
  }
  // The Arabic lessons that exist on the engine: lessons 1, 2 and 3 (P0-5). The others answer
  // "not found" until each is built (pd029-p05-arabic-letters-design.md §2).
  const a = /^\/lessons\/arabic\/lesson-(\d{1,2})$/.exec(path);
  if (a && ARABIC_LESSONS.includes(Number(a[1])) && String(Number(a[1])) === a[1]) return { kind: 'arabic', lesson: Number(a[1]) };
  return { kind: 'not-found' };
}
