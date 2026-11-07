/**
 * PD-58 (ENG-09) against the real database (migration 20261107110000, renumbered from 20261104110000): the
 * Terms of Use data model, roadmap 2026-11-03 §7.2.
 *
 *   chat.legal_document_version  the versions the owner publishes; append-only,
 *                                written only by chat.publish_legal_version
 *   chat.terms_acceptance        who accepted which version, when, from which
 *                                client and in which locale; immutable, written
 *                                only by chat.accept_legal_documents
 *
 * What is proved here:
 *   - the constraints: the four document keys, a version must exist before it is
 *     accepted, a kind accepts only its own terms plus the Code of Conduct, the
 *     client and the locale are checked, the timestamps are the database's;
 *   - the developer guide's §1.3 proposals: P-1 each version carries the SHA-256
 *     of its Arabic and English text; P-2 each acceptance says how it was given
 *     (signup | gate); P-3 each version says whether it asks for acceptance
 *     again, and a document's first version always does; P-4 the record holds
 *     no IP address, user agent or device identifier;
 *   - immutability: an UPDATE, a DELETE or a TRUNCATE of either table is refused
 *     by its guard trigger (one function per table), an account that accepted
 *     cannot be hard-deleted, and an erasure keeps the record;
 *   - RLS and privileges: both tables are fail-closed; a request role reads only
 *     its own acceptances and writes nothing; neither writer is executable by a
 *     request role;
 *   - nothing legal ships in the migration (N-3): no version row, no
 *     `legal.current.*` configuration, no document text.
 *
 * The version names below are synthetic fixtures, never the owner's versions.
 * Synthetic people only (G-20).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '@platform/prisma.service';

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:55433/jawwid_chat_int';

jest.setTimeout(120_000);

const MIGRATION = join(__dirname, '../../../../supabase/migrations/20261107110000_chat_pd058_terms.sql');
const DOMAIN = 'pd58terms.qa.jawwid.test';
const prisma = new PrismaService();

/** A fixture version name, unique to this run. */
const v = (label: string) => `qa-${label}-${randomUUID().slice(0, 8)}`;

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

/** The harness's own escape hatch: a test's cleanup says it is a test's cleanup. */
const truncateLegal = () =>
  prisma.$transaction([
    prisma.$executeRawUnsafe(`select set_config('chat.test_truncate', 'on', true)`),
    prisma.$executeRawUnsafe(`truncate chat.terms_acceptance, chat.legal_document_version`),
  ]);

async function cleanUp(): Promise<void> {
  await truncateLegal();
  // By id as well: an erased account's subject no longer names this suite's domain.
  await prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}' or id = any($1::uuid[])`, created);
  created.length = 0;
}

const created: string[] = [];

async function account(kind: 'family' | 'teacher' | 'staff', active = true): Promise<string> {
  const id = randomUUID();
  created.push(id);
  await prisma.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind, status, is_active) values ($1::uuid, $2, $3, $4, $5)`,
    id, `${kind}_${id.slice(0, 8)}@${DOMAIN}`, kind, active ? 'active' : 'deactivated', active,
  );
  return id;
}

/** SHA-256 (lowercase hex) of a synthetic page body: P-1's fingerprint of the text served at a URL. */
const sha = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');

interface PublishOptions {
  urlAr?: string;
  urlEn?: string;
  /** null sends SQL null; omitted sends the fingerprint of a synthetic body. */
  shaAr?: string | null;
  shaEn?: string | null;
  requiresReacceptance?: boolean;
}

const publish = (key: string, version: string, o: PublishOptions = {}) =>
  prisma
    .$queryRawUnsafe<Array<{ added: boolean }>>(
      `select chat.publish_legal_version($1, $2, $3, $4, $5, $6, $7::boolean, null, null) as added`,
      key,
      version,
      o.urlAr ?? `https://jawwid.test/ar/${key}/${version}`,
      o.urlEn ?? `https://jawwid.test/en/${key}/${version}`,
      o.shaAr === undefined ? sha(`ar ${key} ${version}`) : o.shaAr,
      o.shaEn === undefined ? sha(`en ${key} ${version}`) : o.shaEn,
      o.requiresReacceptance ?? true,
    )
    .then((r) => r[0]!.added);

