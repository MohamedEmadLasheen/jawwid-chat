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

/**
 * How the publisher names its files, derived from the archive's own listing and
 * reviewed: `ayah` is anchored and captures (surah, ayah); each extra is a file
 * the reviewer has named in advance, reported and never ingested. Any other
 * file is a reject.
 */
export interface AudioNaming {
  ayah: RegExp;
  extras: Array<{ pattern: RegExp; reason: string }>;
}

export interface AudioSourceSpec {
  reciter: string;
  name: string;
  attribution: string;
  licence: AudioLicence | null;
  archives: AudioArchive[];
  naming: AudioNaming;
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
      // The first verified extraction (2026-10-28, macOS bsdtar 3.7.4): 6,350 files,
      // 6,236 ayat mapped, 114 known extras, 0 rejects, all decoded.
      extractedManifestSha256: '7daf7f2ac325e08d2c78f52215ff3ebded8e0b29cb968baadec847cc80fe1a69',
    },
  ],
  // From the listing of the verified archive (2026-10-28): 6,350 files under
  // `الحذيفي-ايات/<SSS> <name>/`. 5,950 ayat as 10-SSSAAA-A01.mp3 and Al-Baqarah's
  // 286 as 10-002AAA-001.mp3 (6,236 in all); one Basmala per surah as
  // 10-SSSC00-*.mp3 (112); the Isti'adha as 10-000B00-A01.mp3; and one Sound
  // Forge peak file (.sfk), editor data. MP3, 22,050 Hz stereo, 64 kbps.
  naming: {
    ayah: /^10-(\d{3})(\d{3})-(?:A01|001)\.mp3$/,
    extras: [
      { pattern: /^10-(?!000)\d{3}C00-(?:A01|001)\.mp3$/, reason: 'the surah\'s Basmala as its own file (the audio of an ayah is the verse alone)' },
      { pattern: /^10-000B00-A01\.mp3$/, reason: 'the Isti\'adha, not an ayah' },
      { pattern: /^10-000B00-A01\.mp3\.sfk$/, reason: 'a Sound Forge peak file: editor data, not audio' },
    ],
  },
};

export const AUDIO_SOURCES: ReadonlyMap<string, AudioSourceSpec> = new Map([[KFGQPC_HUDHAIFY.reciter, KFGQPC_HUDHAIFY]]);
