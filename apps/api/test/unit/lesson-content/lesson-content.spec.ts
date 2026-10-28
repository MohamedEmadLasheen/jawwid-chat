/**
 * PD-49: the review of children's Quran content and of game mechanics
 * (docs/product/pd049-children-quran-experience-plan.md §F.2-§F.3).
 *
 * A child sees an item only when its CURRENT text has every review step its
 * kind needs, and is neither rejected nor withdrawn; a signature names the
 * text it is for. Pure: a fake store and fake permissions (the database rules
 * are in test/integration/pd049-lesson-content.spec.ts).
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommError } from '@platform/errors';
import { legacyLessonContentKeys, lessonContentAccess } from '@platform/lesson-content-policy';
import { LessonContentService, itemStatus, refusal } from '../../../src/lesson-content/lesson-content.service';
import type { LessonContentStore, ReviewRow } from '../../../src/lesson-content/lesson-content.store';
import { ApprovalsSigner, keyIdOf, readSigningKey } from '../../../src/lesson-content/approvals-signer';
import { PINNED_QURAN_DATASETS } from '../../../src/quran/pinned';
import { approvalSha256, canonicalJson, canonicalSha256, parseScope, parseSubjects, reviewScope, type Scope } from '../../../src/lesson-content/review-subjects';
import { Prisma } from '@prisma/client';
import { admin, manager, parent, teacher } from '../../support/fixtures';

// The fixtures' staff belong to this organization; it is the content organization unless a test says otherwise.
const ORG = admin().organizationId!;

const DS = [...PINNED_QURAN_DATASETS.keys()][0]!;
const sha = (item: unknown, scope = 'quran-112') => approvalSha256(DS, scope, item);
const VECTORS = join(__dirname, '../../../../lessons/src/content/item-hash.vectors.json');

// Test items only (not lesson content).
const TAFSIR = { id: 'tafsir-001', kind: 'tafsir', bands: ['6-8'], text: 'شرح', ayah: 1, source: { work: 'saadi', ref: '112:1' } };
const WORD = { id: 'word-001', kind: 'word', bands: ['6-8'], text: 'معنى', ayah: 1, word: 1, to: 1, source: { work: 'saadi', ref: '112:1' } };

function scope(): Scope {
  const s = parseScope({
    scope: 'quran-112',
    datasetId: DS,
    subjects: [
      { id: 'tafsir-001', kind: 'tafsir', approvalSha256: sha(TAFSIR), requiredSteps: ['check', 'teacher', 'scholar'], item: TAFSIR },
      { id: 'word-001', kind: 'word', approvalSha256: sha(WORD), requiredSteps: ['check', 'teacher'], item: WORD },
    ],
  });
  if (!s) throw new Error('fixture');
  return s;
}

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  itemId: 'tafsir-001',
  approvalSha256: sha(TAFSIR),
  step: 'check',
  action: 'approve',
  staffId: 'staff-1',
  staffName: 'Reviewer',
  category: null,
  reason: null,
  at: new Date('2026-10-29T10:00:00Z'),
  ...over,
});

class FakeStore implements LessonContentStore {
  rows: ReviewRow[] = [];
  reviewed: unknown[] = [];
  org: string | null = ORG;
  granted = new Set<string>();
  async contentOrganization() {
    return this.org;
  }
  async scholarGranted(staffId: string) {
    return this.granted.has(staffId);
  }
  async reviews() {
    return this.rows;
  }
  async review(...args: unknown[]) {
    this.reviewed.push(args);
    return { state: 'open', steps: ['check'] };
  }
}

const permissions = (keys: string[]) => ({ profileOf: async () => ({ tier: 'x', departmentKind: null, placement: null, permissions: new Set(keys) }) });

// A throwaway Ed25519 key, as the owner would generate one (never a real key in the repo).
const PEM = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const SIGNER = new ApprovalsSigner(PEM);

function service(keys: string[], store = new FakeStore(), signer: ApprovalsSigner = SIGNER) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { store, svc: new LessonContentService(store, permissions(keys) as any, (s) => (s === 'quran-112' ? scope() : null), signer) };
}

const refused = async (p: Promise<unknown>, code: string, status?: number) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(CommError);
  expect((e as CommError).code).toBe(code);
  if (status) expect((e as CommError).status).toBe(status);
};

describe('the review subjects (generated from apps/lessons)', () => {
  it('hash an item exactly as the lessons engine and its Python checker do', () => {
    const vectors = JSON.parse(readFileSync(VECTORS, 'utf8')) as Array<{ item: unknown; sha256: string }>;
    expect(vectors.length).toBeGreaterThan(0);
    for (const v of vectors) expect(canonicalSha256(v.item)).toBe(v.sha256);
    // A signature binds the item to its dataset and lesson, as apps/lessons approvalSha256.
    expect(sha(WORD)).toBe(canonicalSha256({ datasetId: DS, item: WORD, lessonKey: 'quran-112' }));
    expect(sha(WORD, 'quran-113')).not.toBe(sha(WORD));
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });

  it('refuse a scope whose item does not hash to its own approvalSha256, or that is malformed', () => {
    const good = { id: 'word-001', kind: 'word', approvalSha256: sha(WORD), requiredSteps: ['check', 'teacher'], item: WORD };
    expect(parseScope({ scope: 'quran-112', datasetId: DS, subjects: [good] })).not.toBeNull();
    expect(parseScope({ scope: 'quran-112', datasetId: DS, subjects: [{ ...good, approvalSha256: '0'.repeat(64) }] })).toBeNull();
    expect(parseScope({ scope: 'quran-112', datasetId: DS, subjects: [{ ...good, id: 'word-1' }] })).toBeNull();
    expect(parseScope({ scope: 'quran-112', datasetId: DS, subjects: [good, good] })).toBeNull();
    expect(parseScope({ scope: 'quran-112', datasetId: DS, subjects: [{ ...good, requiredSteps: ['owner'] }] })).toBeNull();
    expect(parseScope({ scope: 'surah-112', datasetId: DS, subjects: [good] })).toBeNull();
    // A dataset that is not pinned in the API is no scope at all.
    expect(parseScope({ scope: 'quran-112', datasetId: 'other-dataset', subjects: [good] })).toBeNull();
    // A mechanic has no source to check.
    const m = { id: 'listen_glow', version: 1 };
    expect(parseScope({ scope: 'play', datasetId: DS, subjects: [{ id: 'listen_glow', kind: 'mechanic', approvalSha256: sha(m, 'play'), requiredSteps: ['teacher', 'scholar'], item: m }] })).not.toBeNull();
    expect(parseScope({ scope: 'play', datasetId: DS, subjects: [{ id: 'listen_glow', kind: 'mechanic', approvalSha256: sha(m, 'play'), requiredSteps: ['check', 'teacher'], item: m }] })).toBeNull();
    // One bad scope never hides the good ones.
    expect([...parseSubjects({ scopes: [{ scope: 'quran-112', datasetId: DS, subjects: [good] }, { scope: 'quran-113', datasetId: DS, subjects: 'x' }] }).keys()]).toEqual(['quran-112']);
  });

  it('every committed scope parses: a malformed or unpinned scope fails CI, never silently disappears', () => {
    const committed = JSON.parse(readFileSync(join(__dirname, '../../../src/lesson-content/review-subjects.json'), 'utf8')) as { scopes: unknown[] };
    expect(parseSubjects(committed).size).toBe(committed.scopes.length);
  });

  it('the committed map holds no content yet: nothing can be reviewed before content exists', () => {
    expect(reviewScope('quran-112')).toBeNull();
    expect(reviewScope('play')).toBeNull();
  });
});

describe('an item status', () => {
  const tafsir = { id: 'tafsir-001', approvalSha256: sha(TAFSIR), requiredSteps: ['check', 'teacher', 'scholar'] as const };
  const t = { ...tafsir, requiredSteps: [...tafsir.requiredSteps] };

  it('is approved only with every required step signed for the current text', () => {
    expect(itemStatus(t, [row({ step: 'check' }), row({ step: 'teacher', staffId: 's2' })]).approved).toBe(false);
    const full = [row({ step: 'check' }), row({ step: 'teacher', staffId: 's2' }), row({ step: 'scholar', staffId: 's3' })];
    expect(itemStatus(t, full)).toEqual({ state: 'open', signed: ['check', 'teacher', 'scholar'], approved: true, stale: false });
  });

  it('a rejection or a withdrawal is final for that text', () => {
    const full = [row({ step: 'check' }), row({ step: 'teacher', staffId: 's2' }), row({ step: 'scholar', staffId: 's3' })];
    expect(itemStatus(t, [...full, row({ step: 'scholar', action: 'withdraw', staffId: 's3', category: 'aqeedah', reason: 'x' })])).toMatchObject({ state: 'withdrawn', approved: false });
    expect(itemStatus(t, [row({ step: 'teacher', action: 'reject', staffId: 's2', category: 'language', reason: 'x' })])).toMatchObject({ state: 'rejected', approved: false });
  });

  it('signatures of an earlier text do not count, and show the item as stale', () => {
    const old = '1'.repeat(64);
    const full = [row({ step: 'check', approvalSha256: old }), row({ step: 'teacher', staffId: 's2', approvalSha256: old }), row({ step: 'scholar', staffId: 's3', approvalSha256: old })];
    expect(itemStatus(t, full)).toEqual({ state: 'open', signed: [], approved: false, stale: true });
  });
});

describe('LessonContentService', () => {
  const body = (over: Record<string, unknown> = {}) => ({ step: 'check', approvalSha256: sha(TAFSIR), ...over });

  it('lists a scope for anyone holding view or a step key, and nobody else', async () => {
    const { svc } = service(['lesson_content.view']);
    const out = await svc.list('quran-112', admin());
    expect(out.items.map((i) => [i.id, i.next, i.canSign])).toEqual([
      ['tafsir-001', 'check', false],
      ['word-001', 'check', false],
    ]);
    await refused(service([]).svc.list('quran-112', admin()), 'COMM.LESSON_CONTENT_DENIED', 403);
    await refused(service(['lesson_content.view']).svc.list('quran-999', admin()), 'COMM.LESSON_CONTENT_NOT_FOUND', 404);
  });

  it('signs only the step the reviewer holds the key for, of the text as built', async () => {
    const { svc, store } = service(['lesson_content.check']);
    await svc.review('quran-112', 'tafsir-001', 'approve', body(), admin('checker-1'));
    expect(store.reviewed).toEqual([['quran-112', 'tafsir-001', sha(TAFSIR), 'check', 'approve', null, null, 'checker-1']]);
    await refused(svc.review('quran-112', 'tafsir-001', 'approve', body({ step: 'scholar' }), admin()), 'COMM.LESSON_CONTENT_DENIED', 403);
    await refused(svc.review('quran-112', 'tafsir-001', 'approve', body({ step: 'owner' }), admin()), 'COMM.LESSON_CONTENT_INVALID', 422);
    await refused(svc.review('quran-112', 'tafsir-404', 'approve', body(), admin()), 'COMM.LESSON_CONTENT_NOT_FOUND', 404);
    await refused(svc.review('quran-112', 'tafsir-001', 'publish', body(), admin()), 'COMM.LESSON_CONTENT_INVALID', 422);
  });

  it('refuses a signature of a text the reviewer did not read (the item changed)', async () => {
    const { svc, store } = service(['lesson_content.check']);
    await refused(svc.review('quran-112', 'tafsir-001', 'approve', body({ approvalSha256: '2'.repeat(64) }), admin()), 'COMM.LESSON_CONTENT_STATE', 409);
    await refused(svc.review('quran-112', 'tafsir-001', 'approve', body({ approvalSha256: 'nope' }), admin()), 'COMM.LESSON_CONTENT_INVALID', 422);
    expect(store.reviewed).toEqual([]);
  });

  it("the scholar step counts only through an explicit grant: the super admin's implicit key never signs as the scholar", async () => {
    // Every key (as the super admin holds them), but no Scholar reviewer role.
    const { svc } = service(['lesson_content.view', 'lesson_content.check', 'lesson_content.review_teacher', 'lesson_content.review_scholar']);
    expect((await svc.access(admin('sa', 'super_admin'))).steps).toEqual(['check', 'teacher']);
    await refused(svc.review('quran-112', 'tafsir-001', 'approve', body({ step: 'scholar' }), admin('sa', 'super_admin')), 'COMM.LESSON_CONTENT_DENIED', 403);
  });

  it('only the content organization reviews; nobody while it is unset', async () => {
    const other = { ...admin('elsewhere'), organizationId: '00000000-0000-4000-8000-0000000000ff' };
    await refused(service(['lesson_content.view']).svc.list('quran-112', other), 'COMM.LESSON_CONTENT_DENIED', 403);
    const unset = new FakeStore();
    unset.org = null;
    await refused(service(['lesson_content.view'], unset).svc.list('quran-112', admin()), 'COMM.LESSON_CONTENT_DENIED', 403);
  });

  it('a rejection or withdrawal says what is wrong and why; an approval carries neither', async () => {
    const granted = new FakeStore();
    granted.granted.add('scholar-1');
    granted.granted.add('admin-1');
    const { svc, store } = service(['lesson_content.review_scholar'], granted);
    await refused(svc.review('quran-112', 'tafsir-001', 'reject', body({ step: 'scholar' }), admin()), 'COMM.LESSON_CONTENT_INVALID', 422);
    await refused(svc.review('quran-112', 'tafsir-001', 'reject', body({ step: 'scholar', category: 'aqeedah' }), admin()), 'COMM.LESSON_CONTENT_INVALID', 422);
    await svc.review('quran-112', 'tafsir-001', 'reject', body({ step: 'scholar', category: 'aqeedah', reason: '  not as the source says  ' }), admin('scholar-1'));
    expect(store.reviewed).toEqual([['quran-112', 'tafsir-001', sha(TAFSIR), 'scholar', 'reject', 'aqeedah', 'not as the source says', 'scholar-1']]);
  });

  it('exports only items whose current text has every step it needs, with their signers, SIGNED', async () => {
    const store = new FakeStore();
    store.rows = [
      // tafsir: all three steps, current text.
      row({ step: 'check' }),
      row({ step: 'teacher', staffId: 's2' }),
      row({ step: 'scholar', staffId: 's3' }),
      // word: only the check.
      row({ itemId: 'word-001', approvalSha256: sha(WORD), step: 'check' }),
    ];
    const { svc } = service(['lesson_content.view'], store);
    const at = '2026-10-29T10:00:00.000Z';
    const out = await svc.export('quran-112', admin());
    expect(out.payload).toEqual({
      v: 1,
      env: process.env.APP_ENV ?? 'local',
      issuedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      datasetId: DS,
      lessonKey: 'quran-112',
      approvals: [
        {
          id: 'tafsir-001',
          approvalSha256: sha(TAFSIR),
          steps: ['check', 'teacher', 'scholar'],
          signers: [
            { step: 'check', staffId: 'staff-1', at },
            { step: 'teacher', staffId: 's2', at },
            { step: 'scholar', staffId: 's3', at },
          ],
        },
      ],
    });
    // The signature verifies over the canonical payload under the key the id names.
    expect(out.keyId).toBe(SIGNER.keyId);
    const pub = createPublicKey(readSigningKey(PEM)!);
    expect(keyIdOf(pub)).toBe(out.keyId);
    expect(verify(null, Buffer.from(canonicalJson(out.payload), 'utf8'), pub, Buffer.from(out.signature, 'base64'))).toBe(true);
    expect(verify(null, Buffer.from(canonicalJson({ ...out.payload, approvals: [] }), 'utf8'), pub, Buffer.from(out.signature, 'base64'))).toBe(false);
    store.rows.push(row({ step: 'teacher', action: 'withdraw', staffId: 's2', category: 'wrong_meaning', reason: 'x' }));
    expect((await svc.export('quran-112', admin())).payload.approvals).toEqual([]);
  });

  it("signs exactly the shared golden vector (verify-approvals.mjs verifies it; check-quran-content.py reads it)", () => {
    const golden = JSON.parse(readFileSync(join(__dirname, '../../../../lessons/src/content/approvals.golden.json'), 'utf8'));
    // The TEST-ONLY seed of the golden vector; its key is not in approvals-keys.json, so it approves nothing real.
    const seed = createHash('sha256').update('PD-49 golden vector: a TEST-ONLY key, never a real one').digest();
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    const signer = new ApprovalsSigner(der.toString('base64'));
    expect(signer.keyId).toBe(golden.key.id);
    expect(signer.sign(golden.envelope.payload)).toEqual(golden.envelope);
    expect(createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).toString('base64')).toBe(golden.key.publicKey);
  });

  it('exports nothing unsigned: no signing key is a 503', async () => {
    const { svc } = service(['lesson_content.view'], new FakeStore(), new ApprovalsSigner(undefined));
    await refused(svc.export('quran-112', admin()), 'COMM.LESSON_CONTENT_SIGNING_UNAVAILABLE', 503);
    expect(new ApprovalsSigner('not a key').available).toBe(false);
    // Only an Ed25519 key signs.
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    expect(new ApprovalsSigner(rsa).available).toBe(false);
  });
});

describe('who holds what (plan §F.2)', () => {
  it('the Teachers Manager checks and signs as a teacher; never the scholar step by bundle', () => {
    expect([...legacyLessonContentKeys(manager(), 'manager')].sort()).toEqual(['lesson_content.check', 'lesson_content.review_teacher', 'lesson_content.view']);
    expect([...legacyLessonContentKeys(admin(), 'member')]).toEqual(['lesson_content.view']);
    expect([...legacyLessonContentKeys(manager(), null)]).toEqual([]);
    expect([...legacyLessonContentKeys(admin('sa', 'super_admin'), null)]).toContain('lesson_content.review_scholar');
  });

  it('a step key implies seeing the content; nobody who is not live staff of the content organization sees anything', () => {
    const st = { contentOrganizationId: ORG, scholarGranted: true };
    expect(lessonContentAccess(admin(), new Set(['lesson_content.review_scholar']), st)).toEqual({ view: true, steps: ['scholar'] });
    // The scholar's key without the explicit role opens nothing at all.
    expect(lessonContentAccess(admin(), new Set(['lesson_content.review_scholar']), { ...st, scholarGranted: false })).toEqual({ view: false, steps: [] });
    expect(lessonContentAccess(admin(), new Set(['lesson_content.view']), st)).toEqual({ view: true, steps: [] });
    expect(lessonContentAccess(admin(), new Set(['lesson_content.view']), { ...st, contentOrganizationId: null })).toEqual({ view: false, steps: [] });
    expect(lessonContentAccess(admin(), new Set(['lesson_content.view']), { ...st, contentOrganizationId: 'another' })).toEqual({ view: false, steps: [] });
    expect(lessonContentAccess(parent(), new Set(['lesson_content.view']), st)).toEqual({ view: false, steps: [] });
    expect(lessonContentAccess(teacher(), new Set(['lesson_content.check']), st)).toEqual({ view: false, steps: [] });
  });
});

describe('database refusals become answers', () => {
  const known = (code: string, message: string) =>
    new Prisma.PrismaClientKnownRequestError(message, { code: 'P2010', clientVersion: 'test', meta: { code, message } });

  it('one person signing a second step is a 403; an out-of-order or final text a 409', () => {
    const one = refusal(known('42501', "ERROR: you already signed a step of this text: the next step is someone else's")) as CommError;
    expect([one.code, one.status]).toEqual(['COMM.LESSON_CONTENT_DENIED', 403]);
    const order = refusal(known('23514', 'ERROR: the scholar step comes after the teacher step')) as CommError;
    expect([order.code, order.status]).toEqual(['COMM.LESSON_CONTENT_STATE', 409]);
    const twice = refusal(known('23505', 'duplicate key value violates unique constraint "lesson_content_one_approval_per_step"')) as CommError;
    expect([twice.code, twice.status]).toEqual(['COMM.LESSON_CONTENT_STATE', 409]);
  });
});

describe('seed_access_role_templates after PD-48 (review of #258, P1.1)', () => {
  const MIG = join(__dirname, '../../../../../supabase/migrations');
  const fn = (file: string) => {
    const sql = readFileSync(join(MIG, file), 'utf8');
    const start = sql.indexOf('create or replace function chat.seed_access_role_templates(p_org uuid)');
    const end = sql.indexOf('\n$$;\n', start);
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, end);
  };
  const generated = /-- BEGIN GENERATED pd040 role templates[\s\S]*?-- END GENERATED pd040 role templates/;
  const pd048 = fn('20261029230000_chat_pd048_lesson_audio.sql');
  const pd049 = fn('20261029235000_chat_pd049_lesson_content_review.sql');

  it("is PD-48's function word for word, apart from the generated template list", () => {
    expect(pd049.replace(generated, '<templates>')).toBe(pd048.replace(generated, '<templates>'));
  });

  it('keeps the audit-once guard, so applying 235000 after 230000 reverts nothing', () => {
    expect(pd049).toContain("a.action = 'access_role.template_skipped' and a.entity_id = v_other");
  });

  it('seeds both new templates beside the designer', () => {
    const rows = generated.exec(pd049)![0];
    for (const key of ['designer', 'pronunciation_reviewer', 'scholar_reviewer']) expect(rows).toContain(`('${key}', `);
  });
});

describe('the migration and the code agree', () => {
  const sql = readFileSync(join(__dirname, '../../../../../supabase/migrations/20261029235000_chat_pd049_lesson_content_review.sql'), 'utf8');

  it('on the key each step needs', () => {
    expect(sql).toContain("when 'check' then 'lesson_content.check'");
    expect(sql).toContain("when 'teacher' then 'lesson_content.review_teacher'");
    expect(sql).toContain("when 'scholar' then 'lesson_content.review_scholar'");
  });

  it('on the reject categories', () => {
    expect(sql).toContain("'wrong_meaning', 'not_in_source', 'aqeedah', 'weak_report', 'too_hard_for_band', 'language', 'respect', 'other'");
  });
});
