/**
 * Profile photos are judged by their BYTES, not by the type a client declared.
 *
 * The PNGs here are real, encoded with zlib, so the PNG path is tested against
 * the format and not against a shape this file invented. JPEG and WebP are
 * built header-first: the inspector reads only container headers, and these
 * fixtures carry exactly those headers, byte for byte as the specs define them.
 */
import {
  MAX_AVATAR_BYTES,
  inspectImage,
  judgeAvatar,
} from '../../../src/staff-profile/image-inspection';
import { avatarKeyBelongsTo } from '../../../src/staff-profile/staff-profile.service';
import { png } from '../../support/images';

function jpeg(width: number, height: number, exifBytes = 0): Buffer {
  const app1 = exifBytes
    ? Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exifBytes + 2), Buffer.alloc(exifBytes)])
    : Buffer.alloc(0);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0]), u16(17), Buffer.from([8]), u16(height), u16(width), Buffer.alloc(10)]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]);
}
function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}
function webpLossy(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8 ', 12, 'latin1');
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(width, 26);
  b.writeUInt16LE(height, 28);
  return b;
}
function webpExtended(width: number, height: number, animated: boolean): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b[20] = animated ? 0x02 : 0;
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}
function webpLossless(width: number, height: number): Buffer {
  const b = Buffer.alloc(25);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8L', 12, 'latin1');
  b[20] = 0x2f;
  const w = width - 1;
  const h = height - 1;
  const bits = (w & 0x3fff) | ((h & 0x3fff) << 14);
  b.writeUInt32LE(bits >>> 0, 21);
  return b;
}

describe('inspectImage reads the real container', () => {
  it('PNG, JPEG (even behind a large EXIF block) and all three WebP flavours', () => {
    expect(inspectImage(png(200, 120))).toEqual({ mime: 'image/png', width: 200, height: 120, animated: false });
    expect(inspectImage(jpeg(640, 480, 60_000))).toEqual({ mime: 'image/jpeg', width: 640, height: 480, animated: false });
    expect(inspectImage(webpLossy(300, 301))).toMatchObject({ mime: 'image/webp', width: 300, height: 301 });
    expect(inspectImage(webpLossless(512, 256))).toMatchObject({ mime: 'image/webp', width: 512, height: 256 });
    expect(inspectImage(webpExtended(800, 600, false))).toMatchObject({ mime: 'image/webp', width: 800, height: 600 });
  });

  it('flags animation', () => {
    expect(inspectImage(png(100, 100, { animated: true }))?.animated).toBe(true);
    expect(inspectImage(webpExtended(100, 100, true))?.animated).toBe(true);
  });

  it('returns null -- never throws -- for anything else or a truncated header', () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    const gif = Buffer.from('GIF89a\x10\x00\x10\x00', 'latin1');
    for (const b of [html, gif, Buffer.alloc(0), png(100, 100).subarray(0, 20), jpeg(100, 100).subarray(0, 6), webpLossy(100, 100).subarray(0, 20)]) {
      expect(() => inspectImage(b)).not.toThrow();
      expect(inspectImage(b)).toBeNull();
    }
  });
});

describe('judgeAvatar is the acceptance rule', () => {
  const ok = (head: Buffer, declaredMime: string) => judgeAvatar({ head, byteSize: head.length, declaredMime });

  it('accepts a real image whose bytes match the declared type', () => {
    expect(ok(png(256, 256), 'image/png').ok).toBe(true);
    expect(ok(jpeg(512, 512), 'image/jpeg').ok).toBe(true);
    expect(ok(webpLossy(512, 512), 'image/webp').ok).toBe(true);
  });

  it('refuses HTML uploaded as image/png', () => {
    expect(ok(Buffer.from('<html><script>x</script></html>'), 'image/png')).toEqual({ ok: false, reason: 'unrecognized' });
  });

  it('refuses a real PNG declared as JPEG (the bytes decide)', () => {
    expect(ok(png(256, 256), 'image/jpeg')).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('refuses animation, tiny and huge dimensions, empty and oversized objects', () => {
    expect(ok(png(256, 256, { animated: true }), 'image/png')).toEqual({ ok: false, reason: 'animated' });
    expect(ok(png(32, 256), 'image/png')).toEqual({ ok: false, reason: 'too_small' });
    expect(ok(jpeg(5000, 300), 'image/jpeg')).toEqual({ ok: false, reason: 'too_large_dimensions' });
    expect(judgeAvatar({ head: Buffer.alloc(0), byteSize: 0, declaredMime: 'image/png' })).toEqual({ ok: false, reason: 'empty' });
    expect(judgeAvatar({ head: png(256, 256), byteSize: MAX_AVATAR_BYTES + 1, declaredMime: 'image/png' })).toEqual({
      ok: false,
      reason: 'too_large_bytes',
    });
  });
});

describe('an avatar key belongs to exactly one profile', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const uuid = '33333333-3333-4333-8333-333333333333';

  it('accepts only avatars/staff/<this id>/<uuid>', () => {
    expect(avatarKeyBelongsTo(id, `avatars/staff/${id}/${uuid}`)).toBe(true);
  });

  it('refuses another profile\'s key, prefix tricks, traversal and other namespaces', () => {
    for (const key of [
      `avatars/staff/${other}/${uuid}`,
      `avatars/staff/${id}${uuid}/${uuid}`,
      `avatars/staff/${id}/../${other}/${uuid}`,
      `avatars/staff/${id}/${uuid}/extra`,
      `avatars/staff/${id}/not-a-uuid`,
      `avatars/contact/${id}/${uuid}`,
      `conversations/${id}/${uuid}`,
      `/avatars/staff/${id}/${uuid}`,
      '',
    ]) {
      expect(avatarKeyBelongsTo(id, key)).toBe(false);
    }
  });
});
