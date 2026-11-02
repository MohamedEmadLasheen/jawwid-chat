import { crc32, deflateSync } from 'node:zlib';

/**
 * PD-39 test images: a real, decodable PNG (RGB, or RGBA with `alpha`), and
 * the review of #305's damaged page -- valid header, chunk CRCs and IEND,
 * image data that is not deflate. Shared by the whiteboard integration specs.
 */
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function png(width: number, height: number, opts: { alpha?: boolean; idat?: Buffer } = {}): Buffer {
  const channels = opts.alpha ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, opts.alpha ? 6 : 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * channels + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width * channels + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', opts.idat ?? deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const corruptPng = () => png(64, 36, { alpha: true, idat: Buffer.from('78da' + 'ff'.repeat(40), 'hex') });
