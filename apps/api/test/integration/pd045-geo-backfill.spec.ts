/**
 * PD-45 PR-5 -- the `geo:backfill` CLI's engine against a real database
 * (docs/product/pd045-parent-location-plan.md §6.3, §10): a dry run writes
 * nothing; --apply sets only exact, unique matches (location_source =
 * 'backfill'); a location staff or the parent set is never touched; a second
 * run changes nothing; and the report names families by id only.
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { backfillFamilyLocation } from '../../src/parent-profile/family-location-backfill';
import { buildGraph, seed, truncate, type Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

const sql = (q: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(q, ...args);

interface Made { id: string; parent: string }

/** A family with one active parent whose parent file holds `region`. */
async function family(label: string, opts: { country?: string | null; region?: string | null; phone?: string } = {}): Promise<Made> {
  const id = randomUUID();
  const parent = randomUUID();
  await sql(`insert into chat.family (id, display_name, owner_id, language, country_code) values ($1::uuid, $2, $3::uuid, 'ar', $4)`,
    id, `family_${label}`, s.ownerId, opts.country ?? null);
  await sql(`insert into chat.contact (id, family_id, name, role_preset, can_message, is_active) values ($1::uuid, $2::uuid, $3, 'primary_guardian', true, true)`,
    parent, id, `parent_${label}`);
  await sql(`insert into chat.parent_file (contact_id, organization_id, phone, region) values ($1::uuid, chat.default_organization_id(), $2, $3)`,
    parent, opts.phone ?? '+201000000099', opts.region ?? null);
  return { id, parent };
}

/** A country the dataset does not list: only possible on an old row (the foreign key is NOT VALID). */
const legacyCountry = (familyId: string, code: string) =>
  g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    await tx.$executeRawUnsafe(`update chat.family set country_code = $2 where id = $1::uuid`, familyId, code);
  });

const staffSet = (familyId: string, country: string, subdivision: string | null) =>
  sql(`update chat.family set country_code = $2, subdivision_code = $3, location_source = 'staff',
              location_updated_by = $4::uuid, location_updated_at = now() where id = $1::uuid`, familyId, country, subdivision, s.ownerId);

async function locations() {
  return g.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `select id::text, country_code, subdivision_code, location_source, location_updated_at, location_updated_by::text
       from chat.family order by id`);
}
const regions = () => g.prisma.$queryRawUnsafe<unknown[]>(`select contact_id::text, region from chat.parent_file order by contact_id`);
const row = async (id: string) => (await locations()).find((r) => r.id === id)!;

let cases: Record<'giza' | 'dubai' | 'twoParents' | 'maadi' | 'markazi' | 'uk' | 'staff' | 'parent' | 'noCountry' | 'noRegion', Made>;

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  cases = {
    giza: await family('giza', { country: 'EG', region: 'Giza' }),
    dubai: await family('dubai', { country: 'AE', region: 'إمارة دبي' }),
    // The seeded family: two active parents who wrote the same place two ways.
    twoParents: { id: s.familyId, parent: s.parentId },
    maadi: await family('maadi', { country: 'EG', region: 'Maadi' }),
    markazi: await family('markazi', { country: 'IR', region: 'Markazi' }),
    uk: await family('uk', { country: 'EG', region: 'London' }),
    staff: await family('staff', { country: 'EG', region: 'Giza' }),
    parent: await family('parent', { country: 'EG', region: 'Giza' }),
    noCountry: await family('nocountry', { country: null, region: 'Giza' }),
    noRegion: await family('noregion', { country: 'EG', region: null }),
  };
  await sql(`update chat.family set country_code = 'EG' where id = $1::uuid`, s.familyId);
  await sql(`insert into chat.parent_file (contact_id, organization_id, phone, region) values ($1::uuid, chat.default_organization_id(), '+201000000098', 'جيزة')`, s.parentId);
  await sql(`insert into chat.parent_file (contact_id, organization_id, phone, region) values ($1::uuid, chat.default_organization_id(), '+201000000097', 'الجيزة')`, s.otherParentId);
  await sql(`update chat.contact set is_active = true where id in ($1::uuid, $2::uuid)`, s.parentId, s.otherParentId);
  await legacyCountry(cases.uk.id, 'UK');
  await staffSet(cases.staff.id, 'EG', null); // staff chose the country alone
  await sql(`update chat.family set subdivision_code = 'EG-C', location_source = 'parent', location_updated_by = $2::uuid, location_updated_at = now() where id = $1::uuid`,
    cases.parent.id, cases.parent.parent);
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

