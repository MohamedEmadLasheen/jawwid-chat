import { invalidCountryMessage, listedCountry } from '../geo/countries';
import { hasSubdivisions, locationOf, parseLocationPatch, type LocationValue } from '../geo/location';
import { CommError, CommErrorCode } from '../platform/errors';
import { suggestedCountryFromPhone } from './parent-phone-directory';

/**
 * PD-45 PR-4 (plan §5.4): what `GET /me/location` answers a parent, and what
 * `PUT /me/location` accepts. Pure.
 *
 * The answer holds the family's two codes, their names, whether the one-time
 * prompt is due, and -- while the family has no country -- a country suggested
 * from the parent's own number. Never the number itself (G-07), never the
 * Parent Profile (the Contact File rule).
 */
export interface MyLocationView {
  countryCode: string | null;
  subdivisionCode: string | null;
  /** "مصر · الجيزة" / "Egypt · Giza"; null with no country. */
  location: { ar: string; en: string } | null;
  /** The one-time prompt is due (§6.1 b). */
  prompt: boolean;
  /** Only while the family has no country, and only from an international number (§6.2). Absent otherwise. */
  suggestedCountryCode?: string;
}

const SEPARATOR = ' · ';

/** The location as the parent reads it, in both languages. */
export function locationNames(countryCode: string | null, subdivisionCode: string | null): { ar: string; en: string } | null {
  const l = locationOf(countryCode, subdivisionCode);
  if (!l) return null;
  return {
    ar: l.subdivision ? `${l.country.ar}${SEPARATOR}${l.subdivision.ar}` : l.country.ar,
    en: l.subdivision ? `${l.country.en}${SEPARATOR}${l.subdivision.en}` : l.country.en,
  };
}

/**
 * Not complete -- the Parents list's "Missing location" rule (§5.2): no
 * country, a code that is not a country of the list, or a country with
 * subdivisions and none chosen.
 */
export function locationIncomplete(countryCode: string | null, subdivisionCode: string | null): boolean {
  if (!countryCode || listedCountry(countryCode) !== countryCode) return true;
  return subdivisionCode === null && hasSubdivisions(countryCode);
}

export function presentMyLocation(input: {
  countryCode: string | null;
  subdivisionCode: string | null;
  /** This contact answered the prompt (Save or Later). */
  answered: boolean;
  /** This contact's own number on file; only a suggested country code leaves this function. */
  phone: string | null;
}): MyLocationView {
  const suggested = input.countryCode ? null : suggestedCountryFromPhone(input.phone);
  return {
    countryCode: input.countryCode,
    subdivisionCode: input.subdivisionCode,
    location: locationNames(input.countryCode, input.subdivisionCode),
    prompt: !input.answered && locationIncomplete(input.countryCode, input.subdivisionCode),
    ...(suggested ? { suggestedCountryCode: suggested } : {}),
  };
}

/**
 * `PUT /me/location { countryCode, subdivisionCode? }`: the family's whole
 * location. The country is required -- a parent sets their location, never
 * erases it; a subdivision left out or null is none. Any other field (an id,
 * above all) is ignored: the family is always the caller's own.
 */
export function parseMyLocation(body: unknown): LocationValue {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('the body is { countryCode, subdivisionCode }');
  }
  const b = body as Record<string, unknown>;
  if (listedCountry(b.countryCode) === null) throw invalid(invalidCountryMessage('countryCode').replace(/, or null$/, ''));
  const parsed = parseLocationPatch(
    { countryCode: b.countryCode, subdivisionCode: b.subdivisionCode === undefined ? null : b.subdivisionCode },
    { countryCode: null, subdivisionCode: null },
  );
  // Both fields are given, so the patch is always a value.
  return parsed!;
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}
