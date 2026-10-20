import { crc32 } from 'node:zlib';

/** Where the archive goes: a response, or a buffer in a test. */
export interface ZipSink {
  write(chunk: Uint8Array): boolean | Promise<void> | void;
}

/**
 * A minimal streaming ZIP writer: STORED entries (no compression -- photos,
 * voice notes and video are compressed already), UTF-8 names (Arabic file
 * names survive), each entry written as soon as it is added. No ZIP64, so an
 * archive stays below 4 GiB; `fits` tells the caller before it adds an entry.
 *
 * Every entry's bytes are in memory while it is written (the CRC goes in the
 * local header, which keeps the archive readable by every unzipper); an entry
 * is one attachment, so that is bounded by the attachment size limit.
 */
export class ZipWriter {
  static readonly MAX_BYTES = 0xffff_fff0;
  private offset = 0;
  private readonly central: Buffer[] = [];
  private count = 0;

  constructor(private readonly sink: ZipSink) {}

  /** Bytes written so far. */
  get size(): number {
    return this.offset;
  }

  /** Whether an entry of this name and size still fits under the 4 GiB limit. */
  fits(name: string, byteSize: number): boolean {
    const nameBytes = Buffer.byteLength(name);
    const centralSoFar = this.central.reduce((n, b) => n + b.length, 0);
    const after = this.offset + 30 + nameBytes + byteSize + centralSoFar + 46 + nameBytes + 22;
    return this.count < 0xffff && after < ZipWriter.MAX_BYTES;
  }

  async add(name: string, data: Buffer, modified: Date): Promise<void> {
    if (!this.fits(name, data.length)) throw new Error('zip: entry does not fit');
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosDateTime(modified);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
    entry.writeUInt32LE(this.offset, 42);
    this.central.push(Buffer.concat([entry, nameBytes]));
    this.count += 1;

    await this.emit(local);
    await this.emit(nameBytes);
    await this.emit(data);
  }

  async finish(): Promise<void> {
    const start = this.offset;
    for (const c of this.central) await this.emit(c);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.emit(end);
  }

  private async emit(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    await this.sink.write(chunk);
  }
}

/** MS-DOS date and time, in the zone the clock reads (UTC on the server). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}
