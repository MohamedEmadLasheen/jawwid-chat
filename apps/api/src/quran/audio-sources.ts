/**
 * The recitations the API may serve, pinned in code like the Quran text
 * (docs/product/quran-dataset-contract.md, "Audio"). A reciter that is not
 * listed here gets no audio, whatever chat.config says.
 *
 * `licence` is the owner's recorded confirmation that the academy may
 * self-host and serve the recitation. Recording it is a reviewed change to
 * this file -- never a database write -- and it is the ONLY thing that lets
 * audio reach a student or a parent (audio-gate.ts). Until then, at most staff
 * hear it, for development and testing.
 *
 * `archives` are the official published downloads and their published
 * SHA-256: the ingest (audio-archive.ts) refuses any archive not listed here
 * with exactly that checksum. Empty until the licence session names them.
 */
export interface AudioLicence {
  /** Who confirmed it (the owner). */
  confirmedBy: string;
  /** When (ISO date). */
  confirmedAt: string;
  /** Where the confirmation is kept (a letter, an e-mail, a contract). */
  reference: string;
}

export interface AudioArchive {
  file: string;
  /** The SHA-256 the publisher states for this file. */
  sha256: string;
  bytes: number;
}

export interface AudioSourceSpec {
  reciter: string;
  name: string;
  attribution: string;
  licence: AudioLicence | null;
  archives: AudioArchive[];
}

/**
 * King Fahd Glorious Qur'an Printing Complex (KFGQPC), Sheikh Ali Al-Hudhaify,
 * Hafs 'an 'Asim, one file per ayah. The owner directed engineering to start
 * with it on 2026-10-28; the licence and the attribution wording are being
 * confirmed by the licence session.
 */
export const KFGQPC_HUDHAIFY: AudioSourceSpec = {
  reciter: 'kfgqpc-hudhaify',
  name: "Ali Al-Hudhaify (KFGQPC), Hafs 'an 'Asim",
  attribution: "PLACEHOLDER until the licence is confirmed: recitation by Sheikh Ali Al-Hudhaify, King Fahd Glorious Qur'an Printing Complex",
  licence: null,
  archives: [],
};

export const AUDIO_SOURCES: ReadonlyMap<string, AudioSourceSpec> = new Map([[KFGQPC_HUDHAIFY.reciter, KFGQPC_HUDHAIFY]]);