const accept = (accountId: string, docs: Array<[string, string]>, client = 'android', locale = 'ar', method: string | null = 'gate') =>
  prisma
    .$queryRawUnsafe<Array<{ added: number }>>(
      `select chat.accept_legal_documents($1::uuid, $2::jsonb, $3, $4, $5) as added`,
      accountId, JSON.stringify(docs.map(([document_key, version]) => ({ document_key, version }))), client, locale, method,
    )
    .then((r) => Number(r[0]!.added));

interface Row { document_key: string; version: string; accepted_at: Date; method: string; client: string; locale: string }
const rowsOf = (accountId: string) =>
  prisma.$queryRawUnsafe<Row[]>(
    `select document_key, version, accepted_at, method, client, locale from chat.terms_acceptance where account_id = $1::uuid order by accepted_at, document_key, version`,
    accountId,
  );

interface VersionRow { content_sha256_ar: string; content_sha256_en: string; requires_reacceptance: boolean }
const versionOf = async (key: string, version: string) =>
  (await prisma.$queryRawUnsafe<VersionRow[]>(
    `select content_sha256_ar, content_sha256_en, requires_reacceptance from chat.legal_document_version where document_key = $1 and version = $2`,
    key, version,
  ))[0];

/** Runs `fn` as the request role `role`, signed in as `subject`, and rolls back. */
async function asRole<T>(role: 'chat_app' | 'authenticated' | 'anon', subject: string | null, fn: (tx: PrismaService) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local role ${role}`);
      if (subject) await tx.$executeRawUnsafe(`select set_config('chat.actor_subject', $1, true)`, subject);
      out = await fn(tx as unknown as PrismaService);
      throw new Error('rollback');
    })
    .catch((e: Error) => {
      if (e.message !== 'rollback') throw e;
    });
  return out as T;
}

/** One statement as a request role, in a savepoint so a refusal leaves the transaction usable. */
const attempt = (tx: PrismaService, sql: string) =>
  tx.$executeRawUnsafe(`savepoint p`).then(() =>
    tx.$queryRawUnsafe(sql).then(
      async () => { await tx.$executeRawUnsafe(`release savepoint p`); return 'ok'; },
      async (e: Error) => { await tx.$executeRawUnsafe(`rollback to savepoint p`); return e.message; },
    ));

const subjectOf = async (id: string) =>
  (await prisma.$queryRawUnsafe<Array<{ subject: string }>>(`select subject from chat.account where id = $1::uuid`, id))[0]!.subject;

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('PD-58: the structure', () => {
  it('has the two tables, keyed as §7.2 says, with RLS enabled on both', async () => {
    const cols = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; is_nullable: string; data_type: string }>>(`
      select table_name::text, column_name::text, is_nullable::text, data_type::text
        from information_schema.columns
       where table_schema = 'chat' and table_name in ('legal_document_version', 'terms_acceptance')
       order by table_name, ordinal_position`);
    expect(cols.map((c) => `${c.table_name}.${c.column_name}:${c.data_type}:${c.is_nullable}`)).toEqual([
      'legal_document_version.document_key:text:NO',
      'legal_document_version.version:text:NO',
      'legal_document_version.url_ar:text:NO',
      'legal_document_version.url_en:text:NO',
      'legal_document_version.content_sha256_ar:text:NO', // P-1
      'legal_document_version.content_sha256_en:text:NO', // P-1
      'legal_document_version.requires_reacceptance:boolean:NO', // P-3
      'legal_document_version.effective_at:timestamp with time zone:NO',
      'legal_document_version.created_at:timestamp with time zone:NO',
      'legal_document_version.created_by:uuid:YES',
      'terms_acceptance.account_id:uuid:NO',
      'terms_acceptance.document_key:text:NO',
      'terms_acceptance.version:text:NO',
      'terms_acceptance.accepted_at:timestamp with time zone:NO',
      'terms_acceptance.method:text:NO', // P-2
      'terms_acceptance.client:text:NO',
      'terms_acceptance.locale:text:NO',
    ]);

    const keys = await prisma.$queryRawUnsafe<Array<{ tbl: string; def: string }>>(`
      select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def
        from pg_constraint
       where conrelid in ('chat.legal_document_version'::regclass, 'chat.terms_acceptance'::regclass)
         and contype in ('p', 'f')
       order by 1, 2`);
    expect(keys).toEqual([
      { tbl: 'chat.legal_document_version', def: 'PRIMARY KEY (document_key, version)' },
      { tbl: 'chat.terms_acceptance', def: 'FOREIGN KEY (account_id) REFERENCES chat.account(id) ON DELETE RESTRICT' },
      { tbl: 'chat.terms_acceptance', def: 'FOREIGN KEY (document_key, version) REFERENCES chat.legal_document_version(document_key, version) ON DELETE RESTRICT' },
      { tbl: 'chat.terms_acceptance', def: 'PRIMARY KEY (account_id, document_key, version)' },
    ]);

    const rls = await prisma.$queryRawUnsafe<Array<{ relname: string; on: boolean }>>(`
      select relname::text, relrowsecurity as on from pg_class
       where oid in ('chat.legal_document_version'::regclass, 'chat.terms_acceptance'::regclass) order by 1`);
    expect(rls).toEqual([{ relname: 'legal_document_version', on: true }, { relname: 'terms_acceptance', on: true }]);
  });

  it('each table has its own guard function: one per table, none shared', async () => {
    const t = await prisma.$queryRawUnsafe<Array<{ tbl: string; fn: string; trg: string }>>(`
      select c.relname::text as tbl, p.proname::text as fn, t.tgname::text as trg
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
       where not t.tgisinternal and c.oid in ('chat.legal_document_version'::regclass, 'chat.terms_acceptance'::regclass)
       order by 1, 3`);
    const fnsOf = (tbl: string) => [...new Set(t.filter((r) => r.tbl === tbl).map((r) => r.fn))];
    expect(fnsOf('legal_document_version')).toEqual(['guard_legal_document_version']);
    expect(fnsOf('terms_acceptance')).toEqual(['guard_terms_acceptance']);
    // Row-level for insert/update/delete and statement-level for truncate, on both.
    expect(t.length).toBe(4);
  });

  it('ships nothing legal: no version row, no legal.current.* configuration, no document text (N-3)', async () => {
    const sql = readFileSync(MIGRATION, 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    // Outside the function bodies (the two writers insert their callers' rows),
    // the migration writes no row of its own.
    const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, '');
    expect(topLevel).toMatch(/create table if not exists chat\.terms_acceptance/); // control: the strip kept the DDL
    expect(topLevel).not.toMatch(/\b(insert\s+into|update\s+chat\.|copy\s+chat\.)/i);
    expect(sql).not.toMatch(/legal\.current\./i);
    // No URL is written into the migration either: every URL is the owner's to publish.
    expect(sql).not.toMatch(/https:\/\/[a-z0-9]/i);
    // Nor a fingerprint (P-1): the hashes are of the owner's published text.
    expect(sql).not.toMatch(/\b[0-9a-f]{64}\b/i);
  });

  it('P-4: the acceptance record stores no IP address, user agent or device identifier', async () => {
    // session.ip_hash and session.user_agent already hold these for the same
    // request; copying them here would add personal data and no evidence
    // (developer-implementation-guide §1.3 P-4). The columns are exactly these.
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`
      select column_name::text from information_schema.columns
       where table_schema = 'chat' and table_name = 'terms_acceptance' order by ordinal_position`);
    const names = cols.map((c) => c.column_name);
    expect(names).toEqual(['account_id', 'document_key', 'version', 'accepted_at', 'method', 'client', 'locale']);
    for (const n of names) {
      expect({ n, personal: /(^|_)(ip|inet|addr|address|user_?agent|ua|device|fingerprint|session)(_|$)/i.test(n) }).toEqual({ n, personal: false });
    }
    // No column of a network-address type either, whatever it is called.
    const typed = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      select count(*)::int as n from information_schema.columns
       where table_schema = 'chat' and table_name = 'terms_acceptance' and data_type in ('inet', 'cidr', 'macaddr', 'macaddr8')`);
    expect(typed).toEqual([{ n: 0 }]);
  });
});

