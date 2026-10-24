/**
 * PD-29: the Materials vocabulary. One definition: the API validates against
 * these codes and the clients ship the same ones (an unknown code is shown as
 * the code, never dropped). The database checks the same lists
 * (20261022180000).
 */

export const SUBJECTS = ['quran', 'arabic', 'islamic_studies'] as const;
export type Subject = (typeof SUBJECTS)[number];

/** Quran items only: what part of the Quran programme an item serves. */
export const STRANDS = ['memorization', 'recitation', 'word_meanings', 'tafsir'] as const;
export type Strand = (typeof STRANDS)[number];

export const KINDS = ['activity_package', 'activity_link', 'audio', 'video', 'pdf', 'image'] as const;
export type Kind = (typeof KINDS)[number];

/** Kinds an uploaded single file may be. */
export const FILE_KINDS: readonly Kind[] = ['audio', 'video', 'pdf', 'image'];

export const ITEM_STATUSES = ['draft', 'published', 'retired'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Age bands, in years. An item lists the bands it suits; none listed = every age. */
export const AGE_GROUPS = ['4-6', '7-9', '10-12', '13-17', '18+'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export const MARK_STATUSES = ['not_started', 'in_progress', 'memorized', 'needs_revision'] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

/** The band a child of `age` whole years is in; null when the age is unknown. Under 4 reads as the youngest band. */
export function ageGroupOf(age: number | null): AgeGroup | null {
  if (age === null || !Number.isFinite(age)) return null;
  if (age <= 6) return '4-6';
  if (age <= 9) return '7-9';
  if (age <= 12) return '10-12';
  if (age <= 17) return '13-17';
  return '18+';
}

/**
 * What a single uploaded file may be, by kind: the declared MIME types, the
 * byte limit, and the real-bytes signature the server checks before an item
 * may use it (a declared type is a claim, not a fact).
 */
export const FILE_RULES: Readonly<Record<'audio' | 'video' | 'pdf' | 'image', { mimeTypes: readonly string[]; maxBytes: number }>> = {
  audio: { mimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm'], maxBytes: 100 * 1024 * 1024 },
  video: { mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'], maxBytes: 500 * 1024 * 1024 },
  pdf: { mimeTypes: ['application/pdf'], maxBytes: 100 * 1024 * 1024 },
  image: { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxBytes: 20 * 1024 * 1024 },
};

export const PACKAGE_MIME_TYPES: readonly string[] = ['application/zip', 'application/x-zip-compressed'];
export const PACKAGE_MAX_BYTES = 50 * 1024 * 1024;

/** The kind a declared MIME type belongs to, or null. */
export function kindOfMime(mime: string): 'audio' | 'video' | 'pdf' | 'image' | 'activity_package' | null {
  const m = mime.toLowerCase();
  if (PACKAGE_MIME_TYPES.includes(m)) return 'activity_package';
  for (const [kind, rule] of Object.entries(FILE_RULES)) {
    if (rule.mimeTypes.includes(m)) return kind as 'audio' | 'video' | 'pdf' | 'image';
  }
  return null;
}

/**
 * Does `head` (the first bytes of an object) look like `mime`? Magic numbers
 * only -- enough to refuse an HTML page renamed .mp3, which a browser might
 * otherwise sniff and run from a storage URL.
 */
export function bytesMatchMime(head: Buffer, mime: string): boolean {
  const m = mime.toLowerCase();
  const at = (offset: number, ascii: string) => head.length >= offset + ascii.length && head.subarray(offset, offset + ascii.length).toString('latin1') === ascii;
  const startsWith = (...bytes: number[]) => head.length >= bytes.length && bytes.every((b, i) => head[i] === b);
  switch (m) {
    case 'application/zip':
    case 'application/x-zip-compressed':
      return startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06);
    case 'application/pdf':
      return at(0, '%PDF-');
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff);
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/gif':
      return at(0, 'GIF87a') || at(0, 'GIF89a');
    case 'image/webp':
      return at(0, 'RIFF') && at(8, 'WEBP');
    case 'audio/mpeg':
      // An ID3 tag, or an MPEG frame sync.
      return at(0, 'ID3') || (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0);
    case 'audio/aac':
      return head.length >= 2 && head[0] === 0xff && (head[1]! & 0xf6) === 0xf0;
    case 'audio/ogg':
      return at(0, 'OggS');
    case 'audio/wav':
    case 'audio/x-wav':
      return at(0, 'RIFF') && at(8, 'WAVE');
    case 'audio/webm':
    case 'video/webm':
      return startsWith(0x1a, 0x45, 0xdf, 0xa3);
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'video/mp4':
    case 'video/quicktime':
      return at(4, 'ftyp') || at(4, 'moov') || at(4, 'mdat') || at(4, 'wide') || at(4, 'free');
    default:
      return false;
  }
}
