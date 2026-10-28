/**
 * PD-48 against the real database (migration 20261029230000):
 *
 *   - a clip is written only through the ingest path, never changed, removed
 *     or truncated; its text hash and object key are generated, not supplied;
 *     only `arabic-NNN` lessons exist (never `quran-` or `surah-`);
 *   - a review records the hashes heard, and is refused when they are not the
 *     clip's; only an active holder of lesson_audio.review OF THE CLIP'S
 *     ORGANIZATION reviews;
 *   - TWO different people approve a clip -- also when they approve at the same
 *     moment; the same person twice is refused; one rejection is final; only an
 *     approved clip is withdrawn;
 *   - "no audio" is decided only after three failed clips of a text, never
 *     while a clip of it is pending or approved, and is FINAL: no clip of that
 *     text is ingested or approved afterwards (review of #254, P1);
 *   - a fourth clip of a text goes in only after "one more round" (P2);
 *   - the Teachers manager holds review, a Teachers supervisor only view, and
 *     the pronunciation_reviewer template gives review to whom it is granted;
 *     seeding templates again adds and audits nothing;
 *   - request roles reach none of the tables or functions; every review is audited.
 *
 * Synthetic people and test strings only (G-20). Each run uses its own
 * organization: clips are never deleted, so runs must not meet.
 */
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from '@platform/auth/password';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd48-lesson-audio-spec-1';
const DOMAIN = 'pd48audio.qa.jawwid.test';
const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let otherOrg: string;
let otherOwner: string;
let reviewer: string;
const LESSON = 'arabic-001';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
// Test strings only: letters and marks.
const WORD = 'بَابْ';
const OTHER = 'دَارْ';
const THIRD = 'نَارْ';

type Clip = { id: string; audio: string; textSha256: string };

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

function insertClip(stringId: string, text: string, take = 1, opts: { org?: string; lesson?: string; ingest?: boolean } = {}) {
  const audio = sha(`${stringId}:${text}:${take}:${randomUUID()}`);
  const render = { v: 1, norm: 'exact-v1', vendor: 'azure', voice: 'ar-SA-HamedNeural', take };
  const org = opts.org ?? orgId;
  const lesson = opts.lesson ?? LESSON;
  return g.prisma
    .$transaction(async (tx) => {
      if (opts.ingest !== false) await tx.$executeRaw`SELECT set_config('chat.ingesting_lesson_audio', 'on', true)`;
      return tx.$queryRaw<Array<{ id: string; text_sha256: string; object_key: string }>>`
        INSERT INTO chat.lesson_audio_clip (organization_id, lesson_key, string_id, text, render, render_sha256, vendor, voice, audio_sha256, byte_size, attempt)
        VALUES (${org}::uuid, ${lesson}, ${stringId}, ${text}, ${JSON.stringify(render)}::jsonb, ${sha(JSON.stringify(render))}, 'azure', 'ar-SA-HamedNeural', ${audio}, 1000, ${take})
        RETURNING id::text, text_sha256, object_key`;
    })
    .then((rows) => {
      expect(rows[0]!.text_sha256).toBe(sha(text));
      expect(rows[0]!.object_key).toBe(`lesson-audio/${lesson}/${stringId}/${audio}.mp3`);
      return { id: rows[0]!.id, audio, textSha256: rows[0]!.text_sha256 } as Clip;
    });
}

const review = (clip: Clip, action: string, actor: string, category: string | null = null, reason: string | null = null) =>
  g.prisma.$queryRaw<Array<{ state: string }>>`
    SELECT chat.review_lesson_audio_clip(${clip.id}::uuid, ${action}, ${clip.textSha256}, ${clip.audio}, ${category}, ${reason}, ${actor}::uuid) AS state`.then((r) => r[0]!.state);

const decide = (stringId: string, text: string, decision: string, actor: string) =>
  g.prisma.$executeRaw`SELECT chat.decide_lesson_audio_string(${LESSON}, ${stringId}, ${sha(text)}, ${decision}, 'spec', ${actor}::uuid)`;