describe('PD-58: publishing a version', () => {
  it('records a version once; the same call again adds nothing; a changed version is refused', async () => {
    const ver = v('coc');
    expect(await publish('code_of_conduct', ver)).toBe(true);
    expect(await publish('code_of_conduct', ver)).toBe(false);
    expect(await sqlError(publish('code_of_conduct', ver, { urlAr: 'https://jawwid.test/ar/other' }))).toMatch(/already published.*never changes/);
    const row = await prisma.$queryRawUnsafe<Array<{ fresh: boolean }>>(
      `select created_at > now() - interval '1 minute' and created_at <= clock_timestamp() as fresh from chat.legal_document_version where document_key = 'code_of_conduct' and version = $1`, ver);
    expect(row).toEqual([{ fresh: true }]);
  });

  it('refuses an unknown document key, a blank or padded version, and a URL that is not https', async () => {
    expect(await sqlError(publish('privacy_policy', v('x')))).toMatch(/check constraint|document_key/);
    expect(await sqlError(publish('terms_family', ''))).toMatch(/check constraint|version/);
    expect(await sqlError(publish('terms_family', ' 1.0'))).toMatch(/check constraint|version/);
    expect(await sqlError(publish('terms_family', v('x'), { urlAr: 'http://jawwid.test/ar' }))).toMatch(/check constraint|url_ar/);
    expect(await sqlError(publish('terms_family', v('x'), { urlEn: 'javascript:alert(1)' }))).toMatch(/check constraint|url_en/);
  });

  it('P-1: records the SHA-256 of the Arabic and the English text; a retry with a different fingerprint is refused', async () => {
    const ver = v('coc-sha');
    const [ar, en] = [sha(`ar page ${ver}`), sha(`en page ${ver}`)];
    expect(await publish('code_of_conduct', ver, { shaAr: ar, shaEn: en })).toBe(true);
    expect(await versionOf('code_of_conduct', ver)).toEqual(expect.objectContaining({ content_sha256_ar: ar, content_sha256_en: en }));
    // The identical retry is still a no-op ...
    expect(await publish('code_of_conduct', ver, { shaAr: ar, shaEn: en })).toBe(false);
    // ... but the same URLs over different text are a changed version: publish a new one.
    expect(await sqlError(publish('code_of_conduct', ver, { shaAr: sha('edited'), shaEn: en }))).toMatch(/already published.*never changes/);
    expect(await sqlError(publish('code_of_conduct', ver, { shaAr: ar, shaEn: sha('edited') }))).toMatch(/already published.*never changes/);
    expect(await versionOf('code_of_conduct', ver)).toEqual(expect.objectContaining({ content_sha256_ar: ar, content_sha256_en: en }));
  });

  it('P-1: a fingerprint is required and is exactly 64 lowercase hex characters', async () => {
    const good = sha('x');
    // A null is refused by NOT NULL (23502; Prisma's message shows the failing row, not the column).
    for (const [label, bad] of [
      ['null', null], ['empty', ''], ['short', good.slice(1)], ['long', `${good}0`],
      ['uppercase', good.toUpperCase()], ['not hex', `${good.slice(1)}g`], ['padded', ` ${good.slice(1)}`],
    ] as const) {
      expect({ label, side: 'ar', out: await sqlError(publish('terms_staff', v('sha'), { shaAr: bad })) })
        .toEqual({ label, side: 'ar', out: expect.stringMatching(/check constraint|content_sha256_ar|Code: `23502`/) });
      expect({ label, side: 'en', out: await sqlError(publish('terms_staff', v('sha'), { shaEn: bad })) })
        .toEqual({ label, side: 'en', out: expect.stringMatching(/check constraint|content_sha256_en|Code: `23502`/) });
    }
  });
  it('a published version is never updated, deleted or truncated', async () => {
    const ver = v('tf');
    await publish('terms_family', ver);
    expect(await sqlError(prisma.$executeRawUnsafe(`update chat.legal_document_version set url_en = 'https://jawwid.test/x' where version = $1`, ver))).toMatch(/never changed/);
    expect(await sqlError(prisma.$executeRawUnsafe(`update chat.legal_document_version set effective_at = now() + interval '1 day' where version = $1`, ver))).toMatch(/never changed/);
    expect(await sqlError(prisma.$executeRawUnsafe(`delete from chat.legal_document_version where version = $1`, ver))).toMatch(/never removed/);
    expect(await sqlError(prisma.$executeRawUnsafe(`truncate chat.legal_document_version cascade`))).toMatch(/never truncated/);
    expect(await prisma.$queryRawUnsafe(`select count(*)::int as n from chat.legal_document_version where version = $1`, ver)).toEqual([{ n: 1 }]);
  });
});

