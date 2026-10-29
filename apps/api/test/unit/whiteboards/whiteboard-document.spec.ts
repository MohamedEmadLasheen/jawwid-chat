/**
 * PD-39: what a board page may hold (docs/product/pd039-whiteboard-design.md
 * §4.3, §4.5). The rules that matter most: a verse is a reference and never its
 * text, an image names an asset and never a key, and a page stays within 512 KB.
 */
import { PAGE_MAX_BYTES, PAGE_MAX_ELEMENTS, VERSE_MAX_AYAT, checkDocument } from '../../../src/whiteboards/whiteboard-document';

const SHA = 'a'.repeat(64);
const verse = (over: Record<string, unknown> = {}) => ({
  id: 'v1', kind: 'verse', surah: 1, fromAyah: 1, toAyah: 7, datasetId: 'tanzil-uthmani-1.1', rangeSha256: SHA, ...over,
});
const doc = (...elements: unknown[]) => ({ v: 1, elements });
const reason = (input: unknown) => {
  const r = checkDocument(input);
  return r.ok ? null : r.reason;
};

describe('a board page document', () => {
  it('accepts the MVP elements and reports the verses and assets it names', () => {
    const asset = '3f2c1a9e-0b1d-4c2e-9f00-1234567890ab';
    const r = checkDocument(doc(
      { id: 's1', kind: 'stroke', points: 'AAEC', style: { color: '#123456', width: 3 } },
      { id: 'h1', kind: 'highlight', points: 'AAEC' },
      { id: 't1', kind: 'text', text: 'بِسْمِ' },
      { id: 'st1', kind: 'stamp', text: 'ممتاز' },
      { id: 'a1', kind: 'arrow', from: [0, 0], to: [10, 10] },
      { id: 'i1', kind: 'image', assetId: asset.toUpperCase() },
      verse(),
    ));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assetIds).toEqual([asset]);
    expect(r.value.verses).toEqual([{ surah: 1, fromAyah: 1, toAyah: 7, datasetId: 'tanzil-uthmani-1.1', rangeSha256: SHA }]);
    expect(r.value.bytes).toBe(Buffer.byteLength(JSON.stringify(r.value.document)));
  });

  it('refuses a verse that carries its text, Basmala or anything but the reference', () => {
    for (const field of ['text', 'basmala', 'ayahs', 'html']) {
      expect(reason(doc(verse({ [field]: 'بِسْمِ اللَّهِ' })))).toMatch(/a verse is a reference, never its text/);
    }
  });

  it('refuses a verse outside the surah, reversed, too long, or without its dataset and hash', () => {
    expect(reason(doc(verse({ surah: 115 })))).toMatch(/surah/);
    expect(reason(doc(verse({ toAyah: 8 })))).toMatch(/ayat 1-7/);
    expect(reason(doc(verse({ fromAyah: 3, toAyah: 2 })))).toMatch(/from <= to/);
    expect(reason(doc(verse({ surah: 2, fromAyah: 1, toAyah: VERSE_MAX_AYAT + 1 })))).toMatch(new RegExp(`at most ${VERSE_MAX_AYAT} ayat`));
    expect(reason(doc(verse({ datasetId: undefined })))).toMatch(/datasetId/);
    expect(reason(doc(verse({ rangeSha256: 'ABC' })))).toMatch(/rangeSha256/);
  });

  it('refuses an image that names a key or a URL instead of an asset', () => {
    expect(reason(doc({ id: 'i1', kind: 'image', objectKey: 'whiteboards/x/y/z' }))).toMatch(/assetId/);
    expect(reason(doc({ id: 'i1', kind: 'image', assetId: '3f2c1a9e-0b1d-4c2e-9f00-1234567890ab', url: 'https://x' }))).toMatch(/never a key or a URL/);
  });

  it('refuses unknown kinds, repeated ids, extra fields and the wrong version', () => {
    expect(reason(doc({ id: 'x', kind: 'youtube' }))).toMatch(/kind/);
    expect(reason(doc({ id: 'x', kind: 'line' }, { id: 'x', kind: 'line' }))).toMatch(/used twice/);
    expect(reason(doc({ id: 'bad id', kind: 'line' }))).toMatch(/\.id/);
    expect(reason({ v: 1, elements: [], script: 'x' })).toMatch(/unknown field script/);
    expect(reason({ v: 2, elements: [] })).toMatch(/document\.v/);
    expect(reason([])).toMatch(/must be an object/);
  });

  it('caps a page at 512 KB and at its element count', () => {
    const big = 'x'.repeat(1900);
    const elements = Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, kind: 'text', text: big }));
    expect(reason(doc(...elements))).toMatch(new RegExp(`at most ${PAGE_MAX_BYTES}`));
    const many = Array.from({ length: PAGE_MAX_ELEMENTS + 1 }, (_, i) => ({ id: `l${i}`, kind: 'line' }));
    expect(reason(doc(...many))).toMatch(new RegExp(`at most ${PAGE_MAX_ELEMENTS}`));
  });
});
