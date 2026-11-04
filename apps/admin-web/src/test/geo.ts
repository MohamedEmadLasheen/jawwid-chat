/**
 * PD-45: a small, synthetic copy of what GET /geo/countries and
 * GET /geo/countries/:cc/subdivisions answer (apps/api/src/geo/location.ts),
 * for the Admin Web tests. Real names, a handful of countries: Egypt and the
 * UAE (pinned, with subdivisions), the US (several zones), France and Austria
 * (not pinned; Austria has none in this fixture), so order, search and the
 * per-country label can be proven.
 */
export interface FixtureCountry {
  code: string
  en: string
  ar: string
  label: { en: string; ar: string }
  hasSubdivisions: boolean
  pinned: number | null
}

const REGION = { en: 'Region', ar: 'المنطقة' }

export const GEO_COUNTRIES: FixtureCountry[] = [
  { code: 'AE', en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة', label: { en: 'Emirate', ar: 'الإمارة' }, hasSubdivisions: true, pinned: 2 },
  { code: 'AT', en: 'Austria', ar: 'النمسا', label: REGION, hasSubdivisions: false, pinned: null },
  { code: 'EG', en: 'Egypt', ar: 'مصر', label: { en: 'Governorate', ar: 'المحافظة' }, hasSubdivisions: true, pinned: 0 },
  { code: 'FR', en: 'France', ar: 'فرنسا', label: REGION, hasSubdivisions: true, pinned: null },
  { code: 'SA', en: 'Saudi Arabia', ar: 'المملكة العربية السعودية', label: { en: 'Province', ar: 'المنطقة' }, hasSubdivisions: true, pinned: 1 },
  { code: 'US', en: 'United States', ar: 'الولايات المتحدة', label: { en: 'State', ar: 'الولاية' }, hasSubdivisions: true, pinned: null },
]

export const GEO_SUBDIVISIONS: Record<string, Array<{ code: string; en: string; ar: string }>> = {
  EG: [
    { code: 'EG-GZ', en: 'Giza', ar: 'الجيزة' },
    { code: 'EG-C', en: 'Cairo', ar: 'القاهرة' },
    { code: 'EG-ALX', en: 'Alexandria', ar: 'الإسكندرية' },
  ],
  AE: [
    { code: 'AE-DU', en: 'Dubai', ar: 'دبي' },
    { code: 'AE-AZ', en: 'Abu Dhabi', ar: 'أبو ظبي' },
  ],
  SA: [{ code: 'SA-01', en: 'Riyadh', ar: 'الرياض' }],
  FR: [{ code: 'FR-IDF', en: 'Île-de-France', ar: 'إيل دو فرانس' }],
  US: [{ code: 'US-CA', en: 'California', ar: 'كاليفورنيا' }],
}

type Json = (body: unknown, status?: number) => Response

/** Registers the two geo routes on a test's fetch router (`on(method, pattern, handler)`). */
export function mockGeo(on: (method: string, pattern: RegExp, handler: (url: string) => Response) => void, json: Json): void {
  on('GET', /\/geo\/countries$/, () => json({ version: 'cldr-49+overlay-test', defaultLabel: REGION, countries: GEO_COUNTRIES }))
  on('GET', /\/geo\/countries\/([A-Za-z]{2})\/subdivisions$/, (url) => {
    const cc = /\/geo\/countries\/([A-Za-z]{2})\//.exec(url)![1]!.toUpperCase()
    const c = GEO_COUNTRIES.find((x) => x.code === cc)
    return c
      ? json({ version: 'cldr-49+overlay-test', country: cc, label: c.label, subdivisions: GEO_SUBDIVISIONS[cc] ?? [] })
      : json({ error: { code: 'COMM.VALIDATION', message: 'country: not a country of the list' } }, 400)
  })
}
