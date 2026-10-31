import { inspectCertificateFile, sniffCertificateFile } from '../certificates/certificate-file';

/**
 * PD-39 §4.4, §6.3: what an image put on a board ACTUALLY is, read from its
 * bytes after they were copied to a key no upload grant can name. The type the
 * client declared is only a claim; these are the checks that decide.
 *
 *   - PNG, JPEG or WebP only (SVG can carry script; a GIF is imported by the
 *     client as a still PNG of its first frame);
 *   - the format's own end where it should be (no bytes riding after it);
 *   - a still image: an animated PNG or WebP is refused, because a board is
 *     drawn and exported as stills;
 *   - its decoded size, at most 8,000 px on the long edge.
 *
 * Pure: bytes in, a verdict out.
 */
export const BOARD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type BoardImageType = (typeof BOARD_IMAGE_TYPES)[number];

/** §6.4: an image (or an export page) is at most 10 MB and 8,000 px on its long edge. */
export const BOARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const BOARD_IMAGE_MAX_EDGE = 8000;

export function sniffBoardImage(head: Buffer): BoardImageType | null {
  const mime = sniffCertificateFile(head);
  return mime && (BOARD_IMAGE_TYPES as readonly string[]).includes(mime) ? (mime as BoardImageType) : null;
}

export type ImageVerdict = { ok: true; width: number; height: number } | { ok: false; reason: string };

export function inspectBoardImage(
  bytes: Buffer,
  declared: BoardImageType,
  max: { width: number; height: number } = { width: BOARD_IMAGE_MAX_EDGE, height: BOARD_IMAGE_MAX_EDGE },
): ImageVerdict {
  if (sniffBoardImage(bytes.subarray(0, 16)) !== declared) return { ok: false, reason: 'the file is not the image it claims to be' };
  const ended = inspectCertificateFile(bytes, declared);
  if (ended) return { ok: false, reason: ended };
  const size = imageSize(bytes, declared);
  if (!size) return { ok: false, reason: 'the image size cannot be read' };
  if (size.animated) return { ok: false, reason: 'an animated image cannot be put on a board; use a still image' };
  if (size.width < 1 || size.height < 1 || size.width > max.width || size.height > max.height) {
    return {
      ok: false,
      reason: max.width === max.height ? `an image is at most ${max.width} px on each side` : `an image is at most ${max.width} x ${max.height} px`,
    };
  }
  return { ok: true, width: size.width, height: size.height };
}

/** The decoded width and height, and whether it animates; null when the header cannot be read. */
export function imageSize(b: Buffer, mime: BoardImageType): { width: number; height: number; animated: boolean } | null {
  switch (mime) {
    case 'image/png':
      return pngSize(b);
    case 'image/jpeg':
      return jpegSize(b);
    case 'image/webp':
      return webpSize(b);
  }
}

function pngSize(b: Buffer) {
  // The signature, then IHDR first: length 13, "IHDR", width, height (big-endian).
  if (b.length < 33 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  // An APNG announces itself with an acTL chunk before its first IDAT.
  let animated = false;
  for (let at = 8; at + 8 <= b.length; ) {
    const length = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    if (type === 'acTL') animated = true;
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + length;
  }
  return { width, height, animated };
}

/** The first start-of-frame segment (SOF0-SOF15, not DHT/JPG/DAC) carries the size. */
function jpegSize(b: Buffer) {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // markers without a length
      continue;
    }
    const length = b.readUInt16BE(at + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7), animated: false };
    }
    if (marker === 0xda || marker === 0xd9) return null; // the image data began with no frame header
    at += 2 + length;
  }
  return null;
}

function webpSize(b: Buffer) {
  if (b.length < 30) return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // A key frame: start code 9d 01 2a, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, animated: false };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, animated: false };
  }
  if (chunk === 'VP8X') {
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width, height, animated: (b[20] & 0x02) !== 0 };
  }
  return null;
}