describe('PD-45 PR-5: the geo backfill', () => {
  it('a dry run reports what it would do and writes nothing', async () => {
    const before = { l: await locations(), r: await regions() };
    const report = await backfillFamilyLocation(g.prisma, { apply: false });
    expect(report).toMatchObject({
      apply: false,
      applied: 0,
      readyToValidate: false,
      invalidCountry: { count: 1, familyIds: [cases.uk.id] },
      noCountry: { count: 1, familyIds: [cases.noCountry.id] },
      alreadySet: { count: 2 },
      ambiguous: { count: 1, familyIds: [cases.markazi.id] },
      unmatched: { count: 1, familyIds: [cases.maadi.id] },
    });
    expect(report.matched.count).toBe(3);
    expect([...report.matched.familyIds].sort()).toEqual([cases.giza.id, cases.dubai.id, cases.twoParents.id].sort());
    expect(report.families).toBe(Object.keys(cases).length);
    expect(report.withRegion).toBe(Object.keys(cases).length - 1);
    expect({ l: await locations(), r: await regions() }).toEqual(before);
  });

  it('--apply sets only the exact, unique matches, as "backfill" with no actor', async () => {
    const report = await backfillFamilyLocation(g.prisma, { apply: true });
    expect(report.applied).toBe(3);
    expect(report.matched.count).toBe(3);
    expect(await row(cases.giza.id)).toMatchObject({ country_code: 'EG', subdivision_code: 'EG-GZ', location_source: 'backfill', location_updated_by: null });
    expect(await row(cases.dubai.id)).toMatchObject({ country_code: 'AE', subdivision_code: 'AE-DU', location_source: 'backfill' });
    expect(await row(cases.twoParents.id)).toMatchObject({ subdivision_code: 'EG-GZ', location_source: 'backfill' });
    for (const id of [cases.giza.id, cases.dubai.id, cases.twoParents.id]) expect((await row(id)).location_updated_at).toBeInstanceOf(Date);
    // Not exact, ambiguous, not a country, no country, no region: left as they were.
    for (const c of [cases.maadi, cases.markazi, cases.uk, cases.noCountry, cases.noRegion]) {
      expect(await row(c.id)).toMatchObject({ subdivision_code: null, location_source: null, location_updated_at: null });
    }
    expect((await row(cases.uk.id)).country_code).toBe('UK'); // listed for staff, never rewritten
  });

  it('never overwrites a location staff or the parent set', async () => {
    const staffBefore = await row(cases.staff.id);
    const parentBefore = await row(cases.parent.id);
    await backfillFamilyLocation(g.prisma, { apply: true });
    expect(await row(cases.staff.id)).toEqual(staffBefore);
    expect(await row(cases.parent.id)).toEqual(parentBefore);
    expect(parentBefore).toMatchObject({ subdivision_code: 'EG-C', location_source: 'parent' }); // the region said Giza
  });

  it('does not overwrite a staff edit made between its read and its write', async () => {
    const racing = {
      $queryRaw: g.prisma.$queryRaw.bind(g.prisma),
      $executeRaw: g.prisma.$executeRaw.bind(g.prisma),
      $transaction: (async (fn: Parameters<typeof g.prisma.$transaction>[0]) => {
        await staffSet(cases.giza.id, 'EG', null);
        return g.prisma.$transaction(fn as never);
      }) as typeof g.prisma.$transaction,
    };
    const report = await backfillFamilyLocation(racing, { apply: true });
    expect(report.matched.count).toBe(3);
    expect(report.applied).toBe(2);
    expect(await row(cases.giza.id)).toMatchObject({ subdivision_code: null, location_source: 'staff' });
  });

  it('is idempotent: a second --apply writes nothing and reports nothing left to match', async () => {
    await backfillFamilyLocation(g.prisma, { apply: true });
    const after = await locations();
    const again = await backfillFamilyLocation(g.prisma, { apply: true });
    expect(again).toMatchObject({ applied: 0, matched: { count: 0, familyIds: [] }, alreadySet: { count: 5 } });
    expect(await locations()).toEqual(after);
  });

  it('is ready to validate the country constraint once staff fixed the invalid countries', async () => {
    await legacyCountry(cases.uk.id, 'GB');
    const report = await backfillFamilyLocation(g.prisma, { apply: false });
    expect(report).toMatchObject({ readyToValidate: true, invalidCountry: { count: 0, familyIds: [] } });
    // Now a country, its region text is read like any other (London is no GB first-level name).
    expect(report).toMatchObject({ matched: { count: 3 }, unmatched: { count: 2 } });
  });

  it('the report holds family ids and counts only: no name, phone, e-mail or region text', async () => {
    const text = JSON.stringify([await backfillFamilyLocation(g.prisma, { apply: false }), await backfillFamilyLocation(g.prisma, { apply: true })]);
    for (const secret of ['family_', 'parent_', '+2010000000', '2010000000', 'Giza', 'الجيزة', 'جيزة', 'دبي', 'Maadi', 'Markazi', 'London']) {
      expect({ secret, found: text.includes(secret) }).toEqual({ secret, found: false });
    }
    expect(text).toContain(cases.markazi.id);
  });
});