describe('PD-58 P-3: a version says whether it asks for acceptance again', () => {
  // The rule below is per document, so this block starts from no versions at all.
  beforeAll(truncateLegal);

  it('a document\'s first version always requires acceptance; after that a version may be published without it', async () => {
    const [first, typo, material] = [v('tt1'), v('tt1-typo'), v('tt2')];
    // A first version that asked nobody to accept would leave the gate with nothing to require.
    expect(await sqlError(publish('terms_teacher', first, { requiresReacceptance: false }))).toMatch(/first version .* requires acceptance/);
    expect(await versionOf('terms_teacher', first)).toBeUndefined();

    expect(await publish('terms_teacher', first)).toBe(true);
    expect(await publish('terms_teacher', typo, { requiresReacceptance: false })).toBe(true);
    expect(await publish('terms_teacher', material)).toBe(true);
    expect((await versionOf('terms_teacher', first))!.requires_reacceptance).toBe(true);
    expect((await versionOf('terms_teacher', typo))!.requires_reacceptance).toBe(false);
    expect((await versionOf('terms_teacher', material))!.requires_reacceptance).toBe(true);

    // The rule is per document: another document's first version is held to it too.
    expect(await sqlError(publish('terms_family', v('tf1'), { requiresReacceptance: false }))).toMatch(/first version .* requires acceptance/);
  });

  it('defaults to true, and a retry that changes it is refused', async () => {
    const ver = v('coc-default');
    await prisma.$queryRawUnsafe(
      `select chat.publish_legal_version('code_of_conduct', $1, 'https://jawwid.test/ar/d', 'https://jawwid.test/en/d', $2, $3)`,
      ver, sha('ar d'), sha('en d'),
    );
    expect((await versionOf('code_of_conduct', ver))!.requires_reacceptance).toBe(true);
    expect(await sqlError(publish('code_of_conduct', ver, {
      urlAr: 'https://jawwid.test/ar/d', urlEn: 'https://jawwid.test/en/d', shaAr: sha('ar d'), shaEn: sha('en d'), requiresReacceptance: false,
    }))).toMatch(/already published.*never changes/);
  });

  it('is never changed after publication', async () => {
    const ver = v('coc-fixed');
    await publish('code_of_conduct', ver);
    expect(await sqlError(prisma.$executeRawUnsafe(`update chat.legal_document_version set requires_reacceptance = false where version = $1`, ver))).toMatch(/never changed/);
    expect(await sqlError(prisma.$executeRawUnsafe(`update chat.legal_document_version set content_sha256_en = $2 where version = $1`, ver, sha('swap')))).toMatch(/never changed/);
  });
});

