import { describe, expect, it } from 'vitest';
import { QuranRefused, loadSurah, type Ayah } from './dataset';
import { snapshot } from '../test/fixtures';

describe('the engine shows only the verified, pinned text', () => {
  it('accepts the pinned snapshot: numbered 1..n, every verse hashing to its sha256', async () => {
    const { fetcher } = await snapshot(85, 22, { basmala: true });
    const s = await loadSurah(85, fetcher);
    expect(s.ayahs).toHaveLength(22);
    expect(s.ayahs[0]).toMatchObject({ ayah: 1, basmala: 'BASMALA', text: 'verse 85:1' });
  });

  it('refuses a snapshot of another dataset or another file', async () => {
    const { files, fetcher } = await snapshot(85, 22);
    (files['/data/quran/manifest.json'] as { fileSha256: string }).fileSha256 = 'f'.repeat(64);
    await expect(loadSurah(85, fetcher)).rejects.toBeInstanceOf(QuranRefused);
  });

  it('refuses a tampered verse, a missing ayah, a stray Basmala and a changed range', async () => {
    const tamper = async (change: (ayahs: Ayah[]) => void) => {
      const { files, fetcher } = await snapshot(85, 22);
      change((files['/data/quran/surah-085.json'] as { ayahs: Ayah[] }).ayahs);
      return loadSurah(85, fetcher);
    };
    await expect(tamper((a) => { a[3]!.text = 'changed'; })).rejects.toThrow(/does not match its hash/);
    await expect(tamper((a) => { a.pop(); })).rejects.toThrow(/21 ayat, expected 22/);
    await expect(tamper((a) => { a[4]!.basmala = 'BASMALA'; })).rejects.toThrow(/carries a Basmala/);
    await expect(tamper((a) => { [a[0], a[1]] = [a[1]!, a[0]!]; })).rejects.toThrow(/missing|hash/);
  });

  it('refuses a Basmala on 9:1 and on 1:1', async () => {
    for (const s of [1, 9]) {
      const { fetcher } = await snapshot(s, 7, { basmala: true });
      await expect(loadSurah(s, fetcher)).rejects.toThrow(/carries a Basmala/);
    }
  });
});
