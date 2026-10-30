import { expect, test, type Page } from '@playwright/test';

/**
 * PD-49 P0 (owner, 2026-10-29): every verse is drawn in Amiri Quran, never in a fallback font.
 * A fallback once drew the shadda and dagger alef of ٱللَّهُ as a tanween. Asserted, not
 * pixel-compared:
 *   - the browser loaded the Amiri Quran face, and document.fonts.check says so;
 *   - every verse element's computed font-family is Amiri Quran;
 *   - a shaping probe: the first verse on the page, measured in Amiri Quran, differs from the same
 *     text in a serif fallback, so a silent fallback cannot pass.
 * Every string probed is the page's own verified text, never one typed here (marks typed by hand
 * can come in another order than the dataset's).
 * Screenshots are attached for a person to review (CI uploads test-results/).
 */
const VERSES = '.ayah__text, .basmala, .play-card__verse, .card__text, .complete__verse, .quiz__quran';

async function drawnInAmiriQuran(page: Page, shot: string) {
  await page.waitForSelector('.ayah__text');
  const r = await page.evaluate(async (selector) => {
    await document.fonts.ready;
    const faces = Array.from(document.fonts).map((f) => `${f.family.replace(/["']/g, '')}:${f.status}`);
    const families = Array.from(document.querySelectorAll(selector)).map((e) => getComputedStyle(e).fontFamily.replace(/["']/g, ''));
    const probe = document.querySelector(selector)!.firstChild!.textContent!;
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = '48px "Amiri Quran"';
    const amiri = ctx.measureText(probe).width;
    ctx.font = '48px serif';
    const serif = ctx.measureText(probe).width;
    return { faces, check: document.fonts.check('1em "Amiri Quran"'), families, amiri, serif };
  }, VERSES);
  expect(r.faces).toContain('Amiri Quran:loaded');
  expect(r.check).toBe(true);
  expect(r.families.length).toBeGreaterThan(0);
  expect([...new Set(r.families)]).toEqual(['Amiri Quran']);
  expect(Math.abs(r.amiri - r.serif)).toBeGreaterThan(1);
  await page.screenshot({ path: `test-results/${shot}.png`, fullPage: false });
}

test('Al-Fatihah', async ({ page }) => {
  await page.goto('/lessons/quran/surah-1');
  await drawnInAmiriQuran(page, 'al-fatihah');
});

test('Al-Ikhlas, the Name with its shadda', async ({ page }) => {
  await page.goto('/lessons/quran/surah-112');
  // The Name, as the verified text writes it: alef wasla, lam, lam, shadda, fatha, ha, damma.
  const name = String.fromCodePoint(0x671, 0x644, 0x644, 0x651, 0x64e, 0x647, 0x64f);
  await expect(page.locator('.ayah__text').first()).toContainText(name);
  await drawnInAmiriQuran(page, 'al-ikhlas');
});

test('Al-Baqarah 2:5, an ayah with a pause mark', async ({ page }) => {
  await page.goto('/lessons/quran/surah-2');
  const ayah = page.locator('.ayah__text', { hasText: 'ٱلْمُفْلِحُونَ' }).first();
  await expect(ayah).toContainText('ۖ');
  await ayah.scrollIntoViewIfNeeded();
  await drawnInAmiriQuran(page, 'al-baqarah-5');
});

test('Al-Baqarah 2:255, Ayat al-Kursi', async ({ page }) => {
  await page.goto('/lessons/quran/surah-2');
  // Ayat 241-260 are the thirteenth page of twenty.
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'التالي' }).first().click();
  const kursi = page.locator('li', { has: page.locator('[aria-label="الآية 255"]') }).locator('.ayah__text');
  await kursi.scrollIntoViewIfNeeded();
  await drawnInAmiriQuran(page, 'al-baqarah-255');
});

test('if the font cannot load, no verse is drawn: a calm message and a retry, which then works', async ({ page }) => {
  await page.route('**/*.ttf', (route) => route.abort());
  await page.goto('/lessons/quran/surah-112');
  await expect(page.getByRole('alert')).toHaveText('تعذّر تحميل خطّ المصحف.');
  await expect(page.locator(VERSES)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/font-failed.png' });
  await page.unroute('**/*.ttf');
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
  await drawnInAmiriQuran(page, 'after-retry');
});
