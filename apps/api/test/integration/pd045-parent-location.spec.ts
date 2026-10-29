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
 *  10. ... and forgotten 90 days after a trial that led to no subscription
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

  it('on an old row, IS re-checked when this transaction wrote the row before: the second edit in one transaction is refused', async () => {
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(`update chat.family set country_code = 'UK', display_name = 'family_legacy' where id = $1::uuid`, s.familyId);
    });
    // One edit in its own transaction passes (the old row version is not this transaction's) ...
    await sql(`update chat.family set display_name = 'family_once' where id = $1::uuid`, s.familyId);
    // ... but a second write to the same row in one transaction re-checks the key (review of #204).
    expect(await refusal(g.prisma.$transaction([
      sql(`update chat.family set display_name = 'family_a' where id = $1::uuid`, s.familyId),
      sql(`update chat.family set display_name = 'family_b' where id = $1::uuid`, s.familyId),
    ]))).toMatch(/family_country_listed/);
    expect(await one(`select display_name, country_code from chat.family where id = $1::uuid`, s.familyId))
      .toEqual({ display_name: 'family_once', country_code: 'UK' });
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
      // Review of #204: nor read the location, nor forge who set it on an insert.
      for (const [t, col] of [
        ['chat.family', 'subdivision_code'], ['chat.family', 'location_source'], ['chat.family', 'location_updated_at'], ['chat.family', 'location_updated_by'],
        ['chat.trial_subscription', 'country_code'], ['chat.trial_subscription', 'subdivision_code'],
      ] as const) {
        for (const privilege of ['SELECT', 'INSERT']) {
          const r = await one<{ ok: boolean }>(`select has_column_privilege($1, $2, $3, $4) as ok`, role, t, col, privilege);
          expect({ role, t, col, privilege, ok: r.ok }).toEqual({ role, t, col, privilege, ok: false });
        }
      }
    }
  });

  it('keep every other family column they had: the table grants became column grants, nothing else changed', async () => {
    for (const col of ['id', 'display_name', 'owner_id', 'country_code', 'language']) {
      const r = await one<{ sel: boolean; ins: boolean }>(
        `select has_column_privilege('authenticated', 'chat.family', $1, 'SELECT') as sel,
                has_column_privilege('authenticated', 'chat.family', $1, 'INSERT') as ins`, col,
      );
      expect({ col, ...r }).toEqual({ col, sel: true, ins: true });
    }
    const t = await one<{ sel: boolean; ins: boolean }>(
      `select has_table_privilege('authenticated', 'chat.family', 'SELECT') as sel, has_table_privilege('authenticated', 'chat.family', 'INSERT') as ins`,
    );
    expect(t).toEqual({ sel: false, ins: false });
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

  it('belongs to its prospect\'s organization, keeps its prospect, and is not deleted while it is current', async () => {
    const p = await prospect();
    const other = randomUUID();
    await sql(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'org_other')`, other, `pd45-${other.slice(0, 8)}`);
    expect(await refusal(record(p, 'EG', null, `'${other}'::uuid`))).toMatch(/its prospect's organization/);
    await record(p, 'EG', null);
    const q = await prospect();
    expect(await refusal(sql(`update chat.trial_prospect_location set prospect_id = $2::uuid where prospect_id = $1::uuid`, p, q)))
      .toMatch(/keeps its prospect/);
    expect(await refusal(sql(`delete from chat.trial_prospect_location where prospect_id = $1::uuid`, p))).toMatch(/kept until 90 days/);
  });
});

describe('10. a booking\'s location is forgotten 90 days after a trial that led to no subscription', () => {
  const DAY = 86_400_000;
  let minute = 0;
  /**
   * A prospect with its location recorded `recordedDaysAgo`, and optionally one
   * trial that ended `trialDaysAgo` with `outcome` (null: never recorded). The
   * past is written with the triggers off, as the old data would have been.
   */
  async function booking(opts: { recordedDaysAgo: number; trialDaysAgo?: number; outcome?: 'subscribed' | 'not_subscribed' | null }) {
    const { id: prospect } = await one<{ id: string }>(
      `insert into chat.trial_prospect (organization_id, display_name, created_by)
       values (chat.default_organization_id(), 'prospect_p', $1::uuid) returning id::text as id`,
      s.ownerId,
    );
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      if (opts.trialDaysAgo !== undefined) {
        minute += 61;
        const ends = new Date(Date.now() - opts.trialDaysAgo * DAY - minute * 60_000);
        const [{ id: lesson }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `insert into chat.lesson (organization_id, prospect_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind, created_at)
           values (chat.default_organization_id(), $1::uuid, $2::uuid, 'trial', $3::timestamptz - interval '30 minutes', $3::timestamptz,
                   $4::uuid, 'staff', $3::timestamptz - interval '7 days')
           returning id::text as id`,
          prospect, s.teacherId, ends.toISOString(), s.ownerId,
        );
        if (opts.outcome) {
          await tx.$executeRawUnsafe(
            `insert into chat.trial_outcome (lesson_id, organization_id, result, reason_code, recorded_by)
             values ($1::uuid, chat.default_organization_id(), $2, $3, $4::uuid)`,
            lesson, opts.outcome, opts.outcome === 'not_subscribed' ? 'price' : null, s.ownerId,
          );
        }
      }
      await tx.$executeRawUnsafe(
        `insert into chat.trial_prospect_location (prospect_id, organization_id, country_code, subdivision_code, recorded_by, recorded_at)
         values ($1::uuid, chat.default_organization_id(), 'EG', 'EG-GZ', $2::uuid, now() - make_interval(days => $3::int))`,
        prospect, s.ownerId, opts.recordedDaysAgo,
      );
    });
    return prospect;
  }
  const kept = async (prospect: string) =>
    (await one<{ n: number }>(`select count(*)::int as n from chat.trial_prospect_location where prospect_id = $1::uuid`, prospect)).n === 1;

  it('forgets the expired ones in one purge, keeps every other, and says how many', async () => {
    const notSubscribedLongAgo = await booking({ recordedDaysAgo: 120, trialDaysAgo: 100, outcome: 'not_subscribed' });
    const notSubscribedRecently = await booking({ recordedDaysAgo: 120, trialDaysAgo: 30, outcome: 'not_subscribed' });
    const subscribedLongAgo = await booking({ recordedDaysAgo: 400, trialDaysAgo: 300, outcome: 'subscribed' });
    const noOutcomeLongAgo = await booking({ recordedDaysAgo: 120, trialDaysAgo: 100, outcome: null });
    const noTrialLongAgo = await booking({ recordedDaysAgo: 100 });
    const noTrialRecently = await booking({ recordedDaysAgo: 10 });
    const reEnteredRecently = await booking({ recordedDaysAgo: 20, trialDaysAgo: 100, outcome: 'not_subscribed' });

    const { n } = await one<{ n: number }>(`select chat.purge_trial_prospect_locations() as n`);
    expect(n).toBe(3);
    expect(await kept(notSubscribedLongAgo)).toBe(false);
    expect(await kept(noOutcomeLongAgo)).toBe(false);
    expect(await kept(noTrialLongAgo)).toBe(false);
    expect(await kept(notSubscribedRecently)).toBe(true);
    expect(await kept(subscribedLongAgo)).toBe(true);
    expect(await kept(noTrialRecently)).toBe(true);
    expect(await kept(reEnteredRecently)).toBe(true);
    expect((await one<{ n: number }>(`select chat.purge_trial_prospect_locations() as n`)).n).toBe(0);
  });

  it('refuses to delete one that is still current, whoever asks', async () => {
    const p = await booking({ recordedDaysAgo: 120, trialDaysAgo: 30, outcome: 'not_subscribed' });
    expect(await refusal(sql(`delete from chat.trial_prospect_location where prospect_id = $1::uuid`, p))).toMatch(/kept until 90 days/);
    expect(await kept(p)).toBe(true);
  });
});
