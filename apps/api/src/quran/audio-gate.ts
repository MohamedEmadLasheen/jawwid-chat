import type { AudioLicence } from './audio-sources';

/**
 * THE RELEASE GATE for Quran audio (PD-29 materials quality, owner 2026-10-28):
 * who may receive recitation is decided here, on the server, per request --
 * for the verified per-ayah audio (/quran/ayahs) and for Materials recitations
 * alike.
 *
 *   chat.config quran.audio.enabled_for    none | staff_test | all
 *   chat.config quran.audio.test_staff_ids ["<staff id>", ...]
 *
 * Unset, or any other value, means `none`: nobody, the owner included.
 * `staff_test` lets the TESTERS hear it: the super admin, and the staff named
 * in quran.audio.test_staff_ids -- not every staff role, since a family-facing
 * one could play it in a call with a student. `all` adds everyone signed in
 * ONLY when the recitation's licence confirmation is recorded in code
 * (audio-sources.ts); without it, `all` is still the testers only. So a paying
 * student or their family never gets audio until the owner has recorded the
 * licence -- and no database write can change that.
 */
export type AudioAudience = 'none' | 'staff_test' | 'all';

export interface AudioGate {
  audience: AudioAudience;
  testStaffIds: readonly string[];
}

export interface AudioViewer {
  kind: string;
  actorId?: string;
  staffRole?: string;
}

export const NO_AUDIO_GATE: AudioGate = { audience: 'none', testStaffIds: [] };

export function parseAudience(value: unknown): AudioAudience {
  return value === 'staff_test' || value === 'all' ? value : 'none';
}

export function parseTestStaffIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && /^[0-9A-Za-z-]{1,64}$/.test(v))) return [];
  return value as string[];
}

function isTester(gate: AudioGate, viewer: AudioViewer): boolean {
  return viewer.kind === 'staff' && (viewer.staffRole === 'super_admin' || (!!viewer.actorId && gate.testStaffIds.includes(viewer.actorId)));
}

export function audioAllowed(gate: AudioGate, licence: AudioLicence | null, viewer: AudioViewer): boolean {
  if (gate.audience === 'none') return false;
  if (isTester(gate, viewer)) return true;
  if (gate.audience === 'staff_test') return false;
  return licence !== null && ['staff', 'contact', 'teacher'].includes(viewer.kind);
}

/** The gate as chat.config holds it; anything unreadable is `none`. */
export async function readAudioGate(prisma: { config: { findMany(args: object): Promise<Array<{ key: string; value: unknown }>> } }): Promise<AudioGate> {
  const rows = await prisma.config.findMany({ where: { key: { in: ['quran.audio.enabled_for', 'quran.audio.test_staff_ids'] } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  return { audience: parseAudience(value('quran.audio.enabled_for')), testStaffIds: parseTestStaffIds(value('quran.audio.test_staff_ids')) };
}
