/**
 * THE RELEASE GATE for lesson voice-over (PD-48 design §7.6). The same shape as
 * the Quran audio gate (quran/audio-gate.ts) and deliberately separate from it:
 * its own config keys, so the two can never be switched together.
 *
 *   chat.config lesson_audio.enabled_for    none | staff_test | all
 *   chat.config lesson_audio.test_staff_ids ["<staff id>", ...]
 *
 * Unset, or any other value, means `none`: nobody, the owner included.
 * `staff_test` lets the TESTERS hear approved clips in the real lesson: the
 * super admin and the staff named in test_staff_ids. `all` adds everyone signed
 * in, but ONLY for a voice whose licence is recorded in code
 * (voice-sources.ts, familyLicence); without it, `all` is still the testers
 * only. Reviewers hear clips on the review page whatever the gate: that is a
 * different route and key (lesson_audio.view).
 */
export type LessonAudioAudience = 'none' | 'staff_test' | 'all';

export interface LessonAudioGate {
  audience: LessonAudioAudience;
  testStaffIds: readonly string[];
}

export interface LessonAudioViewer {
  kind: string;
  actorId?: string;
  staffRole?: string;
}

export const NO_LESSON_AUDIO: LessonAudioGate = { audience: 'none', testStaffIds: [] };

export function parseLessonAudience(value: unknown): LessonAudioAudience {
  return value === 'staff_test' || value === 'all' ? value : 'none';
}

export function parseLessonAudioTesters(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && /^[0-9A-Za-z-]{1,64}$/.test(v))) return [];
  return value as string[];
}

function isTester(gate: LessonAudioGate, viewer: LessonAudioViewer): boolean {
  return viewer.kind === 'staff' && (viewer.staffRole === 'super_admin' || (!!viewer.actorId && gate.testStaffIds.includes(viewer.actorId)));
}

/** May this viewer hear a clip of a voice whose family licence is `licensed`? */
export function lessonAudioAllowed(gate: LessonAudioGate, licensed: boolean, viewer: LessonAudioViewer): boolean {
  if (gate.audience === 'none') return false;
  if (isTester(gate, viewer)) return true;
  if (gate.audience === 'staff_test') return false;
  return licensed && ['staff', 'contact', 'teacher'].includes(viewer.kind);
}

/** The gate as chat.config holds it; anything unreadable is `none`. */
export async function readLessonAudioGate(prisma: {
  config: { findMany(args: object): Promise<Array<{ key: string; value: unknown }>> };
}): Promise<LessonAudioGate> {
  const rows = await prisma.config.findMany({ where: { key: { in: ['lesson_audio.enabled_for', 'lesson_audio.test_staff_ids'] } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  return { audience: parseLessonAudience(value('lesson_audio.enabled_for')), testStaffIds: parseLessonAudioTesters(value('lesson_audio.test_staff_ids')) };
}
