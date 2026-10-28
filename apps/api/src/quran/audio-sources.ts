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
 * `archives` are the official published downloads: the ingest
 * (audio-archive.ts) refuses an archive whose streamed SHA-256 and size are not
 * exactly the published ones. The archive is extracted with the system's
 * bsdtar into its own folder, and the ingest reads THAT folder; so the
 * extracted folder is pinned too: `extractedManifestSha256` is the hash of its
 * file list (path, size, SHA-256 of every file), recorded after the first
 * verified extraction. Until it is recorded, nothing can be written.
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
  /** The publisher's download URL. */
  url: string;
  /** The SHA-256 the publisher states for this file (lower case). */
  sha256: string;
  bytes: number;
  /** The extracted folder's manifest hash (audio-archive.ts manifestOf), once verified; null before. */
  extractedManifestSha256: string | null;
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
 * with it on 2026-10-28 and approved downloading this one archive for
 * development and testing. The constants are the licence record's
 * (docs/legal/kfgqpc-hudhaify-licence.md, section 5); the licence and the
 * attribution wording await the Complex's written answer.
 */
export const KFGQPC_HUDHAIFY: AudioSourceSpec = {
  reciter: 'kfgqpc-huthify-hafs',
  name: "Ali Al-Hudhaify (KFGQPC), Hafs 'an 'Asim",
  attribution: "PLACEHOLDER until the licence is confirmed: recitation by Sheikh Ali Al-Hudhaify, King Fahd Glorious Qur'an Printing Complex",
  licence: null,
  archives: [
    {
      file: 'huthify-ayat.rar',
      url: 'https://download.qurancomplex.gov.sa/new-sounds/huthify-01/hafs/huthify-ayat.rar',
      sha256: 'ad50fd0d8c362f6967141b5240cdbac4089efaf6d3a46ef159c3c8aaa05371f5',
      bytes: 842634506,
      extractedManifestSha256: null,
    },
  ],
};

export const AUDIO_SOURCES: ReadonlyMap<string, AudioSourceSpec> = new Map([[KFGQPC_HUDHAIFY.reciter, KFGQPC_HUDHAIFY]]);