describe('PD-58: accepting', () => {
  it('records the account, the document, the version, the time, the client and the locale; once', async () => {
    const [tf, coc] = [v('tf'), v('coc')];
    await publish('terms_family', tf);
    await publish('code_of_conduct', coc);
    const fam = await account('family');

    expect(await accept(fam, [['terms_family', tf], ['code_of_conduct', coc]], 'ios', 'en', 'signup')).toBe(2);
    const first = await rowsOf(fam);
    expect(first.map((r) => [r.document_key, r.version, r.method, r.client, r.locale])).toEqual([
      ['code_of_conduct', coc, 'signup', 'ios', 'en'],
      ['terms_family', tf, 'signup', 'ios', 'en'],
    ]);

    // Accepting again records nothing new: the first acceptance, its time and its method, stand.
    expect(await accept(fam, [['terms_family', tf], ['code_of_conduct', coc]], 'web_portal', 'ar', 'gate')).toBe(0);
    expect(await rowsOf(fam)).toEqual(first);
  });

  it('P-2: records how the account accepted, sign-up or the gate, and refuses anything else', async () => {
    const [tf, coc] = [v('tf'), v('coc')];
    await publish('terms_family', tf);
    await publish('code_of_conduct', coc);
    const [atSignup, atGate, bad] = [await account('family'), await account('family'), await account('family')];
    expect(await accept(atSignup, [['terms_family', tf]], 'android', 'ar', 'signup')).toBe(1);
    expect(await accept(atGate, [['terms_family', tf]], 'android', 'ar', 'gate')).toBe(1);
    expect((await rowsOf(atSignup)).map((r) => r.method)).toEqual(['signup']);
    expect((await rowsOf(atGate)).map((r) => r.method)).toEqual(['gate']);

    for (const method of ['support', 'admin', 'SIGNUP', '', null]) {
      expect({ method, out: await sqlError(accept(bad, [['code_of_conduct', coc]], 'android', 'ar', method)) })
        .toEqual({ method, out: expect.stringMatching(/check constraint|method|Code: `23502`/) });
    }
    expect(await rowsOf(bad)).toEqual([]);
  });

  it('a new version is a new row; the older acceptance is kept with its timestamp', async () => {
    const [tt, coc1, coc2] = [v('tt'), v('coc1'), v('coc2')];
    for (const [k, ver] of [['terms_teacher', tt], ['code_of_conduct', coc1], ['code_of_conduct', coc2]] as const) await publish(k, ver);
    const teacher = await account('teacher');
    await accept(teacher, [['terms_teacher', tt], ['code_of_conduct', coc1]]);
    const before = await rowsOf(teacher);
    expect(await accept(teacher, [['code_of_conduct', coc2]], 'android', 'ar')).toBe(1);
    const after = await rowsOf(teacher);
    expect(after).toHaveLength(3);
    expect(after).toEqual(expect.arrayContaining(before));
  });

  it('the database stamps the time; an INSERT cannot backdate an acceptance', async () => {
    const ver = v('ts');
    await publish('terms_staff', ver);
    const staff = await account('staff');
    await prisma.$executeRawUnsafe(
      `insert into chat.terms_acceptance (account_id, document_key, version, accepted_at, method, client, locale)
       values ($1::uuid, 'terms_staff', $2, '2020-01-01T00:00:00Z', 'gate', 'admin_web', 'ar')`, staff, ver);
    const r = await prisma.$queryRawUnsafe<Array<{ fresh: boolean }>>(
      `select accepted_at > now() - interval '1 minute' as fresh from chat.terms_acceptance where account_id = $1::uuid`, staff);
    expect(r).toEqual([{ fresh: true }]);
  });

  it('each kind accepts only its own terms and the Code of Conduct (A-3)', async () => {
    const vers: Record<string, string> = {};
    for (const k of ['terms_family', 'terms_teacher', 'terms_staff', 'code_of_conduct']) {
      vers[k] = v(k);
      await publish(k, vers[k]!);
    }
    const allowed: Record<'family' | 'teacher' | 'staff', string> = { family: 'terms_family', teacher: 'terms_teacher', staff: 'terms_staff' };
    for (const kind of ['family', 'teacher', 'staff'] as const) {
      const id = await account(kind);
      for (const key of ['terms_family', 'terms_teacher', 'terms_staff']) {
        const out = await sqlError(accept(id, [[key, vers[key]!]]));
        if (key === allowed[kind]) expect({ kind, key, out }).toEqual({ kind, key, out: 'ok' });
        else expect({ kind, key, out }).toEqual({ kind, key, out: expect.stringMatching(/not a document a .* account accepts/) });
      }
      expect(await accept(id, [['code_of_conduct', vers.code_of_conduct!]])).toBe(1);
      expect((await rowsOf(id)).map((r) => r.document_key).sort()).toEqual(['code_of_conduct', allowed[kind]]);
    }
  });

  it('refuses an unpublished version, an unknown client, a malformed locale, an inactive or unknown account, an empty list', async () => {
    const ver = v('coc');
    await publish('code_of_conduct', ver);
    const fam = await account('family');
    expect(await sqlError(accept(fam, [['code_of_conduct', v('never-published')]]))).toMatch(/not published/);
    expect(await sqlError(accept(fam, [['code_of_conduct', ver]], 'desktop'))).toMatch(/check constraint|client/);
    expect(await sqlError(accept(fam, [['code_of_conduct', ver]], 'android', 'Arabic!'))).toMatch(/check constraint|locale/);
    expect(await sqlError(accept(await account('family', false), [['code_of_conduct', ver]]))).toMatch(/no such active account/);
    expect(await sqlError(accept(randomUUID(), [['code_of_conduct', ver]]))).toMatch(/no such active account/);
    expect(await sqlError(accept(fam, []))).toMatch(/at least one document/);
    // A refused call records nothing, not even the valid documents beside the bad one.
    const tf = v('tf');
    await publish('terms_family', tf);
    expect(await sqlError(accept(fam, [['terms_family', tf], ['terms_teacher', tf]]))).not.toBe('ok');
    expect(await rowsOf(fam)).toEqual([]);
  });
});

