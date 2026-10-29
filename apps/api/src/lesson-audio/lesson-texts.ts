import { createHash } from 'node:crypto';
import arabic001 from './texts/arabic-001.json';
import { LESSON_KEY, SHA256, STRING_ID } from './lesson-audio-key';

/**
 * PD-48: the approved text of every lesson string a clip may be made for --
 * "the current text" (design §7.3). The files in ./texts are GENERATED from
 * apps/lessons by scripts/lessons/lesson-audio-texts.py, and CI fails while
 * one is stale (guards.sh lessons-supply-chain). A clip is served only while
 * its text_sha256 equals the hash here: change a word, and its audio is off.
 *
 * Fail closed: a file whose entry does not hash to its own text, or that is
 * malformed, is no lesson at all (no audio is served for it).
 */
export interface LessonString {
  id: string;
  kind: 'name' | 'word' | 'note';
  text: string;
  sha256: string;
}

export interface LessonText {
  lesson: string;
  /** The Teachers department approved the lesson file itself (the engine shows nothing before). */
  lessonApproved: boolean;
  strings: ReadonlyMap<string, LessonString>;
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function parseLessonText(raw: unknown): LessonText | null {
  const r = raw as { lesson?: unknown; lessonApproved?: unknown; strings?: unknown } | null;
  if (!r || typeof r !== 'object' || typeof r.lesson !== 'string' || !LESSON_KEY.test(r.lesson) || typeof r.lessonApproved !== 'boolean' || !Array.isArray(r.strings)) return null;
  const strings = new Map<string, LessonString>();
  for (const s of r.strings as Array<Partial<LessonString>>) {
    if (!s || typeof s.id !== 'string' || !STRING_ID.test(s.id) || strings.has(s.id)) return null;
    if (s.kind !== 'name' && s.kind !== 'word' && s.kind !== 'note') return null;
    if (typeof s.text !== 'string' || !s.text.length || s.text.normalize('NFC') !== s.text) return null;
    if (typeof s.sha256 !== 'string' || !SHA256.test(s.sha256) || sha(s.text) !== s.sha256) return null;
    strings.set(s.id, { id: s.id, kind: s.kind, text: s.text, sha256: s.sha256 });
  }
  return { lesson: r.lesson, lessonApproved: r.lessonApproved, strings };
}

const LESSONS: ReadonlyMap<string, LessonText> = new Map(
  [parseLessonText(arabic001)].filter((t): t is LessonText => t !== null).map((t) => [t.lesson, t]),
);

/** The lesson's approved text, or null for a lesson that is unknown or did not verify. */
export function lessonText(lesson: string): LessonText | null {
  return LESSONS.get(lesson) ?? null;
}

export function knownLessons(): string[] {
  return [...LESSONS.keys()];
}
