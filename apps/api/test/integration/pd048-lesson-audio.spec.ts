/**
 * PD-48 against the real database (migration 20261029230000):
 *
 *   - a clip is written only through the ingest path, never changed or
 *     removed; its text hash and object key are generated, not supplied;
 *   - a review records the hashes heard, and is refused when they are not the
 *     clip's; only an active holder of lesson_audio.review reviews;
 *   - TWO different people approve a clip; the same person twice is refused;
 *     one rejection is final; only an approved clip is withdrawn;
 *   - "no audio" is decided only after three failed clips of a text, is final
 *     for that text, and then no clip of that text can be ingested;
 *   - the Teachers manager holds review, a Teachers supervisor only view, and
 *     the pronunciation_reviewer template gives review to whom it is granted;
 *   - request roles reach none of the tables; every review is audited.
 *
 * Synthetic people and test strings only (G-20). Each run uses its own lesson
 * key: clips are never deleted, so runs must not meet.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { hashPassword } from '@platform/auth/password';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd48-lesson-audio-spec-1';
const DOMAIN = 'pd48audio.qa.jawwid.test';
const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let reviewer: string;
const LESSON = `spec-${String(randomInt(100, 999))}`;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
// Test strings only: letters and marks, written as escapes.
const WORD = 'بَابْ';
const OTHER = 'دَارْ';

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

async function ingest(stringId: string, text: string, take = 1): Promise<{ id: string; audio: string; textSha256: string }> {
  const audio = sha(`${stringId}:${text}:${take}:${randomUUID()}`);
  const render = { v: 1, norm: 'exact-v1', vendor: 'azure', voice: 'ar-SA-HamedNeural', take };
  const rows = await g.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('chat.ingesting_lesson_audio', 'on', true)`;
    return tx.$queryRaw<Array<{ id: string; text_sha256: string; object_key: string }>>`
      INSERT INTO chat.lesson_audio_clip (lesson_key, string_id, text, render, render_sha256, vendor, voice, audio_sha256, byte_size, attempt)
      VALUES (${LESSON}, ${stringId}, ${text}, ${JSON.stringify(render)}::jsonb, ${sha(JSON.stringify(render))}, 'azure', 'ar-SA-HamedNeural', ${audio}, 1000, ${take})
      RETURNING id::text, text_sha256, object_key`;
  });
  expect(rows[0]!.text_sha256).toBe(sha(text));
  expect(rows[0]!.object_key).toBe(`lesson-audio/${LESSON}/${stringId}/${audio}.mp3`);
  return { id: rows[0]!.id, audio, textSha256: rows[0]!.text_sha256 };
}

const review = (clip: { id: string; audio: string; textSha256: string }, action: string, actor: string, category: string | null = null, reason: string | null = null) =>
  g.prisma.$queryRaw<Array<{ state: string }>>`
    SELECT chat.review_lesson_audio_clip(${clip.id}::uuid, ${action}, ${clip.textSha256}, ${clip.audio}, ${category}, ${reason}, ${actor}::uuid) AS state`.then((r) => r[0]!.state);

const decide = (stringId: string, text: string, decision: string, actor: string) =>
  g.prisma.$executeRaw`SELECT chat.decide_lesson_audio_string(${LESSON}, ${stringId}, ${sha(text)}, ${decision}, 'spec', ${actor}::uuid)`;

const holds = async (staff: string, key: string) =>
  (await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.staff_has_permission(${staff}::uuid, ${key}) AS ok`)[0]!.ok;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd48-${orgId.slice(0, 8)}', 'PD-48 QA academy')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
  await g.prisma.$queryRaw`SELECT chat.seed_access_role_templates(${orgId}::uuid)`;
  // A specialist granted the Pronunciation reviewer template by the super admin.
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject: `reviewer@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
  reviewer = (await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Reviewer', role: 'specialist', isActive: true, accountId: account.id } })).id;
  const role = await g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text FROM chat.access_role WHERE organization_id = ${orgId}::uuid AND key = 'pronunciation_reviewer'`;
  await g.prisma.$queryRaw`SELECT chat.grant_access_role(${reviewer}::uuid, ${role[0]!.id}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;
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

  it('no request role reaches the tables', async () => {
    for (const t of ['lesson_audio_clip', 'lesson_audio_review', 'lesson_audio_string_decision']) {
      for (const role of ['chat_app', 'authenticated']) {
        const r = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege('${role}', 'chat.${t}', 'SELECT') as ok`);
        expect({ t, role, ok: r[0]!.ok }).toEqual({ t, role, ok: false });
      }
    }
  });
});

describe('PD-48: a clip is a record, written by the ingest only', () => {
  it('outside the ingest path an insert is refused; a clip is never updated or deleted', async () => {
    expect(
      await sqlError(g.prisma.$executeRaw`
        INSERT INTO chat.lesson_audio_clip (lesson_key, string_id, text, render, render_sha256, vendor, voice, audio_sha256, byte_size, attempt)
        VALUES (${LESSON}, 'ba-900', ${WORD}, '{"vendor":"azure","voice":"ar-SA-HamedNeural"}'::jsonb, ${'b'.repeat(64)}, 'azure', 'ar-SA-HamedNeural', ${'c'.repeat(64)}, 1, 1)`),
    ).toMatch(/written only by the server's ingest/);
    const c = await ingest('ba-901', WORD);
    expect(await sqlError(g.prisma.$executeRaw`UPDATE chat.lesson_audio_clip SET byte_size = 2 WHERE id = ${c.id}::uuid`)).toMatch(/never changed or removed/);
    expect(await sqlError(g.prisma.$executeRaw`DELETE FROM chat.lesson_audio_clip WHERE id = ${c.id}::uuid`)).toMatch(/never changed or removed/);
  });
});

describe('PD-48: two different people approve exactly what they heard', () => {
  it('wrong hashes are refused; a listener without review is refused; one approval is pending, two are approved', async () => {
    const c = await ingest('ba-001', WORD);
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
    const c = await ingest('ba-002', WORD);
    expect(await review(c, 'approve', m.teachersManager.id)).toBe('pending');
    expect(await sqlError(review(c, 'reject', reviewer, 'shadda', null))).toMatch(/lesson_audio_review_reason|violates/);
    expect(await review(c, 'reject', reviewer, 'shadda', 'no shadda heard')).toBe('rejected');
    expect(await sqlError(review(c, 'approve', reviewer))).toMatch(/rejected/);
    const rows = await g.prisma.$queryRaw<Array<{ text_sha256: string; audio_sha256: string }>>`
      SELECT text_sha256, audio_sha256 FROM chat.lesson_audio_review WHERE clip_id = ${c.id}::uuid AND action = 'reject'`;
    expect(rows).toEqual([{ text_sha256: sha(WORD), audio_sha256: c.audio }]);
  });
});

describe('PD-48: when the computer voice cannot get a word right', () => {
  it('"no audio" only after three failed clips of that text; then final; then no clip of that text is ingested', async () => {
    const id = 'ta-001';
    expect(await sqlError(decide(id, OTHER, 'no_audio', reviewer))).toMatch(/after 3 failed clips/);
    for (let take = 1; take <= 3; take++) await review(await ingest(id, OTHER, take), 'reject', reviewer, 'letter_sound', `take ${take} wrong`);
    expect(await sqlError(decide(id, OTHER, 'no_audio', m.teacherSupervisors[0]!.id))).toMatch(/lesson_audio\.review/);
    await decide(id, OTHER, 'no_audio', reviewer);
    expect(await sqlError(decide(id, OTHER, 'one_more_round', reviewer))).toMatch(/already has no audio/);
    expect(await sqlError(ingest(id, OTHER, 4))).toMatch(/has no audio by a reviewer's decision/);
    // A changed word may be tried again: the decision is bound to the old text.
    expect((await ingest(id, WORD, 1)).textSha256).toBe(sha(WORD));
  });

  it('one more round needs three more failures before the next decision', async () => {
    const id = 'tha-001';
    for (let take = 1; take <= 3; take++) await review(await ingest(id, WORD, take), 'reject', reviewer, 'vowel', 'wrong');
    await decide(id, WORD, 'one_more_round', m.teachersManager.id);
    expect(await sqlError(decide(id, WORD, 'no_audio', reviewer))).toMatch(/after 6 failed clips/);
  });
});
