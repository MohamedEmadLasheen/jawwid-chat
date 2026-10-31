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
    expect(route('/lessons/arabic/lesson-5')).toEqual({ kind: 'arabic', lesson: 5 });
    expect(route('/lessons/arabic/lesson-7')).toEqual({ kind: 'arabic', lesson: 7 });
    expect(route('/lessons/arabic/lesson-6')).toEqual({ kind: 'arabic', lesson: 6 });
    for (const bad of ['/lessons/arabic/lesson-0', '/lessons/arabic/lesson-4', '/lessons/arabic/lesson-10', '/lessons/arabic/lesson-03', '/lessons/islamic/lesson-1']) {
      expect(route(bad)).toEqual({ kind: 'not-found' });
    }
  });

  it('maps /lessons/islamic/lesson-N for the topic lessons on the engine only (batch 1)', () => {
    for (const n of [8, 9, 10, 11, 20]) expect(route(`/lessons/islamic/lesson-${n}`)).toEqual({ kind: 'islamic', lesson: n });
    expect(route('/lessons/islamic/lesson-20/')).toEqual({ kind: 'islamic', lesson: 20 });
    for (const bad of ['/lessons/islamic/lesson-1', '/lessons/islamic/lesson-12', '/lessons/islamic/lesson-08', '/lessons/islamic/lesson-200']) {
      expect(route(bad)).toEqual({ kind: 'not-found' });
    }
  });
});