describe('PD-58: the acceptance record is immutable', () => {
  let fam: string;
  let ver: string;
  beforeAll(async () => {
    ver = v('coc');
    await publish('code_of_conduct', ver);
    fam = await account('family');
    await accept(fam, [['code_of_conduct', ver]]);
  });

  it('no UPDATE of any column, no DELETE, no TRUNCATE', async () => {
    for (const set of [
      `accepted_at = now() - interval '1 day'`, `client = 'ios'`, `locale = 'en'`, `method = 'signup'`, `version = version`,
      `account_id = account_id`, `document_key = document_key`,
    ]) {
      expect({ set, out: await sqlError(prisma.$executeRawUnsafe(`update chat.terms_acceptance set ${set} where account_id = $1::uuid`, fam)) })
        .toEqual({ set, out: expect.stringMatching(/never changed/) });
    }
    expect(await sqlError(prisma.$executeRawUnsafe(`delete from chat.terms_acceptance where account_id = $1::uuid`, fam))).toMatch(/never removed/);
    expect(await sqlError(prisma.$executeRawUnsafe(`truncate chat.terms_acceptance`))).toMatch(/never truncated/);
    expect(await rowsOf(fam)).toHaveLength(1);
  });

  it('an account that accepted cannot be hard-deleted, and the version it accepted cannot go', async () => {
    expect(await sqlError(prisma.$executeRawUnsafe(`delete from chat.account where id = $1::uuid`, fam))).toMatch(/foreign key|terms_acceptance/);
    expect(await sqlError(prisma.$executeRawUnsafe(`delete from chat.legal_document_version where version = $1`, ver))).toMatch(/never removed/);
    expect(await rowsOf(fam)).toHaveLength(1);
  });

  it('erasing the account keeps the acceptance as the consent record', async () => {
    const before = await rowsOf(fam);
    await prisma.$queryRawUnsafe(`select chat.erase_account($1::uuid, 'PD-58 spec: erasure keeps consent', '{}')`, fam);
    expect(await subjectOf(fam)).toBe(`erased:${fam}`);
    expect(await rowsOf(fam)).toEqual(before);
  });
});

