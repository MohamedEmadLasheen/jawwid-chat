import { describe, expect, it } from 'vitest';
import { BUILD_ANCHOR, QuranRefused, loadSurah, type Ayah } from './dataset';
import { BASMALA_SHA256 } from './basmala';
import { sha256Hex } from './sha256';
import { BASMALA, snapshot } from '../test/fixtures';

describe('the engine shows only the verified, pinned text', () => {
  it('accepts the pinned snapshot: numbered 1..n, every verse hashing to its sha256', async () => {
    const { fetcher, anchor } = await snapshot(85, 22, { basmala: true });
    const s = await loadSurah(85, fetcher, anchor);
    expect(s.ayahs).toHaveLength(22);
    expect(s.ayahs[0]).toMatchObject({ ayah: 1, basmala: BASMALA, text: 'verse 85:1' });
  });

  it("the fixture's Basmala is the accepted plain spelling, by hash (it is not trusted as typed)", async () => {
    expect(BASMALA_SHA256.has(await sha256Hex(BASMALA))).toBe(true);
  });

  it('refuses a snapshot of another dataset or another file', async () => {
    const { files, fetcher, anchor } = await snapshot(85, 22, { basmala: true });
    (files['/data/quran/manifest.json'] as { fileSha256: string }).fileSha256 = 'f'.repeat(64);
    await expect(loadSurah(85, fetcher, anchor)).rejects.toBeInstanceOf(QuranRefused);
  });

  it('refuses everything when the build carries no trust anchor', async () => {
    const { fetcher } = await snapshot(85, 22, { basmala: true });
    expect(BUILD_ANCHOR).toBeNull();
    await expect(loadSurah(85, fetcher)).rejects.toThrow(/no trust anchor/);
  });

  it('refuses a snapshot rebuilt on the host after the build, even one that is consistent with itself', async () => {
    const built = await snapshot(85, 22, { basmala: true });
    const swapped = await snapshot(85, 22, { basmala: true, texts: Array.from({ length: 22 }, (_, i) => `other ${i}`) });
    await expect(loadSurah(85, swapped.fetcher, swapped.anchor)).resolves.toBeDefined();
    await expect(loadSurah(85, swapped.fetcher, built.anchor)).rejects.toThrow(/not the one this build was made from/);
  });

  it('refuses a tampered verse, a missing ayah, a stray Basmala and a changed range', async () => {
    const tamper = async (change: (ayahs: Ayah[]) => void) => {
      const { files, fetcher, anchor } = await snapshot(85, 22, { basmala: true });
      change((files['/data/quran/surah-085.json'] as { ayahs: Ayah[] }).ayahs);
      return loadSurah(85, fetcher, anchor);
    };
    await expect(tamper((a) => { a[3]!.text = 'changed'; })).rejects.toThrow(/does not match its hash/);
    await expect(tamper((a) => { a.pop(); })).rejects.toThrow(/21 ayat, expected 22/);
    await expect(tamper((a) => { a[4]!.basmala = BASMALA; })).rejects.toThrow(/carries a Basmala/);
    await expect(tamper((a) => { [a[0], a[1]] = [a[1]!, a[0]!]; })).rejects.toThrow(/missing|hash/);
  });

  it('refuses a missing Basmala, or one that is not an accepted spelling', async () => {
    const missing = await snapshot(85, 22);
    await expect(loadSurah(85, missing.fetcher, missing.anchor)).rejects.toThrow(/not an accepted spelling/);
    const { files, fetcher, anchor } = await snapshot(85, 22, { basmala: true });
    (files['/data/quran/surah-085.json'] as { ayahs: Ayah[] }).ayahs[0]!.basmala = BASMALA.slice(0, -1);
    await expect(loadSurah(85, fetcher, anchor)).rejects.toThrow(/not an accepted spelling/);
  });

  it('refuses a Basmala on 9:1 and on 1:1, and needs none there', async () => {
    for (const s of [1, 9]) {
      const withOne = await snapshot(s, 7, { basmala: true });
      await expect(loadSurah(s, withOne.fetcher, withOne.anchor)).rejects.toThrow(/carries a Basmala/);
      const without = await snapshot(s, 7);
      await expect(loadSurah(s, without.fetcher, without.anchor)).resolves.toBeDefined();
    }
  });
});
