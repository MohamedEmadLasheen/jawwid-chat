import { describe, expect, it } from 'vitest';
import { route } from './route';

describe('route', () => {
  it('maps /lessons/quran/surah-N for 1..114 only', () => {
    expect(route('/lessons/quran/surah-85')).toEqual({ kind: 'surah', surah: 85 });
    expect(route('/lessons/quran/surah-1/')).toEqual({ kind: 'surah', surah: 1 });
    for (const bad of ['/lessons/quran/surah-0', '/lessons/quran/surah-115', '/lessons/quran/surah-085', '/x']) {
      expect(route(bad)).toEqual({ kind: 'not-found' });
    }
    expect(route('/')).toEqual({ kind: 'index' });
  });

  it('maps /lessons/arabic/lesson-1 and lesson-3, the Arabic lessons on the engine; the others are not found until built', () => {
    expect(route('/lessons/arabic/lesson-1')).toEqual({ kind: 'arabic', lesson: 1 });
    expect(route('/lessons/arabic/lesson-1/')).toEqual({ kind: 'arabic', lesson: 1 });
    expect(route('/lessons/arabic/lesson-3')).toEqual({ kind: 'arabic', lesson: 3 });
    expect(route('/lessons/arabic/lesson-2')).toEqual({ kind: 'arabic', lesson: 2 });
    expect(route('/lessons/arabic/lesson-6')).toEqual({ kind: 'arabic', lesson: 6 });
    for (const bad of ['/lessons/arabic/lesson-0', '/lessons/arabic/lesson-4', '/lessons/arabic/lesson-10', '/lessons/arabic/lesson-03', '/lessons/islamic/lesson-1']) {
      expect(route(bad)).toEqual({ kind: 'not-found' });
    }
  });
});
