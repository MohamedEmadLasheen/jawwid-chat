import { surahOf } from '../materials/quran-surahs';

/**
 * PD-39: what a page document may hold (docs/product/pd039-whiteboard-design.md
 * §4.5). The client draws; the server keeps the document honest:
 *
 *   - a page is at most 512 KB and 5,000 elements (§6.4);
 *   - an element is one of the MVP kinds, with a unique id;
 *   - a verse is a REFERENCE -- surah, ayat, the dataset and the range's
 *     SHA-256 -- and never its text (§4.3): any other field is refused, so no
 *     verse text can be typed, pasted or kept in a board;
 *   - an image names an asset of THIS board (checked by the service against
 *     chat.whiteboard_asset; the key is never in the document).
 *
 * The geometry and style of strokes and shapes are the client's: the server
 * bounds their size, not their shape.
 */

export const PAGE_MAX_BYTES = 512 * 1024;
export const PAGE_MAX_ELEMENTS = 5000;
export const DOCUMENT_VERSION = 1;
/** A verse element spans at most this many ayat (the picker's limit, §4.3). */
export const VERSE_MAX_AYAT = 20;
const TEXT_MAX_CHARS = 2000;
/**
 * The shape of an element's own fields (review of #279, P2-8): nested at most
 * this deep below the element, arrays and objects this wide, strings this
 * long (a stroke's packed points are its longest), and only finite numbers.
 * The 512 KB limit bounds the total; these bound what parsing it can cost.
 */
export const ELEMENT_MAX_DEPTH = 4;
const ARRAY_MAX_ITEMS = 1024;
const OBJECT_MAX_KEYS = 32;
const STRING_MAX_CHARS = 400_000;

export const ELEMENT_KINDS = ['stroke', 'highlight', 'shape', 'line', 'arrow', 'text', 'stamp', 'image', 'verse'] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const LAYOUTS = ['plain', 'ruled', 'narrow_ruled', 'grid', 'arabic_lines'] as const;
export const BACKGROUNDS = ['white', 'cream', 'grey', 'green', 'dark'] as const;

const ELEMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const DATASET_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
/** The only fields a verse element carries: a reference and how it is drawn. */
const VERSE_FIELDS = new Set(['id', 'kind', 'z', 'transform', 'style', 'surah', 'fromAyah', 'toAyah', 'datasetId', 'rangeSha256']);

export interface VerseRef {
  surah: number;
  fromAyah: number;
  toAyah: number;
  datasetId: string;
  rangeSha256: string;
}

export interface CheckedDocument {
  /** The document exactly as it will be stored. */
  document: { v: number; elements: Record<string, unknown>[] };
  bytes: number;
  /** Every asset id an image element names; the service checks they are this board's. */
  assetIds: string[];
  verses: VerseRef[];
}

