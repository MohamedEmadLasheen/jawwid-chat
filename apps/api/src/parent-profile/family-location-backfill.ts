import type { PrismaClient } from '@prisma/client';
import { listedCountry } from '../geo/countries';
import { matchRegion } from '../geo/region-match';

/**
 * PD-45 PR-5 (docs/product/pd045-parent-location-plan.md §6.3): read each
 * family's old free-text region (chat.parent_file.region) as a subdivision of
 * its country, and report what could not be.
 *
 *   1. A country_code that is not a country of the list (G4: the "other" box
 *      and Stories took any two letters) goes on the report as "fix by hand".
 *      It is never rewritten. PR-5's VALIDATE CONSTRAINT waits for zero.
 *   2. A family with a country and a region, and NO location set by anyone
 *      (no subdivision, no location_source), gets the subdivision only when
 *      EVERY region its parents wrote equals exactly one and the same
 *      subdivision of that country (geo/region-match.ts). It is written with
 *      location_source = 'backfill' and no actor. A location a staff member or
 *      the parent set -- even a country alone -- is never touched.
 *   3. The report is counts and family ids. Never a name, a phone, an e-mail or
 *      any region text (G-07 hygiene).
 *
 * Idempotent: a second --apply finds every applied family already set and
 * writes nothing. A dry run (the default) writes nothing. The UPDATE repeats
 * the "nobody set it" condition, so a staff edit between the read and the write
 * is never overwritten.
 *
 * Lives in src/parent-profile: it reads chat.parent_file (G-07,
 * parent-file-confinement.spec.ts) and names the location columns
 * (family-location-confinement.spec.ts).
 */
export interface FamilyLocationSource {
  familyId: string;
  countryCode: string | null;
  subdivisionCode: string | null;
  locationSource: string | null;
  /** The non-empty regions of the family's active parents' files. */
  regions: string[];
}

export type FamilyOutcome =
  | { kind: 'invalid-country' }
  | { kind: 'no-country' }
  | { kind: 'already-set' }
  | { kind: 'no-region' }
  | { kind: 'matched'; countryCode: string; subdivisionCode: string }
  | { kind: 'ambiguous' }
  | { kind: 'unmatched' };

/** What to do with one family. Pure. */
export function planFamily(f: FamilyLocationSource): FamilyOutcome {
  if (f.countryCode !== null && listedCountry(f.countryCode) !== f.countryCode) return { kind: 'invalid-country' };
  if (f.regions.length === 0) return { kind: 'no-region' };
  if (f.countryCode === null) return { kind: 'no-country' };
  if (f.subdivisionCode !== null || f.locationSource !== null) return { kind: 'already-set' };

  const codes = new Set<string>();
  let ambiguous = false;
  let unmatched = false;
  for (const region of f.regions) {
    const m = matchRegion(f.countryCode, region);
    if (m.outcome === 'matched') codes.add(m.code);
    else if (m.outcome === 'ambiguous') ambiguous = true;
    else unmatched = true;
  }
  if (ambiguous || codes.size > 1) return { kind: 'ambiguous' };
  if (unmatched || codes.size === 0) return { kind: 'unmatched' };
  return { kind: 'matched', countryCode: f.countryCode, subdivisionCode: [...codes][0]! };
}

interface Listed { count: number; familyIds: string[] }

export interface LocationBackfillReport {
  apply: boolean;
  families: number;
  /** Families with a region text on a parent file. */
  withRegion: number;
  /** Country is not a listed ISO 3166-1 code: fix by hand, then VALIDATE CONSTRAINT. */
  invalidCountry: Listed;
  /** Region text but no country, so there is nothing to read it against. */
  noCountry: Listed;
  /** Region text, but a subdivision or a location source is already there; left alone. */
  alreadySet: { count: number };
  /** Exactly one subdivision: written (--apply) or what would be written (a dry run). */
  matched: Listed;
  /** The text equals more than one subdivision, or the parents' regions disagree. */
  ambiguous: Listed;
  /** The text is no subdivision of the country (or only some of the parents' regions are). */
  unmatched: Listed;
  /** Rows actually written by this run (0 in a dry run); less than matched.count only when a family changed meanwhile. */
  applied: number;
  /** True when no family has an invalid country: PR-5's VALIDATE CONSTRAINT migration may follow. */
  readyToValidate: boolean;
}

type Db = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>;

const listed = (): Listed => ({ count: 0, familyIds: [] });
const push = (l: Listed, id: string) => {
  l.count += 1;
  l.familyIds.push(id);
};

export async function backfillFamilyLocation(db: Db, opts: { apply: boolean }): Promise<LocationBackfillReport> {
  const rows = await db.$queryRaw<FamilyLocationSource[]>`
    SELECT f.id::text AS "familyId", f.country_code AS "countryCode", f.subdivision_code AS "subdivisionCode",
           f.location_source AS "locationSource",
           COALESCE(array_agg(pf.region ORDER BY c.created_at, c.id)
                    FILTER (WHERE pf.region IS NOT NULL AND btrim(pf.region) <> ''), '{}') AS regions
      FROM chat.family f
      LEFT JOIN chat.contact c ON c.family_id = f.id AND c.is_active
      LEFT JOIN chat.parent_file pf ON pf.contact_id = c.id
     GROUP BY f.id
     ORDER BY f.id`;

  const report: LocationBackfillReport = {
    apply: opts.apply,
    families: rows.length,
    withRegion: rows.filter((r) => r.regions.length > 0).length,
    invalidCountry: listed(),
    noCountry: listed(),
    alreadySet: { count: 0 },
    matched: listed(),
    ambiguous: listed(),
    unmatched: listed(),
    applied: 0,
    readyToValidate: true,
  };
  const writes: Array<{ familyId: string; countryCode: string; subdivisionCode: string }> = [];
  for (const r of rows) {
    const o = planFamily(r);
    switch (o.kind) {
      case 'invalid-country': push(report.invalidCountry, r.familyId); break;
      case 'no-country': push(report.noCountry, r.familyId); break;
      case 'already-set': report.alreadySet.count += 1; break;
      case 'ambiguous': push(report.ambiguous, r.familyId); break;
      case 'unmatched': push(report.unmatched, r.familyId); break;
      case 'matched':
        push(report.matched, r.familyId);
        writes.push({ familyId: r.familyId, countryCode: o.countryCode, subdivisionCode: o.subdivisionCode });
        break;
      case 'no-region': break;
    }
  }
  report.readyToValidate = report.invalidCountry.count === 0;

  if (opts.apply && writes.length > 0) {
    report.applied = await db.$transaction(async (tx) => {
      let n = 0;
      for (const w of writes) {
        n += await tx.$executeRaw`
          UPDATE chat.family
             SET subdivision_code = ${w.subdivisionCode}, location_source = 'backfill',
                 location_updated_at = now(), location_updated_by = NULL
           WHERE id = ${w.familyId}::uuid AND country_code = ${w.countryCode}
             AND subdivision_code IS NULL AND location_source IS NULL`;
      }
      return n;
    });
  }
  return report;
}
