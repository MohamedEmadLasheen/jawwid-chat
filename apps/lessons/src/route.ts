/** The paths the lessons site has always used (Chat's items store them): /lessons/quran/surah-N. */
export type Route = { kind: 'surah'; surah: number } | { kind: 'index' } | { kind: 'not-found' };

export function route(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { kind: 'index' };
  const m = /^\/lessons\/quran\/surah-(\d{1,3})$/.exec(path);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 114 && String(n) === m[1]) return { kind: 'surah', surah: n };
  }
  return { kind: 'not-found' };
}
