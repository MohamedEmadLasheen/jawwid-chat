/**
 * The Arabic lessons' content files, by lesson number. Each is checked in CI
 * (scripts/lessons/check-arabic-lesson.py) and again in the browser
 * (arabic-lesson.ts), and shows nothing until the Teachers department approved
 * it. Lesson 1 is the letters (P0-5) and lesson 3 the harakat, both pending the
 * Teachers department's review. Lesson 4: reading with the harakat; lesson 5: reading
 * sentences (both reading lessons, P0-5c); lesson 6: the sukun; lesson 7: the madd; pending too.
 */
import letters from './lesson-001.json';
import harakat from './lesson-003.json';
import harakatReading from './lesson-004.json';
import reading5 from './lesson-005.json';
import sukun from './lesson-006.json';
import madd from './lesson-007.json';

const CONTENT: Record<number, unknown> = { 1: letters, 3: harakat, 4: harakatReading, 5: reading5, 6: sukun, 7: madd };

export function arabicLessonFor(lesson: number): unknown {
  return CONTENT[lesson] ?? null;
}
