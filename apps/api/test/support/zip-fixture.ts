import { crc32, deflateRawSync } from 'node:zlib';

/**
 * PD-29 test helper: build a zip byte by byte, including the malformed and
 * hostile shapes a validator must refuse (traversal names, symlinks,
 * encrypted entries, lying sizes). Synthetic content only.
 */
export interface FixtureEntry {
  name: string;
  data?: Buffer | string;
  /** Deflate the entry (default: stored). */
  deflate?: boolean;
  /** Mark it as a Unix symbolic link. */
  symlink?: boolean;
  /** Set the "encrypted" flag. */
  encrypted?: boolean;
  /** Lie about the uncompressed size in both headers. */
  declaredSize?: number;
  /** Lie about the CRC in both headers. */
  declaredCrc?: number;
}

export function buildZip(entries: FixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data ?? Buffer.alloc(0);
    const body = e.deflate ? deflateRawSync(raw) : raw;
    const method = e.deflate ? 8 : 0;
    const crc = e.declaredCrc ?? (crc32(raw) >>> 0);
    const usize = e.declaredSize ?? raw.length;
    const name = Buffer.from(e.name, 'utf8');
    const flags = 0x0800 | (e.encrypted ? 0x0001 : 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(usize, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = e.symlink ? 0o120777 : e.name.endsWith('/') ? 0o040755 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    const localRecord = Buffer.concat([local, name, body]);
    locals.push(localRecord);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** A small, valid HTML5 activity: a page, a script, a stylesheet and an image. */
export function sampleActivity(prefix = ''): Buffer {
  return buildZip([
    { name: `${prefix}index.html`, data: '<!doctype html><html><head><link rel="stylesheet" href="css/app.css"><script src="js/app.js"></script></head><body><h1>Activity</h1></body></html>', deflate: true },
    { name: `${prefix}js/app.js`, data: 'document.title = "activity";', deflate: true },
    { name: `${prefix}css/app.css`, data: 'body { margin: 0 }' },
    { name: `${prefix}img/star.png`, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) },
  ]);
}