const holds = async (staff: string, key: string) =>
  (await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.staff_has_permission(${staff}::uuid, ${key}) AS ok`)[0]!.ok;

/** Three failed clips of a text: the round a decision follows. */
async function failRound(stringId: string, text: string, first = 1) {
  for (let take = first; take < first + 3; take++) await review(await insertClip(stringId, text, take), 'reject', reviewer, 'letter_sound', `take ${take} wrong`);
}

async function newOrg(slug: string): Promise<{ id: string; owner: string }> {
  const id = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${id}'::uuid, '${slug}-${id.slice(0, 8)}', 'PD-48 QA academy')`);
  const owner = await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: id, subject: `owner-${slug}@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    return (await tx.staff.create({ data: { organizationId: id, name: `QA Owner ${slug}`, role: 'super_admin', isActive: true, accountId: account.id } })).id;
  });
  return { id, owner };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  orgId = (await newOrg('pd48')).id;
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
  await g.prisma.$queryRaw`SELECT chat.seed_access_role_templates(${orgId}::uuid)`;
  // A specialist granted the Pronunciation reviewer template by the super admin.
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject: `reviewer@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
  reviewer = (await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Reviewer', role: 'specialist', isActive: true, accountId: account.id } })).id;
  const role = await g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text FROM chat.access_role WHERE organization_id = ${orgId}::uuid AND key = 'pronunciation_reviewer'`;
  await g.prisma.$queryRaw`SELECT chat.grant_access_role(${reviewer}::uuid, ${role[0]!.id}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;
  // Another academy, whose owner holds every key -- in their own organization.
  ({ id: otherOrg, owner: otherOwner } = await newOrg('pd48b'));
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$disconnect();
});

describe('PD-48: who reviews', () => {
  it('the Teachers manager holds review; a Teachers supervisor only view; the Operations manager neither; the template gives review', async () => {
    expect(await holds(m.teachersManager.id, 'lesson_audio.review')).toBe(true);
    expect(await holds(m.operationsManager.id, 'lesson_audio.view')).toBe(false);
    for (const s of m.teacherSupervisors) {
      expect(await holds(s.id, 'lesson_audio.view')).toBe(true);
      expect(await holds(s.id, 'lesson_audio.review')).toBe(false);
    }
    expect(await holds(reviewer, 'lesson_audio.review')).toBe(true);
    const template = await g.prisma.$queryRaw<Array<{ max_tier: string; keys: string[] }>>`
      SELECT r.max_tier, array_agg(p.permission_key ORDER BY p.permission_key) AS keys
        FROM chat.access_role r JOIN chat.access_role_permission p ON p.role_id = r.id
       WHERE r.organization_id = ${orgId}::uuid AND r.key = 'pronunciation_reviewer' GROUP BY r.max_tier`;
    expect(template).toEqual([{ max_tier: 'specialist', keys: ['lesson_audio.review', 'lesson_audio.view'] }]);
  });

  it('seeding the templates again adds nothing and audits nothing more', async () => {
    const audits = () => g.prisma.auditLog.count({ where: { action: { in: ['access_role.created', 'access_role.template_skipped'] } } });
    const before = await audits();
    const again = await g.prisma.$queryRaw<Array<{ n: number }>>`SELECT chat.seed_access_role_templates(${orgId}::uuid) AS n`;
    expect(again[0]!.n).toBe(0);
    expect(await audits()).toBe(before);
  });

  it('no request role reaches the tables or the functions', async () => {
    for (const t of ['lesson_audio_clip', 'lesson_audio_review', 'lesson_audio_string_decision']) {
      for (const role of ['chat_app', 'authenticated']) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
          const r = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege('${role}', 'chat.${t}', '${priv}') as ok`);
          expect({ t, role, priv, ok: r[0]!.ok }).toEqual({ t, role, priv, ok: false });
        }
      }
    }
    for (const fn of ['chat.review_lesson_audio_clip(uuid, text, text, text, text, text, uuid)', 'chat.decide_lesson_audio_string(text, text, text, text, text, uuid)']) {
      for (const role of ['chat_app', 'authenticated']) {
        const r = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_function_privilege('${role}', '${fn}', 'EXECUTE') as ok`);
        expect({ fn, role, ok: r[0]!.ok }).toEqual({ fn, role, ok: false });
      }
    }
  });
});

