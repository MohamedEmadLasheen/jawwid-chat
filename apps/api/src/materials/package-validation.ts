import { crc32, inflateRawSync } from 'node:zlib';

/**
 * PD-29: validating an uploaded HTML5 package (a zip) before anyone can play it.
 *
 * Deliberately a small reader of our own instead of a general zip library: it
 * understands exactly the subset an exported web package needs (stored or
 * deflated entries, one disk, no encryption, no zip64) and REFUSES everything
 * else, so what it accepts is what it fully checked. Every entry is
 * decompressed once here, its real size and CRC compared with what the zip
 * declares -- a zip bomb or a lying header fails now, not on a child's device.
 *
 * The result is an index of the files that may be served and where their
 * bytes are. Nothing is extracted: the play route reads one entry's bytes from
 * storage by offset, and serves only paths this index holds. A path with `..`,
 * a leading slash, a backslash, a drive letter or a control character, a
 * symlink, an encrypted entry or a duplicate name refuses the whole package.
 * Files of types a web page does not need are skipped (never indexed, so never
 * served) and reported.
 */

export interface PackageLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  /** Uncompressed / compressed, for entries over 1 MB. */
  maxRatio: number;
}

export const DEFAULT_PACKAGE_LIMITS: PackageLimits = {
  maxEntries: 2000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
  maxRatio: 200,
};

export interface PackageEntry {
  path: string;
  dataOffset: number;
  compressedSize: number;
  size: number;
  method: 0 | 8;
  crc32: number;
}

export interface ValidatedPackage {
  entry: string;
  entries: PackageEntry[];
  skipped: string[];
  totalBytes: number;
}

export class PackageRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageRefused';
  }
}

/** The content type each servable extension is sent with. Anything else is not served. */
export const PACKAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  srt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  wasm: 'application/wasm',
  data: 'application/octet-stream',
};

export function contentTypeOf(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/')) return null;
  return PACKAGE_CONTENT_TYPES[path.slice(dot + 1).toLowerCase()] ?? null;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** A safe, normalized entry path, or the reason it is refused. */
export function checkEntryPath(name: string): { ok: true } | { ok: false; reason: string } {
  if (name.length === 0 || name.length > 512) return { ok: false, reason: 'an empty or over-long path' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, reason: 'a control character in a path' };
  if (name.includes('\\')) return { ok: false, reason: 'a backslash in a path' };
  if (name.startsWith('/')) return { ok: false, reason: 'an absolute path' };
  if (/^[a-zA-Z]:/.test(name)) return { ok: false, reason: 'a drive letter in a path' };
  const segments = name.replace(/\/$/, '').split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) return { ok: false, reason: 'a path that leaves its folder (.., . or //)' };
  return { ok: true };
}

/** Entries the packaging tools add that a page never needs; skipped without being reported. */
function isJunk(path: string): boolean {
  return path.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path);
}

