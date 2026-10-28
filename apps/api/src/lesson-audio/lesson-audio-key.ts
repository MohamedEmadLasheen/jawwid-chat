/**
 * PD-48: the one mapping from a lesson clip to its object
 * (docs/product/pd048-lesson-voice-over-design.md §5). A key is DERIVED from
 * (lesson, string id, SHA-256 of the stored bytes) and nothing else, so it is
 * content-addressed: the same bytes have the same key, and an object is never
 * replaced in place. chat.lesson_audio_clip computes the same key as a
 * GENERATED column. No route ever accepts a key from a client: the signing
 * call is the access decision.
 *
 *   lesson-audio/<lesson>/<string id>/<audio sha256>.mp3     e.g. lesson-audio/arabic-001/ba-001/3f9c….mp3
 *
 * The prefix is never `quran/`: Quran recitation is never TTS.
 */

/** The owner's rule: two different teachers approve every clip (chat.lesson_audio_approvals_required). */
export const APPROVALS_REQUIRED = 2;
/** After this many failed clips of one text, a reviewer decides (chat.lesson_audio_tries_per_round). */
export const TRIES_PER_ROUND = 3;

export const LESSON_KEY = /^[a-z]+-[0-9]{3}$/;
/** PD-29's string ids (#234): <unit>-NNN, <unit>.name, <unit>.note. */
export const STRING_ID = /^[a-z][a-z0-9_]*(-[0-9]{3}|\.(name|note))$/;
export const SHA256 = /^[0-9a-f]{64}$/;
const KEY = /^lesson-audio\/([a-z]+-[0-9]{3})\/([a-z][a-z0-9_]*(?:-[0-9]{3}|\.(?:name|note)))\/([0-9a-f]{64})\.mp3$/;

export function lessonAudioKey(lesson: string, stringId: string, audioSha256: string): string {
  if (!LESSON_KEY.test(lesson)) throw new Error(`not a lesson key: ${JSON.stringify(lesson)}`);
  if (!STRING_ID.test(stringId)) throw new Error(`not a string id: ${JSON.stringify(stringId)}`);
  if (!SHA256.test(audioSha256)) throw new Error('not a SHA-256');
  return `lesson-audio/${lesson}/${stringId}/${audioSha256}.mp3`;
}

/** What a key names, or null for anything that is not exactly one clip key. */
export function parseLessonAudioKey(key: string): { lesson: string; stringId: string; audioSha256: string } | null {
  const m = KEY.exec(key);
  return m ? { lesson: m[1]!, stringId: m[2]!, audioSha256: m[3]! } : null;
}