/** Why a document is refused, in words the client can show; null when it is accepted. */
export type DocumentCheck = { ok: true; value: CheckedDocument } | { ok: false; reason: string; tooLarge?: true };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function checkDocument(input: unknown): DocumentCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'document: must be an object' };
  const doc = input as Record<string, unknown>;
  if (doc.v !== DOCUMENT_VERSION) return { ok: false, reason: `document.v: must be ${DOCUMENT_VERSION}` };
  if (!Array.isArray(doc.elements)) return { ok: false, reason: 'document.elements: must be an array' };
  if (doc.elements.length > PAGE_MAX_ELEMENTS) return { ok: false, reason: `document.elements: at most ${PAGE_MAX_ELEMENTS}` };
  const extra = Object.keys(doc).filter((k) => k !== 'v' && k !== 'elements');
  if (extra.length) return { ok: false, reason: `document: unknown field ${extra[0]}` };

  const ids = new Set<string>();
  const assetIds: string[] = [];
  const verses: VerseRef[] = [];
  for (const [i, raw] of doc.elements.entries()) {
    const at = `document.elements[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: `${at}: must be an object` };
    const el = raw as Record<string, unknown>;
    const shape = checkShape(el, 0);
    if (shape) return { ok: false, reason: `${at}${shape}` };
    if (typeof el.id !== 'string' || !ELEMENT_ID.test(el.id)) return { ok: false, reason: `${at}.id: 1-64 letters, digits, _ or -` };
    if (ids.has(el.id)) return { ok: false, reason: `${at}.id: ${el.id} is used twice` };
    ids.add(el.id);
    if (!(ELEMENT_KINDS as readonly unknown[]).includes(el.kind)) return { ok: false, reason: `${at}.kind: one of ${ELEMENT_KINDS.join(', ')}` };

    if (el.kind === 'verse') {
      const unknown = Object.keys(el).find((k) => !VERSE_FIELDS.has(k));
      if (unknown) return { ok: false, reason: `${at}.${unknown}: a verse is a reference, never its text` };
      const surah = isInt(el.surah) ? surahOf(el.surah) : null;
      if (!surah) return { ok: false, reason: `${at}.surah: 1-114` };
      if (!isInt(el.fromAyah) || !isInt(el.toAyah) || el.fromAyah < 1 || el.toAyah < el.fromAyah || el.toAyah > surah.ayahCount) {
        return { ok: false, reason: `${at}: ayat 1-${surah.ayahCount} of surah ${surah.number}, from <= to` };
      }
      if (el.toAyah - el.fromAyah + 1 > VERSE_MAX_AYAT) return { ok: false, reason: `${at}: at most ${VERSE_MAX_AYAT} ayat` };
      if (typeof el.datasetId !== 'string' || !DATASET_ID.test(el.datasetId)) return { ok: false, reason: `${at}.datasetId: a dataset id` };
      if (typeof el.rangeSha256 !== 'string' || !SHA256.test(el.rangeSha256)) return { ok: false, reason: `${at}.rangeSha256: 64 lowercase hex` };
      verses.push({ surah: surah.number, fromAyah: el.fromAyah, toAyah: el.toAyah, datasetId: el.datasetId, rangeSha256: el.rangeSha256 });
    } else if (el.kind === 'image') {
      if (typeof el.assetId !== 'string' || !UUID.test(el.assetId)) return { ok: false, reason: `${at}.assetId: an asset id of this board` };
      if ('objectKey' in el || 'url' in el) return { ok: false, reason: `${at}: an image names its asset, never a key or a URL` };
      assetIds.push(el.assetId.toLowerCase());
    } else if (el.kind === 'text' || el.kind === 'stamp') {
      if (el.text !== undefined && (typeof el.text !== 'string' || el.text.length > TEXT_MAX_CHARS)) {
        return { ok: false, reason: `${at}.text: at most ${TEXT_MAX_CHARS} characters` };
      }
    }
  }

  const document = { v: DOCUMENT_VERSION, elements: doc.elements as Record<string, unknown>[] };
  const bytes = Buffer.byteLength(JSON.stringify(document), 'utf8');
  if (bytes > PAGE_MAX_BYTES) return { ok: false, reason: `document: ${bytes} bytes; a page holds at most ${PAGE_MAX_BYTES}. Add a page`, tooLarge: true };
  return { ok: true, value: { document, bytes, assetIds: [...new Set(assetIds)], verses } };
}

/** Why a value is too deep, too wide, too long or not a finite number; null when it fits. */
function checkShape(value: unknown, depth: number): string | null {
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : ': numbers must be finite';
  if (typeof value === 'string') return value.length <= STRING_MAX_CHARS ? null : `: a string over ${STRING_MAX_CHARS} characters`;
  if (depth >= ELEMENT_MAX_DEPTH) return `: nested deeper than ${ELEMENT_MAX_DEPTH}`;
  if (Array.isArray(value)) {
    if (value.length > ARRAY_MAX_ITEMS) return `: an array of more than ${ARRAY_MAX_ITEMS}`;
    for (const [i, v] of value.entries()) {
      const r = checkShape(v, depth + 1);
      if (r) return `[${i}]${r}`;
    }
    return null;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length > OBJECT_MAX_KEYS) return `: more than ${OBJECT_MAX_KEYS} fields`;
    for (const k of keys) {
      const r = checkShape((value as Record<string, unknown>)[k], depth + 1);
      if (r) return `.${k}${r}`;
    }
    return null;
  }
  return ': not a JSON value';
}
