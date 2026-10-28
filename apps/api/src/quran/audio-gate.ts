import type { AudioLicence } from './audio-sources';

/**
 * THE RELEASE GATE for Quran audio (PD-29 materials quality, owner 2026-10-28):
 * who may receive an ayah's audio is decided here, on the server, per request.
 *
 *   chat.config quran.audio.enabled_for   none | staff_test | all
 *
 * Unset, or any other value, means `none`: nobody. `staff_test` lets staff
 * accounts hear it, for development and testing. `all` adds everyone else
 * ONLY when the configured reciter's licence confirmation is recorded in code
 * (audio-sources.ts); without it, `all` is still staff only. So a paying
 * student or their family never gets audio until the owner has recorded the
 * licence -- and no database write can change that.
 */
export type AudioAudience = 'none' | 'staff_test' | 'all';

export function parseAudience(value: unknown): AudioAudience {
  return value === 'staff_test' || value === 'all' ? value : 'none';
}

export function audioAllowed(audience: AudioAudience, licence: AudioLicence | null, actor: { kind: string }): boolean {
  if (audience === 'none') return false;
  if (actor.kind === 'staff') return true;
  if (audience === 'staff_test') return false;
  return licence !== null && (actor.kind === 'contact' || actor.kind === 'teacher');
}