describe('PD-58: RLS and privileges (fail-closed)', () => {
  it('a signed-in account reads only its own acceptances; it reads no version row and writes nothing', async () => {
    const ver = v('coc');
    await publish('code_of_conduct', ver);
    const [a, b] = [await account('family'), await account('teacher')];
    await accept(a, [['code_of_conduct', ver]]);
    await accept(b, [['code_of_conduct', ver]]);

    for (const role of ['chat_app', 'authenticated'] as const) {
      const out = await asRole(role, await subjectOf(a), async (tx) => ({
        mine: await tx.$queryRawUnsafe<Array<{ account_id: string }>>(`select account_id::text from chat.terms_acceptance`),
        versions: await attempt(tx, `select * from chat.legal_document_version`),
        insert: await attempt(tx, `insert into chat.terms_acceptance (account_id, document_key, version, method, client, locale) values ('${a}'::uuid, 'code_of_conduct', '${ver}', 'gate', 'ios', 'ar')`),
        update: await attempt(tx, `update chat.terms_acceptance set locale = 'en' where account_id = '${a}'::uuid`),
        delete: await attempt(tx, `delete from chat.terms_acceptance where account_id = '${a}'::uuid`),
        publish: await attempt(tx, `select chat.publish_legal_version('code_of_conduct', 'x', 'https://a.test', 'https://b.test', repeat('a', 64), repeat('b', 64), true, now(), null)`),
        acceptFn: await attempt(tx, `select chat.accept_legal_documents('${a}'::uuid, '[]'::jsonb, 'ios', 'ar', 'gate')`),
      }));
      expect({ role, ...out }).toEqual({
        role,
        mine: [{ account_id: a }],
        versions: expect.stringMatching(/permission denied/),
        insert: expect.stringMatching(/permission denied/),
        update: expect.stringMatching(/permission denied/),
        delete: expect.stringMatching(/permission denied/),
        publish: expect.stringMatching(/permission denied/),
        acceptFn: expect.stringMatching(/permission denied/),
      });
    }

    // Signed out, a request role sees nothing; anon cannot even read.
    expect(await asRole('chat_app', null, (tx) => tx.$queryRawUnsafe(`select * from chat.terms_acceptance`))).toEqual([]);
    expect(await asRole('anon', null, (tx) => attempt(tx, `select * from chat.terms_acceptance`))).toMatch(/permission denied/);
  });

  it('the grants and policies are exactly these: no blanket policy, no write grant to a request role', async () => {
    const policies = await prisma.$queryRawUnsafe<Array<{ tablename: string; policyname: string; cmd: string; roles: string; qual: string }>>(`
      select tablename::text, policyname::text, cmd::text, roles::text, qual::text from pg_policies
       where schemaname = 'chat' and tablename in ('legal_document_version', 'terms_acceptance') order by 1, 2`);
    expect(policies).toEqual([
      { tablename: 'terms_acceptance', policyname: 'terms_acceptance_own', cmd: 'SELECT', roles: '{authenticated}', qual: '(account_id = chat.current_account_id())' },
    ]);
    for (const role of ['anon', 'authenticated', 'chat_app']) {
      for (const [tbl, privs] of [
        ['chat.legal_document_version', ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']],
        ['chat.terms_acceptance', ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']],
      ] as const) {
        for (const priv of privs) {
          const r = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege($1, $2, $3) as ok`, role, tbl, priv);
          expect({ role, tbl, priv, ok: r[0]!.ok }).toEqual({ role, tbl, priv, ok: false });
        }
      }
      for (const fn of [
        'chat.publish_legal_version(text, text, text, text, text, text, boolean, timestamp with time zone, uuid)',
        'chat.accept_legal_documents(uuid, jsonb, text, text, text)',
        'chat.guard_legal_document_version()',
        'chat.guard_terms_acceptance()',
      ]) {
        const r = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, role, fn);
        expect({ role, fn, ok: r[0]!.ok }).toEqual({ role, fn, ok: false });
      }
    }
    const definers = await prisma.$queryRawUnsafe<Array<{ name: string; definer: boolean; pinned: boolean }>>(`
      select p.proname::text as name, p.prosecdef as definer,
             exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as pinned
        from pg_proc p where p.pronamespace = 'chat'::regnamespace
         and p.proname in ('publish_legal_version', 'accept_legal_documents') order by 1`);
    expect(definers).toEqual([
      { name: 'accept_legal_documents', definer: true, pinned: true },
      { name: 'publish_legal_version', definer: true, pinned: true },
    ]);
  });
});
