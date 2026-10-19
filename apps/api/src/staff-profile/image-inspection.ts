/**
 * What a profile photo ACTUALLY is, read from its bytes.
 *
 * The declared MIME type is the client's claim, and the upload signature binds
 * the bytes to that claim only as a label -- storage will happily hold an HTML
 * page under `image/png`. So before a photo is committed to a profile its first
 * bytes are read back from storage and checked here: the signature must be a
 * real JPEG, PNG or WebP, it must match the declared type, and the dimensions
 * must be readable from the header and inside the limits below.
 *
 * Pure and dependency-free on purpose. No image library is decoded on the
 * request path; only the container headers are parsed, and every read is
 * bounds-checked so a truncated or hostile header yields `null`, never a throw
 * from deep inside a Buffer accessor.
 *
 * What this does NOT do: re-encode the image or strip metadata. A JPEG keeps its
 * EXIF block. The Admin Web re-encodes through a canvas before upload, which
 * drops it, but that is a client convenience -- see the limitation recorded in
 * docs/admin/staff-profiles.md.
 */

export type AvatarMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const AVATAR_MIME_TYPES: readonly AvatarMime[] = ['image/jpeg', 'image/png', 'image/webp'];
/** 2 MiB. A 512px photo is ~100 KB; this leaves room for a larger original. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MIN_AVATAR_DIMENSION = 64;
export const MAX_AVATAR_DIMENSION = 4096;
/** How much of the object is read back to find the header. JPEG SOF can sit after a large APPn block. */
export const AVATAR_HEAD_BYTES = 256 * 1024;

export interface InspectedImage {
  mime: AvatarMime;
  width: number;
  height: number;
  animated: boolean;
}

export function isAvatarMime(value: unknown): value is AvatarMime {
  return typeof value === 'string' && (AVATAR_MIME_TYPES as readonly string[]).includes(value);
}

/** Identify the container and read its dimensions. Null for anything else. */
export function inspectImage(head: Buffer): InspectedImage | null {
  if (isPng(head)) return inspectPng(head);
  if (isJpeg(head)) return inspectJpeg(head);
  if (isWebp(head)) return inspectWebp(head);
  return null;
}

export type AvatarRejection =
  | 'unrecognized'
  | 'type_mismatch'
  | 'animated'
  | 'too_small'
  | 'too_large_dimensions'
  | 'too_large_bytes'
  | 'empty';

/**
 * The whole acceptance rule for a stored profile photo, in one place so the
 * service and the tests agree on it.
 */
export function judgeAvatar(input: {
  head: Buffer;
  byteSize: number;
  declaredMime: string | null;
}): { ok: true; image: InspectedImage } | { ok: false; reason: AvatarRejection } {
  if (input.byteSize <= 0 || input.head.length === 0) return { ok: false, reason: 'empty' };
  if (input.byteSize > MAX_AVATAR_BYTES) return { ok: false, reason: 'too_large_bytes' };

  const image = inspectImage(input.head);
  if (!image) return { ok: false, reason: 'unrecognized' };
  if (input.declaredMime !== image.mime) return { ok: false, reason: 'type_mismatch' };
  if (image.animated) return { ok: false, reason: 'animated' };
  if (image.width < MIN_AVATAR_DIMENSION || image.height < MIN_AVATAR_DIMENSION) {
    return { ok: false, reason: 'too_small' };
  }
  if (image.width > MAX_AVATAR_DIMENSION || image.height > MAX_AVATAR_DIMENSION) {
    return { ok: false, reason: 'too_large_dimensions' };
  }
  return { ok: true, image };
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(b: Buffer): boolean {
  return b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE);
}

function inspectPng(b: Buffer): InspectedImage | null {
  // The first chunk must be IHDR: length(4) type(4) width(4) height(4).
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  if (width === 0 || height === 0) return null;

  // APNG announces itself with an acTL chunk before the first IDAT.
  let animated = false;
  let pos = 8;
  while (pos + 8 <= b.length) {
    const length = b.readUInt32BE(pos);
    const type = b.toString('latin1', pos + 4, pos + 8);
    if (type === 'acTL') {
      animated = true;
      break;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    pos += 12 + length;
  }
  return { mime: 'image/png', width, height, animated };
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

function isJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Start-of-frame markers carry the dimensions. C4 (DHT), C8 (JPG) and CC (DAC) are not frames. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function inspectJpeg(b: Buffer): InspectedImage | null {
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) return null;
    // Fill bytes: any number of 0xFF may precede a marker.
    while (pos < b.length && b[pos] === 0xff) pos += 1;
    if (pos >= b.length) return null;
    const marker = b[pos];
    pos += 1;

    // Standalone markers have no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // End of image or start of scan before any frame header: no dimensions.
    if (marker === 0xd9 || marker === 0xda) return null;

    if (pos + 2 > b.length) return null;
    const length = b.readUInt16BE(pos);
    if (length < 2) return null;

    if (isStartOfFrame(marker)) {
      // length(2) precision(1) height(2) width(2)
      if (pos + 7 > b.length) return null;
      const height = b.readUInt16BE(pos + 3);
      const width = b.readUInt16BE(pos + 5);
      if (width === 0 || height === 0) return null;
      return { mime: 'image/jpeg', width, height, animated: false };
    }
    pos += length;
  }
  return null;
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

function isWebp(b: Buffer): boolean {
  return b.length >= 16 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
}

function inspectWebp(b: Buffer): InspectedImage | null {
  const chunk = b.toString('latin1', 12, 16);

  if (chunk === 'VP8 ') {
    // Frame tag (3) then the start code 9D 01 2A, then 14-bit width and height.
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = b.readUInt16LE(26) & 0x3fff;
    const height = b.readUInt16LE(28) & 0x3fff;
    return width && height ? { mime: 'image/webp', width, height, animated: false } : null;
  }

  if (chunk === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const b0 = b[21];
    const b1 = b[22];
    const b2 = b[23];
    const b3 = b[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { mime: 'image/webp', width, height, animated: false };
  }

  if (chunk === 'VP8X') {
    if (b.length < 30) return null;
    const flags = b[20];
    const width = 1 + b.readUIntLE(24, 3);
    const height = 1 + b.readUIntLE(27, 3);
    return { mime: 'image/webp', width, height, animated: (flags & 0x02) !== 0 };
  }

  return null;
}
