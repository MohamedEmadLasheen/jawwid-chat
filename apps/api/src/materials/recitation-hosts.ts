import type { AudioLicence } from '../quran/audio-sources';

/**
 * PD-29 Materials recitations: the external hosts a recitation source may
 * point at, pinned in code, each with the owner's licence record for the
 * recitation it serves (null until recorded). A manager can no longer point a
 * source at ANY https host: a template or a track URL on a host not listed
 * here is refused when it is saved, and never opened.
 *
 * Who may OPEN a recitation is the same release gate as the Quran audio
 * (quran/audio-gate.ts, chat.config quran.audio.enabled_for): with no licence
 * -- an unlisted host's never has one, an uploaded file has none -- only the
 * testers hear it, and a family never does.
 *
 * Empty by default: no external recitation host is allowed.
 */
export interface RecitationHost {
  host: string;
  licence: AudioLicence | null;
}

export const RECITATION_HOSTS = Symbol('RECITATION_HOSTS');
export const ALLOWED_RECITATION_HOSTS: readonly RecitationHost[] = [];

/** The allowlist entry for a URL's host, or null. */
export function recitationHostOf(hosts: readonly RecitationHost[], url: string): RecitationHost | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  return hosts.find((h) => h.host.toLowerCase() === host) ?? null;
}