export function validatePackage(zip: Buffer, limits: PackageLimits = DEFAULT_PACKAGE_LIMITS): ValidatedPackage {
  // --- end of central directory ---
  const minEocd = 22;
  if (zip.length < minEocd) throw new PackageRefused('not a zip file');
  let eocd = -1;
  for (let i = zip.length - minEocd; i >= Math.max(0, zip.length - minEocd - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new PackageRefused('not a zip file (no central directory)');
  const diskNo = zip.readUInt16LE(eocd + 4);
  const cdDisk = zip.readUInt16LE(eocd + 6);
  const onDisk = zip.readUInt16LE(eocd + 8);
  const total = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  if (diskNo !== 0 || cdDisk !== 0 || onDisk !== total) throw new PackageRefused('a multi-part zip is not accepted');
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new PackageRefused('a zip64 archive is not accepted');
  if (total > limits.maxEntries) throw new PackageRefused(`more than ${limits.maxEntries} files`);
  if (cdOffset + cdSize > eocd) throw new PackageRefused('a damaged zip (central directory out of place)');

  // --- central directory ---
  const entries: PackageEntry[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cdOffset + cdSize || zip.readUInt32LE(p) !== CEN_SIG) throw new PackageRefused('a damaged zip (bad directory entry)');
    const madeBy = zip.readUInt16LE(p + 4);
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const csize = zip.readUInt32LE(p + 20);
    const usize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const startDisk = zip.readUInt16LE(p + 34);
    const extAttr = zip.readUInt32LE(p + 38);
    const localOffset = zip.readUInt32LE(p + 42);
    const rawName = zip.subarray(p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    const utf8 = (flags & 0x0800) !== 0;
    if (!utf8 && rawName.some((b) => b > 0x7e)) throw new PackageRefused('a file name that is not UTF-8');
    const name = rawName.toString('utf8');
    const pathCheck = checkEntryPath(name);
    if (!pathCheck.ok) throw new PackageRefused(`${pathCheck.reason}: ${JSON.stringify(name.slice(0, 80))}`);
    if ((flags & 0x0001) !== 0) throw new PackageRefused(`an encrypted file: ${name}`);
    if (startDisk !== 0) throw new PackageRefused('a multi-part zip is not accepted');
    if (madeBy >> 8 === 3 && ((extAttr >>> 16) & S_IFMT) === S_IFLNK) throw new PackageRefused(`a symbolic link: ${name}`);
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw new PackageRefused('a zip64 archive is not accepted');

    if (name.endsWith('/')) continue; // a folder
    const folded = name.normalize('NFC').toLowerCase();
    if (seen.has(folded)) throw new PackageRefused(`a file listed twice: ${name}`);
    seen.add(folded);
    if (isJunk(name)) continue;
    if (contentTypeOf(name) === null) {
      skipped.push(name);
      continue;
    }
    if (method !== 0 && method !== 8) throw new PackageRefused(`an unsupported compression method in ${name}`);
    if (usize > limits.maxEntryBytes) throw new PackageRefused(`a file over ${limits.maxEntryBytes} bytes: ${name}`);
    if (usize > 1024 * 1024 && usize / Math.max(1, csize) > limits.maxRatio) throw new PackageRefused(`a file that expands suspiciously: ${name}`);
    if (method === 0 && csize !== usize) throw new PackageRefused(`a damaged zip (stored size mismatch): ${name}`);
    totalBytes += usize;
    if (totalBytes > limits.maxTotalBytes) throw new PackageRefused(`more than ${limits.maxTotalBytes} bytes once unpacked`);

    // --- local header: where the bytes really start ---
    if (localOffset + 30 > cdOffset || zip.readUInt32LE(localOffset) !== LOC_SIG) throw new PackageRefused(`a damaged zip (bad local header): ${name}`);
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const localName = zip.subarray(localOffset + 30, localOffset + 30 + localNameLen);
    if (!localName.equals(rawName)) throw new PackageRefused(`a damaged zip (names disagree): ${name}`);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    if (dataOffset + csize > cdOffset) throw new PackageRefused(`a damaged zip (data out of place): ${name}`);

    // --- the real bytes: size and checksum ---
    const data = readEntryBytes(zip.subarray(dataOffset, dataOffset + csize), method as 0 | 8, usize);
    if (data.length !== usize || (crc32(data) >>> 0) !== crc) throw new PackageRefused(`a damaged zip (checksum): ${name}`);

    entries.push({ path: name, dataOffset, compressedSize: csize, size: usize, method: method as 0 | 8, crc32: crc });
  }

  const paths = new Set(entries.map((e) => e.path));
  let entry = ['index.html', 'index.htm'].find((x) => paths.has(x));
  if (!entry) {
    // One top folder holding index.html is the usual shape of an exported package.
    const tops = new Set(entries.map((e) => e.path.split('/')[0]));
    if (tops.size === 1) {
      const top = [...tops][0]!;
      entry = [`${top}/index.html`, `${top}/index.htm`].find((x) => paths.has(x));
    }
  }
  if (!entry) {
    if (paths.has('h5p.json')) {
      throw new PackageRefused('a raw .h5p file needs the H5P player: export it as HTML (e.g. with Lumi), or add it as a link');
    }
    throw new PackageRefused('no index.html at the top of the package');
  }
  return { entry, entries, skipped, totalBytes };
}

/** One entry's bytes from its compressed slice, never more than `size`. */
export function readEntryBytes(compressed: Buffer, method: 0 | 8, size: number): Buffer {
  if (method === 0) return compressed;
  try {
    return inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
  } catch {
    throw new PackageRefused('a damaged zip (cannot inflate)');
  }
}
