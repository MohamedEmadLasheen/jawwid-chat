/**
 * PD-45 PR-1 -- the database half of a family's location
 * (docs/product/pd045-parent-location-plan.md §3.2, §3.3).
 *
 *   1. the seed: every country and first-level subdivision of the dataset
 *   2. the subdivision belongs to the country (composite foreign key)
 *   3. a country not in the list: refused when written, but an old row is
 *      never re-checked by an unrelated edit (NOT VALID until PR-5)
 *   4. who set the location is recorded
 *   5. the reference tables are fixed by their migration
 *   6. Sales' subscription form carries the same two keys
 *   7. the one-time prompt is answered once per contact
 *   8. no request role reads the reference tables or writes the new columns
 *   9. the booking's location (owner 2026-10-29): beside the prospect, in its
 *      organization, the same keys, kept
 *
 * Every refusal is the database's own. Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGraph, seed, truncate, type Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

const sql = (q: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(q, ...args);
async function one<T>(q: string, ...args: unknown[]): Promise<T> {
  const rows = await g.prisma.$queryRawUnsafe<T[]>(q, ...args);
  return rows[0]!;
}
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error('expected the database to refuse');
}
const setLocation = (country: string | null, subdivision: string | null, source: string | null = 'staff', by: string | null = null) =>
  sql(
    `update chat.family set country_code = $2, subdivision_code = $3, location_source = $4,
            location_updated_by = $5::uuid, location_updated_at = now()
      where id = $1::uuid`,
    s.familyId, country, subdivision, source, by ?? (source === 'staff' ? s.ownerId : null),
  );

const dataset = JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'geo', 'dataset.json'), 'utf8')) as {
  countries: Array<{ code: string; subdivisions: Array<{ code: string }> }>;
};

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

describe('1. the seed', () => {
  it('holds exactly the dataset\'s countries and subdivisions', async () => {
    const countries = await g.prisma.$queryRawUnsafe<Array<{ code: string }>>(`select code from chat.geo_country order by code`);
    expect(countries.map((r) => r.code)).toEqual(dataset.countries.map((c) => c.code));
    const subs = await g.prisma.$queryRawUnsafe<Array<{ k: string }>>(
      `select country_code || '|' || code as k from chat.geo_subdivision order by country_code, code`,
    );
    expect(subs.map((r) => r.k)).toEqual(dataset.countries.flatMap((c) => c.subdivisions.map((x) => `${c.code}|${x.code}`)));
  });
});

describe('2. the subdivision belongs to the country', () => {
  it('stores Giza under Egypt, and Egypt alone', async () => {
    await setLocation('EG', 'EG-GZ');
    await setLocation('EG', null);
    expect(await one(`select country_code, subdivision_code from chat.family where id = $1::uuid`, s.familyId))
      .toEqual({ country_code: 'EG', subdivision_code: null });
  });

  it('refuses Dubai under Egypt', async () => {
    expect(await refusal(setLocation('EG', 'AE-DU'))).toMatch(/family_subdivision_in_country/);
  });

  it('refuses a subdivision with no country', async () => {
    expect(await refusal(setLocation(null, 'EG-GZ'))).toMatch(/family_subdivision_needs_country/);
  });

  it('refuses a code that is not a first-level subdivision', async () => {
    expect(await refusal(setLocation('GB', 'GB-KEN'))).toMatch(/family_subdivision_in_country/);
    expect(await refusal(setLocation('EG', 'EG-XX'))).toMatch(/family_subdivision_in_country/);
  });
});

describe('3. a country not in the list', () => {
  it('is refused when written: two letters are not enough', async () => {
    expect(await refusal(setLocation('ZZ', null))).toMatch(/family_country_listed/);
    expect(await refusal(setLocation('UK', null))).toMatch(/family_country_listed/);
  });

  it('on an old row, never blocks an unrelated edit, and is checked once the country changes', async () => {
    // A family whose country was typed into the old "other" box before PD-45
    // (written with the foreign-key triggers off, as the old data is).
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(`update chat.family set country_code = 'UK' where id = $1::uuid`, s.familyId);
    });
    await sql(`update chat.family set display_name = 'family_renamed' where id = $1::uuid`, s.familyId);
    expect(await refusal(setLocation('UK', 'GB-ENG'))).toMatch(/family_subdivision_in_country|family_country_listed/);
    await setLocation('GB', 'GB-ENG');
    const c = await one<{ convalidated: boolean }>(`select convalidated from pg_constraint where conname = 'family_country_listed'`);
    expect(c.convalidated).toBe(false);
  });
});

describe('4. who set it', () => {
  it('names the staff member or the parent; only the backfill is nobody', async () => {
    expect(await refusal(setLocation('EG', 'EG-C', 'staff', null).then(() => sql(
      `update chat.family set location_updated_by = null where id = $1::uuid`, s.familyId,
    )))).toMatch(/family_location_names_its_writer/);
    await setLocation('EG', 'EG-C', 'parent', s.parentId);
    await setLocation('EG', 'EG-C', 'backfill', null);
    expect(await refusal(setLocation('EG', 'EG-C', 'import', s.ownerId))).toMatch(/family_location_source_check/);
  });
});

describe('5. the lists are fixed by their migration', () => {
  it.each([
    [`insert into chat.geo_country (code) values ('QZ')`],
    [`update chat.geo_country set retired_at = now() where code = 'EG'`],
    [`delete from chat.geo_subdivision where code = 'EG-GZ'`],
    [`insert into chat.geo_subdivision (country_code, code) values ('EG', 'EG-ZZ')`],
  ])('%s is refused', async (statement) => {
    expect(await refusal(sql(statement))).toMatch(/reference data, fixed by their migration/);
  });

  it('truncate is refused too (by the trigger, or first by the families that reference it)', async () => {
    for (const t of ['chat.geo_subdivision', 'chat.geo_country']) {
      expect(await refusal(sql(`truncate ${t}`))).toMatch(/reference data, fixed by their migration|referenced in a foreign key constraint/);
    }
    expect((await one<{ n: number }>(`select count(*)::int as n from chat.geo_subdivision`)).n).toBeGreaterThan(3000);
  });
});

describe('6. Sales\' subscription form', () => {
  it('ties its subdivision to its country, and its country to the list, at once (no old rows to spare)', async () => {
    const defs = await g.prisma.$queryRawUnsafe<Array<{ conname: string; def: string; convalidated: boolean }>>(
      `select conname, pg_get_constraintdef(oid) as def, convalidated from pg_constraint
        where conrelid = 'chat.trial_subscription'::regclass and conname like 'trial_subscription_%country%'
        order by conname`,
    );
    expect(defs.map((d) => [d.conname, d.convalidated])).toEqual([
      ['trial_subscription_country_listed', true],
      ['trial_subscription_subdivision_in_country', true],
      ['trial_subscription_subdivision_needs_country', true],
    ]);
    expect(defs[0]!.def).toMatch(/^FOREIGN KEY \(country_code\) REFERENCES (chat\.)?geo_country\(code\)$/);
    expect(defs[1]!.def).toMatch(/^FOREIGN KEY \(country_code, subdivision_code\) REFERENCES (chat\.)?geo_subdivision\(country_code, code\)$/);
    expect(defs[2]!.def).toMatch(/subdivision_code IS NULL\) OR \(country_code IS NOT NULL/);
  });
});

describe('7. the one-time prompt', () => {
  it('is answered once per contact, as saved or later', async () => {
    await sql(`insert into chat.contact_location_prompt (contact_id, outcome) values ($1::uuid, 'later')`, s.parentId);
    expect(await refusal(sql(`insert into chat.contact_location_prompt (contact_id, outcome) values ($1::uuid, 'saved')`, s.parentId)))
      .toMatch(/contact_location_prompt_pkey/);
    expect(await refusal(sql(`insert into chat.contact_location_prompt (contact_id, outcome) values ($1::uuid, 'dismissed')`, s.otherParentId)))
      .toMatch(/contact_location_prompt_outcome_check/);
  });
});

describe('8. request roles', () => {
  it('read none of the new tables and write none of the new columns', async () => {
    for (const role of ['authenticated', 'chat_app', 'anon']) {
      for (const t of ['chat.geo_country', 'chat.geo_subdivision', 'chat.contact_location_prompt', 'chat.trial_prospect_location']) {
        const r = await one<{ ok: boolean }>(`select has_table_privilege($1, $2, 'SELECT') or has_table_privilege($1, $2, 'INSERT') as ok`, role, t);
        expect({ role, t, ok: r.ok }).toEqual({ role, t, ok: false });
      }
      for (const [t, col] of [
        ['chat.family', 'subdivision_code'], ['chat.family', 'location_source'], ['chat.family', 'location_updated_by'],
        ['chat.family', 'country_code'], ['chat.trial_subscription', 'country_code'], ['chat.trial_subscription', 'subdivision_code'],
      ] as const) {
        const r = await one<{ ok: boolean }>(`select has_column_privilege($1, $2, $3, 'UPDATE') as ok`, role, t, col);
        expect({ role, t, col, ok: r.ok }).toEqual({ role, t, col, ok: false });
      }
    }
  });
});

describe('9. the booking\'s location', () => {
  async function prospect(): Promise<string> {
    const { id } = await one<{ id: string }>(
      `insert into chat.trial_prospect (organization_id, display_name, created_by)
       values (chat.default_organization_id(), 'prospect_p', $1::uuid) returning id::text as id`,
      s.ownerId,
    );
    return id;
  }
  const record = (prospectId: string, country: string, subdivision: string | null, org = 'chat.default_organization_id()') =>
    sql(
      `insert into chat.trial_prospect_location (prospect_id, organization_id, country_code, subdivision_code, recorded_by)
       values ($1::uuid, ${org}, $2, $3, $4::uuid)`,
      prospectId, country, subdivision, s.ownerId,
    );

  it('stores a country, with or without its subdivision, once per prospect', async () => {
    const p = await prospect();
    await record(p, 'AE', 'AE-DU');
    expect(await refusal(record(p, 'AE', null))).toMatch(/trial_prospect_location_pkey/);
    await sql(`update chat.trial_prospect_location set subdivision_code = null, recorded_by = $2::uuid where prospect_id = $1::uuid`, p, s.ownerId);
    await sql(`update chat.trial_prospect_location set country_code = 'EG', subdivision_code = 'EG-GZ', recorded_by = $2::uuid where prospect_id = $1::uuid`, p, s.ownerId);
  });

  it('holds the same keys as the family: the subdivision is the country\'s, the country is listed', async () => {
    expect(await refusal(record(await prospect(), 'EG', 'AE-DU'))).toMatch(/trial_prospect_location_subdivision_in_country/);
    expect(await refusal(record(await prospect(), 'UK', null))).toMatch(/trial_prospect_location_country_listed/);
  });

  it('belongs to its prospect\'s organization, keeps its prospect, and is never deleted', async () => {
    const p = await prospect();
    const other = randomUUID();
    await sql(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'org_other')`, other, `pd45-${other.slice(0, 8)}`);
    expect(await refusal(record(p, 'EG', null, `'${other}'::uuid`))).toMatch(/its prospect's organization/);
    await record(p, 'EG', null);
    const q = await prospect();
    expect(await refusal(sql(`update chat.trial_prospect_location set prospect_id = $2::uuid where prospect_id = $1::uuid`, p, q)))
      .toMatch(/keeps its prospect/);
    expect(await refusal(sql(`delete from chat.trial_prospect_location where prospect_id = $1::uuid`, p))).toMatch(/never deleted/);
  });
});
