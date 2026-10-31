import dataset from './dataset.json';
import { invalidCountryMessage, listedCountry } from './countries';
import { CommError, CommErrorCode } from '../platform/errors';

/**
 * PD-45 (docs/product/pd045-parent-location-plan.md §3, §5.1): what the
 * location pickers read, and the one rule every writer of a family's location
 * applies -- a subdivision is always one of its country's.
 *
 * The names come from dataset.json (generated from the pinned CLDR files and
 * the reviewed overlay); chat.geo_country / chat.geo_subdivision hold the same
 * codes, and their foreign keys refuse anything else.
 */
export interface Names { en: string; ar: string }
export interface CountryEntry extends Names { code: string; label: Names; hasSubdivisions: boolean; pinned: number | null }
export interface Subdivision extends Names { code: string }

type DatasetCountry = (typeof dataset.countries)[number];

const BY_CODE: ReadonlyMap<string, DatasetCountry> = new Map(dataset.countries.map((c) => [c.code, c]));
const DEFAULT_LABEL: Names = dataset.defaultLabel;

const labelOf = (c: DatasetCountry): Names => c.label ?? DEFAULT_LABEL;

/** Every country, with its field label and whether it has subdivisions. The client sorts by name in its own language. */
export function countryList(): { version: string; defaultLabel: Names; countries: CountryEntry[] } {
  return {
    version: dataset.version,
    defaultLabel: DEFAULT_LABEL,
    countries: dataset.countries.map((c) => ({
      code: c.code,
      en: c.en,
      ar: c.ar,
      label: labelOf(c),
      hasSubdivisions: c.subdivisions.length > 0,
      pinned: dataset.pinned.indexOf(c.code) >= 0 ? dataset.pinned.indexOf(c.code) : null,
    })),
  };
}

/** A country's first-level subdivisions, or null when it is not a country of the list. */
export function subdivisionsOf(country: unknown): { version: string; country: string; label: Names; subdivisions: Subdivision[] } | null {
  const code = listedCountry(country);
  const c = code ? BY_CODE.get(code) : undefined;
  if (!c) return null;
  return { version: dataset.version, country: c.code, label: labelOf(c), subdivisions: c.subdivisions.map((s) => ({ ...s })) };
}

/** Whether a listed country has subdivisions to choose from. */
export function hasSubdivisions(country: string): boolean {
  return (BY_CODE.get(country)?.subdivisions.length ?? 0) > 0;
}

/**
 * A family's location as it reads: names in both languages and the field's
 * label. A legacy code that is not a country of the list stays readable as
 * itself until PR-5's backfill cleans it.
 */
export function locationOf(countryCode: string | null, subdivisionCode: string | null) {
  if (!countryCode) return null;
  const c = BY_CODE.get(countryCode);
  const s = c && subdivisionCode ? c.subdivisions.find((x) => x.code === subdivisionCode) : undefined;
  return {
    country: { code: countryCode, en: c?.en ?? countryCode, ar: c?.ar ?? countryCode },
    subdivision: s ? { code: s.code, en: s.en, ar: s.ar } : null,
    label: c ? labelOf(c) : DEFAULT_LABEL,
  };
}

export interface LocationValue { countryCode: string | null; subdivisionCode: string | null }

/**
 * A change to a family's location, from a body that may carry `countryCode`
 * and / or `subdivisionCode` (null clears). Undefined when it carries neither.
 * A new country without a subdivision keeps the current one only when it is
 * the new country's; a subdivision alone must be the family's country's.
 */
export function parseLocationPatch(body: Record<string, unknown>, current: LocationValue): LocationValue | undefined {
  const hasCountry = 'countryCode' in body;
  const hasSubdivision = 'subdivisionCode' in body;
  if (!hasCountry && !hasSubdivision) return undefined;

  let countryCode = current.countryCode;
  if (hasCountry) {
    countryCode = body.countryCode === null ? null : listedCountry(body.countryCode);
    if (body.countryCode !== null && countryCode === null) throw invalid(invalidCountryMessage('countryCode'));
  }

  let subdivisionCode: string | null;
  if (hasSubdivision) {
    subdivisionCode = body.subdivisionCode === null ? null : subdivisionOf(countryCode, body.subdivisionCode);
  } else {
    const keep = current.subdivisionCode;
    subdivisionCode = keep && countryCode && BY_CODE.get(countryCode)?.subdivisions.some((s) => s.code === keep) ? keep : null;
  }
  return { countryCode, subdivisionCode };
}

function subdivisionOf(countryCode: string | null, value: unknown): string {
  if (typeof value !== 'string') throw invalid('subdivisionCode: an ISO 3166-2 code, e.g. EG-GZ, or null');
  if (!countryCode) throw invalid('subdivisionCode: a subdivision needs a country');
  const code = value.trim().toUpperCase();
  const c = BY_CODE.get(countryCode);
  if (!c || !c.subdivisions.some((s) => s.code === code)) {
    throw invalid(`subdivisionCode: not one of ${c?.en ?? countryCode}'s, e.g. ${c?.subdivisions[0]?.code ?? 'none'}`);
  }
  return code;
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}
