import { useEffect, useState, type ReactNode } from 'react';

/**
 * The Quran font. Every verse is drawn in Amiri Quran (styles.css, --quran-font) and NEVER in a
 * fallback: a system font mis-shapes the Uthmani marks (the shadda and dagger alef of ٱللَّهُ came
 * out as a tanween, 2026-10-29). So nothing is shown until the browser reports that face loaded,
 * and if it cannot load, no verse is shown at all.
 */
export const QURAN_FONT = 'Amiri Quran';

/** A word that needs the font's marks: the shadda and dagger alef of the Name. */
const SAMPLE = 'ٱللَّهُ';

/** The browser's font set, as much of it as this needs (a test passes its own). */
export interface Fonts {
  load(font: string, text?: string): Promise<ArrayLike<{ family: string; status: string }>>;
  ready: Promise<unknown>;
}

const isQuranFace = (f: { family: string; status: string }) => f.family.replace(/["']/g, '') === QURAN_FONT && f.status === 'loaded';

/** True only when the browser has loaded Amiri Quran itself; anything else (no font set, an error, another face) is false. */
export async function loadQuranFont(fonts: Fonts | undefined = typeof document === 'undefined' ? undefined : document.fonts): Promise<boolean> {
  if (!fonts) return false;
  try {
    if (Array.from(await fonts.load(`32px "${QURAN_FONT}"`, SAMPLE)).some(isQuranFace)) return true;
    // The stylesheet that declares the face may still be arriving: once the set is ready, ask again.
    await fonts.ready;
    return Array.from(await fonts.load(`32px "${QURAN_FONT}"`, SAMPLE)).some(isQuranFace);
  } catch {
    return false;
  }
}

/** Shows its children only once the Quran font has loaded; until then a note, and if it fails, a refusal with no verse. */
export function QuranFontGate({ children, load = loadQuranFont }: { children: ReactNode; load?: () => Promise<boolean> }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    load().then(
      (ok) => live && setState(ok ? 'ready' : 'failed'),
      () => live && setState('failed'),
    );
    return () => {
      live = false;
    };
  }, [load]);
  if (state === 'ready') return <>{children}</>;
  return (
    <main className="lesson">
      {state === 'failed' ? (
        <p className="refused" role="alert">
          تعذّر تحميل خطّ المصحف، فلم تُعرض الآيات.
        </p>
      ) : (
        <p className="note" role="status">
          جارٍ تحميل خطّ المصحف…
        </p>
      )}
    </main>
  );
}
