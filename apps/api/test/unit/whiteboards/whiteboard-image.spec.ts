/**
 * PD-39 PR-4 (§4.4, §6.3): what a board image ACTUALLY is decides, not what
 * the client declared. A real PNG, JPEG and WebP pass with their decoded
 * size; a type that lies, a file with bytes after its end, an animated image
 * and one over 8,000 px are refused. The PDF export lays out the client's PNGs
 * one per page, 16:9.
 */
import { crc32, deflateSync } from 'node:zlib';
import { BOARD_IMAGE_MAX_EDGE, imageSize, inspectBoardImage, sniffBoardImage } from '../../../src/whiteboards/whiteboard-image';
import { EXPORT_PAGE, composeBoardPdf } from '../../../src/whiteboards/whiteboard-export';
import { contentDisposition } from '../../../src/whiteboards/whiteboard.controller';
import { exportFileName } from '../../../src/whiteboards/whiteboard.service';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** A real, decodable RGB PNG; `animated` adds an acTL chunk (an APNG). */
export function png(width: number, height: number, animated = false): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 0xcc);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(animated ? [chunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]))] : []),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG header that claims a size, for the size checks (not decodable). */
function pngClaiming(width: number, height: number): Buffer {
  const real = png(1, 1);
  const out = Buffer.from(real);
  out.writeUInt32BE(width, 16);
  out.writeUInt32BE(height, 20);
  return out;
}

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0x00, 0xff, 0xd9])]);
}

function webpVp8x(width: number, height: number, animated = false): Buffer {
  const body = Buffer.alloc(18);
  body.write('VP8X', 0, 'latin1');
  body.writeUInt32LE(10, 4);
  body[8] = animated ? 0x02 : 0x00;
  body.writeUIntLE(width - 1, 12, 3);
  body.writeUIntLE(height - 1, 15, 3);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, body]);
}

describe('a board image, read from its bytes', () => {
  it('passes a real PNG, JPEG and WebP with their decoded size', () => {
    expect(inspectBoardImage(png(40, 30), 'image/png')).toEqual({ ok: true, width: 40, height: 30 });
    expect(inspectBoardImage(jpeg(640, 480), 'image/jpeg')).toEqual({ ok: true, width: 640, height: 480 });
    expect(inspectBoardImage(webpVp8x(1200, 900), 'image/webp')).toEqual({ ok: true, width: 1200, height: 900 });
  });

  it('refuses a type that lies, SVG, and bytes riding after the image', () => {
    expect(inspectBoardImage(jpeg(10, 10), 'image/png')).toMatchObject({ ok: false, reason: /not the image it claims/ });
    expect(sniffBoardImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffBoardImage(Buffer.from('%PDF-1.7\n'))).toBeNull();
    expect(inspectBoardImage(Buffer.concat([png(4, 4), Buffer.from('<script>')]), 'image/png')).toMatchObject({ ok: false, reason: /IEND/ });
  });

  it('refuses an animated PNG or WebP: a board is drawn and exported as stills', () => {
    expect(inspectBoardImage(png(4, 4, true), 'image/png')).toMatchObject({ ok: false, reason: /animated/ });
    expect(inspectBoardImage(webpVp8x(10, 10, true), 'image/webp')).toMatchObject({ ok: false, reason: /animated/ });
  });

  it('refuses an image over 8,000 px on a side', () => {
    expect(imageSize(pngClaiming(BOARD_IMAGE_MAX_EDGE, 10), 'image/png')).toMatchObject({ width: BOARD_IMAGE_MAX_EDGE });
    expect(inspectBoardImage(pngClaiming(BOARD_IMAGE_MAX_EDGE, 10), 'image/png')).toMatchObject({ ok: true });
    expect(inspectBoardImage(pngClaiming(BOARD_IMAGE_MAX_EDGE + 1, 10), 'image/png')).toMatchObject({ ok: false, reason: /8000 px/ });
    expect(inspectBoardImage(jpeg(10, 9000), 'image/jpeg')).toMatchObject({ ok: false, reason: /8000 px/ });
  });

  it('refuses a header it cannot read rather than guessing a size', () => {
    const noFrame = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00, 0xff, 0xd9, 0, 0]);
    expect(imageSize(noFrame, 'image/jpeg')).toBeNull();
  });
});

describe('a board exported as a PDF', () => {
  it('lays out one 16:9 page per board page, with a strip for the credit', async () => {
    const pdf = await composeBoardPdf({ title: 'Al-Fatihah', pages: [png(64, 36), png(64, 36), png(64, 36)], credit: 'Quran text: Tanzil Project — tanzil.net' });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(3);
    expect(text).toContain(`/MediaBox [0 0 ${EXPORT_PAGE.width} ${EXPORT_PAGE.height + EXPORT_PAGE.footer}]`);
    // An image per page, and a font only for the credit and page numbers.
    expect(text.match(/\/Subtype \/Image/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('names the file after the board, safely, in both header forms', () => {
    expect(exportFileName('Al-Fatihah: review / week 2')).toBe('Al-Fatihah review week 2.pdf');
    expect(exportFileName('   ')).toBe('board.pdf');
    const h = contentDisposition(exportFileName('مراجعة الفاتحة'));
    expect(h).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(decodeURIComponent(h.split("UTF-8''")[1])).toBe('مراجعة الفاتحة.pdf');
  });
});
