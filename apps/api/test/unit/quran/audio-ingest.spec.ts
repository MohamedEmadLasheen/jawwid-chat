/**
 * Audio is never served unverified: an ayah's audio row is written only by the
 * server's ingest, which reads the stored object and computes its SHA-256 and
 * size itself. There is no parameter for a caller-supplied hash.
 */
import { createHash } from 'node:crypto';
import type { ObjectStorage, StoredObject } from '../../../src/communication/attachments/object-storage';
import { ingestAyahAudio, type AudioRowWriter } from '../../../src/quran/audio-ingest';
import { audioKey } from '../../../src/quran/audio-key';

function storageWith(objects: Record<string, { mimeType: string; body: Buffer | AsyncIterable<Uint8Array> }>): ObjectStorage {
  return {
    async read(key: string): Promise<StoredObject | null> {
      const o = objects[key];
      if (!o) return null;
      const size = Buffer.isBuffer(o.body) ? o.body.length : 0;
      return { mimeType: o.mimeType, size, range: null, body: o.body };
    },
  } as unknown as ObjectStorage;
}

class Writer implements AudioRowWriter {
  rows: Array<Record<string, unknown>> = [];
  async insert(row: { reciter: string; surah: number; ayah: number; sha256: string; byteSize: number; durationMs: number | null }) {
    this.rows.push(row);
  }
}

const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(400, 7)]);

describe('ingestAyahAudio', () => {
  it('hashes the stored object itself and writes that hash, under the ayah\'s own key', async () => {
    const key = audioKey('alafasy-128', 85, 3);
    const writer = new Writer();
    const row = await ingestAyahAudio(storageWith({ [key]: { mimeType: 'audio/mpeg', body: MP3 } }), writer, 'alafasy-128', 85, 3);
    const sha = createHash('sha256').update(MP3).digest('hex');
    expect(row).toEqual({ reciter: 'alafasy-128', surah: 85, ayah: 3, key, sha256: sha, byteSize: MP3.length, durationMs: null });
    expect(writer.rows).toEqual([{ reciter: 'alafasy-128', surah: 85, ayah: 3, sha256: sha, byteSize: MP3.length, durationMs: null }]);
  });

  it('hashes a streamed object the same way', async () => {
    const key = audioKey('alafasy-128', 1, 1);
    async function* chunks() { yield MP3.subarray(0, 100); yield MP3.subarray(100); }
    const writer = new Writer();
    const row = await ingestAyahAudio(storageWith({ [key]: { mimeType: 'audio/mpeg', body: chunks() } }), writer, 'alafasy-128', 1, 1);
    expect(row.sha256).toBe(createHash('sha256').update(MP3).digest('hex'));
    expect(row.byteSize).toBe(MP3.length);
  });

  it('refuses a missing object, a non-audio object, an empty one and an ayah that does not exist', async () => {
    const writer = new Writer();
    await expect(ingestAyahAudio(storageWith({}), writer, 'alafasy-128', 85, 3)).rejects.toThrow(/not in storage/);
    const key = audioKey('alafasy-128', 85, 3);
    await expect(ingestAyahAudio(storageWith({ [key]: { mimeType: 'text/html', body: MP3 } }), writer, 'alafasy-128', 85, 3)).rejects.toThrow(/not audio/);
    await expect(ingestAyahAudio(storageWith({ [key]: { mimeType: 'audio/mpeg', body: Buffer.alloc(0) } }), writer, 'alafasy-128', 85, 3)).rejects.toThrow(/empty/);
    await expect(ingestAyahAudio(storageWith({}), writer, 'alafasy-128', 89, 31)).rejects.toThrow(/no ayah/);
    expect(writer.rows).toEqual([]);
  });
});