describe('PD-48: a clip is a record, written by the ingest only', () => {
  it('outside the ingest path an insert is refused; a clip is never updated, deleted or truncated', async () => {
    expect(await sqlError(insertClip('ba-900', WORD, 1, { ingest: false }))).toMatch(/written only by the server's ingest/);
    const c = await insertClip('ba-901', WORD);
    expect(await sqlError(g.prisma.$executeRaw`UPDATE chat.lesson_audio_clip SET byte_size = 2 WHERE id = ${c.id}::uuid`)).toMatch(/never changed or removed/);
    expect(await sqlError(g.prisma.$executeRaw`DELETE FROM chat.lesson_audio_clip WHERE id = ${c.id}::uuid`)).toMatch(/never changed or removed/);
    for (const t of ['lesson_audio_clip', 'lesson_audio_review', 'lesson_audio_string_decision']) {
      expect(await sqlError(g.prisma.$executeRawUnsafe(`truncate chat.${t} cascade`))).toMatch(/never truncated/);
    }
  });

  it('only arabic-NNN lessons: a quran- or surah- lesson key is refused', async () => {
    for (const lesson of ['quran-001', 'surah-085', 'islamic-001']) {
      expect(await sqlError(insertClip('ba-902', WORD, 1, { lesson }))).toMatch(/lesson_key|check constraint/);
    }
  });

  it('reviews and decisions are records too: never updated or deleted', async () => {
    const c = await insertClip('ba-903', WORD);
    await review(c, 'approve', reviewer);
    expect(await sqlError(g.prisma.$executeRaw`UPDATE chat.lesson_audio_review SET reason = 'x' WHERE clip_id = ${c.id}::uuid`)).toMatch(/never changed or removed/);
    expect(await sqlError(g.prisma.$executeRaw`DELETE FROM chat.lesson_audio_review WHERE clip_id = ${c.id}::uuid`)).toMatch(/never changed or removed/);
    await failRound('ba-904', THIRD);
    await decide('ba-904', THIRD, 'one_more_round', reviewer);
    expect(await sqlError(g.prisma.$executeRaw`UPDATE chat.lesson_audio_string_decision SET reason = 'x' WHERE string_id = 'ba-904'`)).toMatch(/never changed or removed/);
    expect(await sqlError(g.prisma.$executeRaw`DELETE FROM chat.lesson_audio_string_decision WHERE string_id = 'ba-904'`)).toMatch(/never changed or removed/);
  });
});

describe('PD-48: two different people approve exactly what they heard', () => {
  it('wrong hashes are refused; a listener without review is refused; one approval is pending, two are approved', async () => {
    const c = await insertClip('ba-001', WORD);
    expect(await sqlError(review({ ...c, audio: 'f'.repeat(64) }, 'approve', m.teachersManager.id))).toMatch(/not this clip/);
    expect(await sqlError(review(c, 'approve', m.teacherSupervisors[0]!.id))).toMatch(/lesson_audio\.review/);
    expect(await review(c, 'approve', m.teachersManager.id)).toBe('pending');
    expect(await sqlError(review(c, 'approve', m.teachersManager.id))).toMatch(/already approved this clip/);
    expect(await review(c, 'approve', reviewer)).toBe('approved');
    // Approved: a reject now is refused (withdraw it instead), and withdrawing is final.
    expect(await sqlError(review(c, 'reject', reviewer, 'vowel', 'x'))).toMatch(/approved/);
    expect(await review(c, 'withdraw', reviewer, 'final_sukun', 'heard a vowel at the end')).toBe('withdrawn');
    expect(await sqlError(review(c, 'approve', m.superAdmin.id))).toMatch(/withdrawn/);
    const audit = await g.prisma.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM chat.audit_log WHERE entity = 'lesson_audio_clip' AND entity_id = ${c.id}::uuid ORDER BY at, id`;
    expect(audit.map((a) => a.action)).toEqual(['lesson_audio.approved', 'lesson_audio.approved', 'lesson_audio.withdrawn']);
  });

  it('one rejection is final, even after an approval; a reject needs a reason', async () => {
    const c = await insertClip('ba-002', WORD);
    expect(await review(c, 'approve', m.teachersManager.id)).toBe('pending');
    expect(await sqlError(review(c, 'reject', reviewer, 'shadda', null))).toMatch(/lesson_audio_review_reason|violates/);
    expect(await review(c, 'reject', reviewer, 'shadda', 'no shadda heard')).toBe('rejected');
    expect(await sqlError(review(c, 'approve', reviewer))).toMatch(/rejected/);
    const rows = await g.prisma.$queryRaw<Array<{ text_sha256: string; audio_sha256: string }>>`
      SELECT text_sha256, audio_sha256 FROM chat.lesson_audio_review WHERE clip_id = ${c.id}::uuid AND action = 'reject'`;
    expect(rows).toEqual([{ text_sha256: sha(WORD), audio_sha256: c.audio }]);
  });

  it('at the same moment: two reviewers make it approved once; one reviewer twice is one approval', async () => {
    const c = await insertClip('ba-003', WORD);
    const both = await Promise.allSettled([review(c, 'approve', reviewer), review(c, 'approve', m.teachersManager.id)]);
    expect(both.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((both as Array<PromiseFulfilledResult<string>>).map((r) => r.value).sort()).toEqual(['approved', 'pending']);
    const d = await insertClip('ba-004', WORD);
    const twice = await Promise.allSettled([review(d, 'approve', reviewer), review(d, 'approve', reviewer)]);
    expect(twice.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const n = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM chat.lesson_audio_review WHERE clip_id = ${d.id}::uuid`;
    expect(n).toEqual([{ n: 1n }]);
  });

  it("only a reviewer of the clip's organization reviews it, even one who holds every key elsewhere", async () => {
    const c = await insertClip('ba-005', WORD);
    expect(await holds(otherOwner, 'lesson_audio.review')).toBe(true);
    expect(await sqlError(review(c, 'approve', otherOwner))).toMatch(/of the clip's organization/);
    // Their organization's clip of the same string is theirs alone: a clip is per organization.
    const theirs = await insertClip('ba-005', WORD, 1, { org: otherOrg });
    expect(await review(theirs, 'approve', otherOwner)).toBe('pending');
    expect(await sqlError(review(theirs, 'approve', reviewer))).toMatch(/of the clip's organization/);
  });
});

describe('PD-48: when the computer voice cannot get a word right', () => {
  it('"no audio" only after three failed clips of that text; then final; then no clip of that text is ingested', async () => {
    const id = 'ta-001';
    expect(await sqlError(decide(id, OTHER, 'no_audio', reviewer))).toMatch(/after 3 failed clips/);
    await failRound(id, OTHER);
    expect(await sqlError(decide(id, OTHER, 'no_audio', m.teacherSupervisors[0]!.id))).toMatch(/lesson_audio\.review/);
    await decide(id, OTHER, 'no_audio', reviewer);
    expect(await sqlError(decide(id, OTHER, 'one_more_round', reviewer))).toMatch(/already has no audio/);
    expect(await sqlError(insertClip(id, OTHER, 4))).toMatch(/has no audio by a reviewer's decision/);
    // A changed word may be tried again: the decision is bound to the old text.
    expect((await insertClip(id, WORD, 1)).textSha256).toBe(sha(WORD));
  });

  it('a fourth clip of a text goes in only after "one more round"; the next decision needs three more failures', async () => {
    const id = 'tha-001';
    await failRound(id, WORD);
    expect(await sqlError(insertClip(id, WORD, 4))).toMatch(/failed 3 clips: a reviewer decides/);
    await decide(id, WORD, 'one_more_round', m.teachersManager.id);
    const take4 = await insertClip(id, WORD, 4);
    expect(await sqlError(decide(id, WORD, 'no_audio', reviewer))).toMatch(/pending or approved/);
    await review(take4, 'reject', reviewer, 'vowel', 'wrong');
    expect(await sqlError(decide(id, WORD, 'no_audio', reviewer))).toMatch(/after 6 failed clips/);
  });

  it('review of #254 (P1): "no audio" cannot be reached past a clip, and a clip cannot be approved past "no audio"', async () => {
    const id = 'jim-001';
    // Three failed takes, one more round, take 4 pending: reviewer A cannot silence the string while it waits.
    await failRound(id, WORD);
    await decide(id, WORD, 'one_more_round', reviewer);
    const take4 = await insertClip(id, WORD, 4);
    expect(await sqlError(decide(id, WORD, 'no_audio', m.superAdmin.id))).toMatch(/pending or approved: withdraw or reject it/);
    // B and C approve it: it is approved. Then "no audio" still needs the clip withdrawn first.
    expect(await review(take4, 'approve', reviewer)).toBe('pending');
    expect(await review(take4, 'approve', m.teachersManager.id)).toBe('approved');
    expect(await sqlError(decide(id, WORD, 'no_audio', m.superAdmin.id))).toMatch(/pending or approved/);
    // And should a "no audio" exist beside a pending clip at all (written by hand, as the
    // owner role could), the clip is never approved: the approve guard checks the decision itself.
    const id2 = 'jim-002';
    const pending = await insertClip(id2, WORD, 1);
    await g.prisma.$executeRaw`
      INSERT INTO chat.lesson_audio_string_decision (organization_id, lesson_key, string_id, text_sha256, decision, staff_id, reason)
      VALUES (${orgId}::uuid, ${LESSON}, ${id2}, ${sha(WORD)}, 'no_audio', ${reviewer}::uuid, 'written by hand in this spec')`;
    expect(await sqlError(review(pending, 'approve', reviewer))).toMatch(/never approved/);
  });
});
