import dataset from './dataset.json';

/**
 * PD-45: the countries a family may live in -- the codes chat.geo_country is
 * seeded with (dataset.json is generated from the pinned CLDR files by
 * scripts/geo/build-dataset.py; the migration spec proves the two agree).
 *
 * Every writer of chat.family.country_code asks here first, so a code that is
 * not a country (UK, ZZ, or one ISO only reserves) is a 400 that says what to
 * send, never the foreign key's 500.
 */
const COUNTRIES: ReadonlySet<string> = new Set(dataset.countries.map((c) => c.code));

/** The upper-case ISO 3166-1 code when `value` is a country of the list, else null. */
export function listedCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && COUNTRIES.has(code) ? code : null;
}

export function invalidCountryMessage(field: string): string {
  return `${field}: a country's ISO 3166-1 alpha-2 code, e.g. EG or AE (the United Kingdom is GB), or null`;
}

/** A write the database refused because a code was not in its list (chat.geo_country / chat.geo_subdivision). */
export function isGeoForeignKeyViolation(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { field_name?: unknown }; message?: unknown } | null;
  if (!err) return false;
  const text = `${String(err.meta?.field_name ?? '')} ${String(err.message ?? '')}`;
  return (err.code === 'P2003' || err.code === '23503') && /country_listed|subdivision_in_country/.test(text);
}
