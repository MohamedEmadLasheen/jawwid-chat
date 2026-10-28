/**
 * PD-48: the computer voices whose clips may be served, each with its licence
 * record (design §7.6, §2.8; owner 2026-10-28/29). Recorded ONLY in code, in a
 * reviewed commit: no database write can let a family hear a voice.
 *
 *   - A clip whose (vendor, voice) is not listed here is never served, to anyone.
 *     Removing a voice switches all of its clips off at the next deploy.
 *   - `licence: null` means the voice may be heard by the TESTERS only
 *     (lesson_audio.enabled_for = staff_test, or `all` before the record).
 *   - Families hear a voice only once `licence` names who confirmed the terms,
 *     when, and -- release gate R-48a -- Microsoft's WRITTEN confirmation that
 *     the parent-facing notice satisfies Code of Conduct Responsible AI
 *     requirement 3. If Microsoft will not confirm, the vendor is Amazon Polly.
 *
 * No account exists yet and no clip has been generated (2026-10-29).
 */
export interface VoiceLicence {
  /** Who read the vendor's terms (the owner or counsel). */
  confirmedBy: string;
  /** ISO date. */
  confirmedOn: string;
  /** The terms document and version that were read. */
  terms: string;
  /** How families are told the voice is computer-generated (Q7: a parent-only notice). */
  disclosure: string;
  /** R-48a for Azure: the vendor's written confirmation of that disclosure (a reference, never the letter). */
  vendorConfirmation: string | null;
}

export interface VoiceSource {
  vendor: string;
  voice: string;
  licence: VoiceLicence | null;
}

export const VOICE_SOURCES: ReadonlyMap<string, VoiceSource> = new Map(
  (
    [
      // The owner's choice (Q2, Q5): Azure AI Speech, one adult MSA voice. Not licensed yet.
      { vendor: 'azure', voice: 'ar-SA-HamedNeural', licence: null },
      { vendor: 'azure', voice: 'ar-SA-ZariyahNeural', licence: null },
      // The fallback (Q2, R-48a): Amazon Polly. Not licensed yet.
      { vendor: 'polly', voice: 'Zeina', licence: null },
      { vendor: 'polly', voice: 'Hala', licence: null },
    ] satisfies VoiceSource[]
  ).map((s) => [`${s.vendor}:${s.voice}`, s]),
);

/** A served voice's licence for families: present only when fully recorded (and, for Azure, R-48a met). */
export function familyLicence(source: VoiceSource | undefined): VoiceLicence | null {
  const l = source?.licence;
  if (!l || !l.confirmedBy || !l.confirmedOn || !l.terms || !l.disclosure) return null;
  if (source!.vendor === 'azure' && !l.vendorConfirmation) return null;
  return l;
}
