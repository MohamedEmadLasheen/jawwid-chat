/**
 * PD-41 -- the Certificates page, against the real database and its triggers.
 *
 * One describe per owner safeguard (2026-10-28; design §14), each proving the
 * service's refusal AND, where it matters, the database's refusal of the same
 * write attempted directly:
 *
 *   1. only the requester sends, after approving the exact revision; the
 *      Designer designs, uploads and returns -- nothing else; four eyes
 *   2. every return says what to change; every act is in the history
 *   3. a teacher's Story is optional and never automatic
 *   4. a student's Story needs the family's recorded consent; issuing and
 *      publishing are separate; a withdrawal takes the Story down
 *   5. the learner's assigned Operations supervisor decides a teacher's suggestion
 *   6. the super admin keeps the types; disabling deletes nothing
 *   7. the audit trail; duplicates and double sends; the Designer's projection
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PermissionService } from '@platform/permissions/permission.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { CertificateService } from '../../src/certificates/certificate.service';
import { CertificateTypeService } from '../../src/certificates/certificate-type.service';
import { LocalFsBlobStore } from '../../src/communication/attachments/blob-store';
import { activateBackup, buildGraph, moveFamily, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const permissions = new PermissionService(g.prisma);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const svc = new CertificateService(g.prisma, g.conversations, supervision, cards, g.storage, audit, permissions, g.notifications, g.stories);
const types = new CertificateTypeService(g.prisma, g.conversations, permissions, audit);
const blobs = new LocalFsBlobStore();

const IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 0x20), IEND]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF\n')]);

interface Dto {
  id: string;
  projection: 'full' | 'design';
  state: string;
  actions: string[];
  currentFile: { id: string } | null;
  returnMessage: string | null;
  story: { id: string; withdrawnAt: string | null } | null;
  history?: Array<{ kind: string; seq: number; note: string | null }>;
  [k: string]: unknown;
}
const dto = (x: { certificate: unknown }) => x.certificate as Dto;

let s: Scenario;
let groupId: string;
let superId: string;
let designerId: string;
/** A Teachers-department member (Teacher Supervision) and its manager. */
let tsupId: string;
let tmgrId: string;
let juzTypeId: string;
let excellenceTypeId: string;
let teacherTypeId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected the database to refuse');
}

async function cardsIn(conversationId: string) {
  return g.prisma.message.findMany({ where: { conversationId, type: 'card' }, include: { card: true, attachments: true }, orderBy: { seq: 'asc' } });
}

async function studentRequest(over: Record<string, unknown> = {}) {
  return dto(
    await svc.create(s.ownerId, {
      category: 'student',
      typeId: juzTypeId,
      learnerId: s.learnerId,
      printedName: 'learner_l',
      juz: 30,
      publishStory: true,
      designerNote: 'gold border',
      internalNote: 'private family context',
      requestKey: randomUUID(),
      ...over,
    }),
  );
}

/** The Designer takes it and uploads one revision; returns the certificate. */
async function design(id: string, by = designerId, file: { mime: string; bytes: Buffer } = { mime: 'image/png', bytes: PNG }) {
  const row = await g.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id } });
  if (row.state === 'requested') await svc.start(by, id);
  const { upload } = await svc.authorizeUpload(by, id, { mimeType: file.mime, byteSize: file.bytes.length });
  await blobs.put(upload.objectKey, file.mime, file.bytes);
  return dto(await svc.confirmUpload(by, id, { objectKey: upload.objectKey, fileName: file.mime === 'application/pdf' ? 'c.pdf' : 'c.png' }));
}

async function approved(over: Record<string, unknown> = {}) {
  const c = await studentRequest(over);
  const up = await design(c.id);
  return dto(await svc.approve(s.ownerId, c.id, { fileId: up.currentFile!.id }));
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;

  superId = randomUUID();
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'super_s', 'super_admin', true)`, superId);
  });
  // The Designer: a specialist with only view + design (PD-40).
  designerId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'designer_d', 'specialist', true)`, designerId);
  const [{ id: roleId }] = await g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT chat.define_access_role('designer', 'Designer', 'المصمم', null, 'specialist', ${['certificates.view', 'certificates.design']}::text[], 'spec', ${superId}::uuid)::text AS id`;
  await g.prisma.$queryRaw`SELECT chat.grant_access_role(${designerId}::uuid, ${roleId}::uuid, 'spec', ${superId}::uuid)`;

  tsupId = randomUUID();
  tmgrId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'tmgr_b', 'manager', true)`,
    tsupId,
    tmgrId,
  );
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgrId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId,
    dept,
  );

  juzTypeId = (await types.create(superId, { category: 'student', key: 'juz_completed', labelEn: "Juz' completed", labelAr: 'إتمام جزء', needsJuz: true })).type.id;
  excellenceTypeId = (await types.create(superId, { category: 'student', key: 'excellence', labelEn: 'Excellence', labelAr: 'تميّز' })).type.id;
  teacherTypeId = (await types.create(superId, { category: 'teacher', key: 'teacher_of_month', labelEn: 'Teacher of the Month', labelAr: 'المعلم المثالي', needsPeriod: 'month' })).type.id;
});

// ---------------------------------------------------------------------------

describe('1. only the requester sends, after approving this revision', () => {
  it('the full road: request, design, approve, send -- one card with the file, in the student group', async () => {
    const c = await studentRequest();
    expect(c).toMatchObject({ state: 'requested', projection: 'full' });
    const up = await design(c.id);
    expect(up.state).toBe('uploaded');

    expect(await code(svc.send(s.ownerId, c.id, { conversationId: groupId }))).toBe(CommErrorCode.CERTIFICATE_NOT_APPROVED);
    expect(dto(await svc.approve(s.ownerId, c.id, { fileId: up.currentFile!.id })).state).toBe('approved');

    const target = await svc.deliveryTarget(s.ownerId, c.id);
    expect(target.target?.conversationId).toBe(groupId);
    const sent = dto(await svc.send(s.ownerId, c.id, { conversationId: groupId }));
    expect(sent.state).toBe('sent');

    const delivered = await cardsIn(groupId);
    expect(delivered.map((m) => m.card?.kind)).toEqual(['certificate_issued']);
    expect(delivered[0]!.authorType).toBe('system');
    expect(delivered[0]!.attachments).toHaveLength(1);
    // A copy in the group's namespace: never the pinned design key, never the upload key.
    expect(delivered[0]!.attachments[0]!.objectKey.startsWith(`conversations/${groupId}/`)).toBe(true);
    const parentView = await g.messages.list({ conversationId: groupId, actorId: s.parentId });
    expect(parentView.messages.find((m) => m.id === delivered[0]!.id)?.attachments[0]?.url).toBeTruthy();

    // A second press sends nothing more (design §8).
    expect((await svc.send(s.ownerId, c.id, { conversationId: groupId })).replayed).toBe(true);
    expect(await cardsIn(groupId)).toHaveLength(1);
  });

  it('the Designer designs, uploads and returns -- and cannot approve, send, cancel or publish', async () => {
    const c = await studentRequest();
    const up = await design(c.id);
    expect(await code(svc.approve(designerId, c.id, { fileId: up.currentFile!.id }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(svc.cancel(designerId, c.id, { reason: 'not needed any more' }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    await svc.approve(s.ownerId, c.id, { fileId: up.currentFile!.id });
    expect(await code(svc.send(designerId, c.id, { conversationId: groupId }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(svc.publishStory(designerId, c.id))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    // Refused before the body is read: a malformed body tells a Designer nothing either.
    expect(await code(svc.recordConsent(designerId, c.id, { kind: 'granted', contactId: s.parentId, method: 'written' }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(svc.recordConsent(designerId, c.id, { kind: 'nonsense' }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(svc.cancel(designerId, c.id, {}))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(svc.send(designerId, c.id, { conversationId: 'not-a-uuid' }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    // ...and an overseer oversees: the Operations manager cancels, never approves or sends someone else's.
    expect(await code(svc.send(s.managerId, c.id, { conversationId: groupId }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
  });

  it('four eyes: who uploaded a revision does not approve it', async () => {
    // Teacher Supervision both requests and (by the transition rule) designs.
    const c = dto(await svc.create(tsupId, { category: 'teacher', typeId: teacherTypeId, teacherId: s.teacherId, printedName: 'teacher_c', periodStart: '2026-10-01', periodEnd: '2026-10-31', requestKey: randomUUID() }));
    const up = await design(c.id, tsupId);
    expect(await code(svc.approve(tsupId, c.id, { fileId: up.currentFile!.id }))).toBe(CommErrorCode.CERTIFICATE_SELF_APPROVAL);
    // The database refuses the same approval written directly.
    const row = await g.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id: c.id } });
    expect(
      await sqlError(
        g.prisma.appreciationCertificate.update({
          where: { id: c.id },
          data: { state: 'approved', approvedFileId: row.currentFileId, approvedBy: tsupId, approvedAt: new Date(), actionSeq: row.actionSeq + 1, lastAction: 'approved', lastNote: null, lastActorStaff: tsupId, lastActorTeacher: null },
        }),
      ),
    ).toMatch(/uploaded a design does not approve it/);
  });

  it('an approval is of the revision reviewed: a stale one is refused, a new upload needs a redesign first', async () => {
    const c = await studentRequest();
    const first = await design(c.id);
    const second = await design(c.id);
    expect(second.currentFile!.id).not.toBe(first.currentFile!.id);
    expect(await code(svc.approve(s.ownerId, c.id, { fileId: first.currentFile!.id }))).toBe(CommErrorCode.CERTIFICATE_REVISION_CHANGED);
    await svc.approve(s.ownerId, c.id, { fileId: second.currentFile!.id });
    // Approved: the Designer may not slip in another file.
    expect(await code(svc.authorizeUpload(designerId, c.id, { mimeType: 'image/png', byteSize: PNG.length }))).toBe(CommErrorCode.CERTIFICATE_STATE);
    const back = dto(await svc.withdrawApproval(s.ownerId, c.id, { message: 'the name is misspelled on it' }));
    expect(back).toMatchObject({ state: 'in_design', returnMessage: 'the name is misspelled on it' });
  });

  it('an approved certificate can still be cancelled, keeping its approval on the record', async () => {
    const c = await approved();
    expect(await code(svc.cancel(s.ownerId, c.id, { reason: 'short' }))).toBe(CommErrorCode.VALIDATION);
    expect(dto(await svc.cancel(s.ownerId, c.id, { reason: 'the family asked us to wait' })).state).toBe('cancelled');
    const row = await g.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.approvedFileId).not.toBeNull();
    expect(await code(svc.send(s.ownerId, c.id, { conversationId: groupId }))).toBe(CommErrorCode.CERTIFICATE_STATE);
  });

  it('the database refuses a Designer as the sender of an approved certificate', async () => {
    const c = await approved();
    const row = await g.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id: c.id } });
    expect(
      await sqlError(
        g.prisma.appreciationCertificate.update({
          where: { id: c.id },
          data: { state: 'sent', sentAt: new Date(), sentBy: designerId, conversationId: groupId, sentMessageId: randomUUID(), actionSeq: row.actionSeq + 1, lastAction: 'sent', lastNote: null, lastActorStaff: designerId, lastActorTeacher: null },
        }),
      ),
    ).toMatch(/only the requester of record sends/);
  });

  it('responsibility follows the child: after a PD-24 transfer the new supervisor approves and sends, the old one cannot', async () => {
    const c = await studentRequest();
    const up = await design(c.id);
    await moveFamily(g.prisma, s, s.otherAdminId);
    expect(await code(svc.approve(s.ownerId, c.id, { fileId: up.currentFile!.id }))).toBe(CommErrorCode.CERTIFICATE_NOT_FOUND);
    await svc.approve(s.otherAdminId, c.id, { fileId: up.currentFile!.id });
    expect(dto(await svc.send(s.otherAdminId, c.id, { conversationId: groupId })).state).toBe('sent');
  });

  it('a file that is not whole, or a PDF that runs something, is refused', async () => {
    const c = await studentRequest();
    await svc.start(designerId, c.id);
    const truncated = PNG.subarray(0, PNG.length - 12);
    const one = await svc.authorizeUpload(designerId, c.id, { mimeType: 'image/png', byteSize: truncated.length });
    await blobs.put(one.upload.objectKey, 'image/png', truncated);
    expect(await code(svc.confirmUpload(designerId, c.id, { objectKey: one.upload.objectKey, fileName: 'c.png' }))).toBe(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED);
    const active = Buffer.concat([Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n'), Buffer.from('%%EOF\n')]);
    const two = await svc.authorizeUpload(designerId, c.id, { mimeType: 'application/pdf', byteSize: active.length });
    await blobs.put(two.upload.objectKey, 'application/pdf', active);
    expect(await code(svc.confirmUpload(designerId, c.id, { objectKey: two.upload.objectKey, fileName: 'c.pdf' }))).toBe(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED);
    expect((await g.prisma.appreciationCertificateFile.count({ where: { certificateId: c.id } }))).toBe(0);
  });

  it('the group changed since it was shown: nothing is sent', async () => {
    const c = await approved();
    const elsewhere = randomUUID();
    const refused = await svc.send(s.ownerId, c.id, { conversationId: elsewhere }).catch((e: CommError) => e);
    expect((refused as CommError).code).toBe(CommErrorCode.CERTIFICATE_TARGET_CHANGED);
    expect((refused as CommError).detail).toEqual({ conversationId: groupId });
    expect(await cardsIn(groupId)).toEqual([]);
  });

  it('the database refuses a send that skipped the approval, and a Designer as the approver', async () => {
    const c = await studentRequest();
    await design(c.id);
    const row = await g.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id: c.id } });
    const stamp = (actor: string) => ({ actionSeq: row.actionSeq + 1, lastAction: 'sent', lastNote: null, lastActorStaff: actor, lastActorTeacher: null });
    expect(
      await sqlError(g.prisma.appreciationCertificate.update({ where: { id: c.id }, data: { state: 'sent', sentAt: new Date(), sentBy: s.ownerId, conversationId: groupId, ...stamp(s.ownerId) } })),
    ).toMatch(/does not move from uploaded to sent/);
    expect(
      await sqlError(
        g.prisma.appreciationCertificate.update({
          where: { id: c.id },
          data: { state: 'approved', approvedFileId: row.currentFileId, approvedBy: designerId, approvedAt: new Date(), actionSeq: row.actionSeq + 1, lastAction: 'approved', lastNote: null, lastActorStaff: designerId, lastActorTeacher: null },
        }),
      ),
    ).toMatch(/only the requester of record/);
  });
});

// ---------------------------------------------------------------------------

describe('2. a return says what to change; the request keeps its history', () => {
  it('return -> edit -> resubmit, each act one history row with its note', async () => {
    const c = await studentRequest();
    await svc.start(designerId, c.id);
    expect(await code(svc.returnForChanges(designerId, c.id, { message: 'fix' }))).toBe(CommErrorCode.VALIDATION);
    const back = dto(await svc.returnForChanges(designerId, c.id, { message: 'which Juz exactly? 29 or 30?' }));
    expect(back).toMatchObject({ state: 'changes_requested', returnMessage: 'which Juz exactly? 29 or 30?' });
    await svc.edit(s.ownerId, c.id, { juz: 29 });
    const again = dto(await svc.resubmit(s.ownerId, c.id));
    expect(again.state).toBe('requested');

    const read = dto(await svc.get(s.ownerId, c.id));
    expect(read.history!.map((h) => [h.seq, h.kind])).toEqual([
      [1, 'requested'],
      [2, 'started'],
      [3, 'returned'],
      [4, 'edited'],
      [5, 'resubmitted'],
    ]);
    expect(read.history!.find((h) => h.kind === 'returned')!.note).toBe('which Juz exactly? 29 or 30?');
    const edit = await g.prisma.appreciationCertificateEvent.findFirstOrThrow({ where: { certificateId: c.id, kind: 'edited' } });
    expect(edit.before).toMatchObject({ juz: 30 });
    expect(edit.after).toMatchObject({ juz: 29 });
  });

  it('the history cannot be edited, deleted, skipped or written without its reason', async () => {
    const c = await studentRequest();
    const ev = await g.prisma.appreciationCertificateEvent.findFirstOrThrow({ where: { certificateId: c.id } });
    expect(await sqlError(g.prisma.appreciationCertificateEvent.update({ where: { id: ev.id }, data: { note: 'rewritten' } }))).toBeTruthy();
    expect(await sqlError(g.prisma.appreciationCertificateEvent.delete({ where: { id: ev.id } }))).toBeTruthy();
    // A write that is not exactly one act is refused.
    expect(await sqlError(g.prisma.appreciationCertificate.update({ where: { id: c.id }, data: { internalNote: 'quietly changed' } }))).toMatch(/one act/);
    // A return without its message is refused by the table itself.
    expect(
      await sqlError(
        g.prisma.$executeRawUnsafe(
          `insert into chat.appreciation_certificate_event (certificate_id, seq, kind, to_state, actor_staff_id) values ($1::uuid, 99, 'returned', 'changes_requested', $2::uuid)`,
          c.id,
          designerId,
        ),
      ),
    ).toMatch(/certificate_event_says_why/);
  });
});

// ---------------------------------------------------------------------------

describe('3. a teacher Story is optional and never automatic', () => {
  async function teacherCert(publishStory: boolean) {
    const c = dto(
      await svc.create(tsupId, { category: 'teacher', typeId: teacherTypeId, teacherId: s.teacherId, printedName: 'teacher_c', periodStart: '2026-10-01', publishStory, requestKey: randomUUID() }),
    );
    const up = await design(c.id);
    await svc.approve(tsupId, c.id, { fileId: up.currentFile!.id });
    return c;
  }

  it('sent into the teacher\'s supervision conversation with its file, and no Story until one is asked for', async () => {
    const c = await teacherCert(true);
    // Reading the target creates nothing: the teacher has no supervision conversation yet.
    const conversations = await g.prisma.conversation.count();
    const target = await svc.deliveryTarget(tsupId, c.id);
    expect(target.target).toMatchObject({ conversationId: null, type: 'teacher_supervision' });
    expect(await g.prisma.conversation.count()).toBe(conversations);
    const sent = dto(await svc.send(tsupId, c.id, { conversationId: null }));
    expect(sent).toMatchObject({ state: 'sent', story: null });
    expect(await g.prisma.story.count()).toBe(0);
    const row = await g.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id: c.id } });
    // The type as it read when sent.
    expect(row).toMatchObject({ typeLabelEn: 'Teacher of the Month', typeLabelAr: 'المعلم المثالي' });
    const awarded = await cardsIn(row.conversationId!);
    expect(awarded.map((m) => m.card?.kind)).toEqual(['certificate_awarded']);
    expect(awarded[0]!.attachments).toHaveLength(1);

    // Only the explicit act publishes, to all teachers, once.
    const published = dto(await svc.publishStory(tsupId, c.id));
    expect(published.story).not.toBeNull();
    const audience = await g.prisma.storyAudience.findMany({ where: { storyId: published.story!.id } });
    expect(audience.map((a) => a.kind)).toEqual(['all_teachers']);
    expect((await svc.publishStory(tsupId, c.id)).replayed).toBe(true);
    expect(await g.prisma.story.count()).toBe(1);
  });

  it('a request that did not opt in never becomes a Story', async () => {
    const c = await teacherCert(false);
    expect(await code(svc.publishStory(tsupId, c.id))).toBe(CommErrorCode.CERTIFICATE_STORY_NOT_OPTED_IN);
    expect(dto(await svc.get(tsupId, c.id)).actions).not.toContain('story');
  });
});

// ---------------------------------------------------------------------------

describe('4. a student Story needs the family\'s recorded consent', () => {
  it('no consent, no Story; documented consent, one Story; withdrawn consent takes it down', async () => {
    const c = await approved();
    expect(await code(svc.publishStory(s.ownerId, c.id))).toBe(CommErrorCode.CERTIFICATE_STORY_CONSENT_MISSING);
    // Unclear consent is not consent: by phone it must say when and how.
    expect(await code(svc.recordConsent(s.ownerId, c.id, { kind: 'granted', contactId: s.parentId, method: 'phone' }))).toBe(CommErrorCode.VALIDATION);
    await svc.recordConsent(s.ownerId, c.id, { kind: 'granted', contactId: s.parentId, method: 'phone', note: 'mother agreed by phone on 29 Oct' });
    // Issuing and publishing are separate: sending made no Story, and publishing sends nothing.
    await svc.send(s.ownerId, c.id, { conversationId: groupId });
    expect(await g.prisma.story.count()).toBe(0);
    const published = dto(await svc.publishStory(s.ownerId, c.id));
    expect(await cardsIn(groupId)).toHaveLength(1);
    const story = await g.prisma.story.findUniqueOrThrow({ where: { id: published.story!.id } });
    expect(story.state).toBe('published');
    expect(story.mediaObjectKey!.startsWith('stories/')).toBe(true);

    expect(await code(svc.recordConsent(s.ownerId, c.id, { kind: 'withdrawn', note: 'no' }))).toBe(CommErrorCode.VALIDATION);
    const after = dto(await svc.recordConsent(s.ownerId, c.id, { kind: 'withdrawn', note: 'the father asked us to remove it' }));
    expect(after.story!.withdrawnAt).not.toBeNull();
    expect((await g.prisma.story.findUniqueOrThrow({ where: { id: story.id } })).deletedAt).not.toBeNull();
    const kinds = (dto(await svc.get(s.ownerId, c.id)).history ?? []).map((h) => h.kind);
    expect(kinds.slice(-3)).toEqual(['story_published', 'consent_withdrawn', 'story_withdrawn']);
  });

  it('a PD-33 backup withdraws consent: the withdrawal and the Story\'s removal commit together', async () => {
    const c = await approved();
    await svc.recordConsent(s.ownerId, c.id, { kind: 'granted', contactId: s.parentId, method: 'phone', note: 'mother agreed by phone on 29 Oct' });
    const published = dto(await svc.publishStory(s.ownerId, c.id));
    await activateBackup(g.prisma, s.ownerId, s.otherAdminId);
    const after = dto(await svc.recordConsent(s.otherAdminId, c.id, { kind: 'withdrawn', note: 'the father asked us to remove it' }));
    expect(after.story!.withdrawnAt).not.toBeNull();
    const story = await g.prisma.story.findUniqueOrThrow({ where: { id: published.story!.id } });
    expect(story).toMatchObject({ state: 'deleted', deletedBy: s.otherAdminId });
    const consent = await g.prisma.certificateStoryConsent.findMany({ where: { certificateId: c.id }, orderBy: { actionSeq: 'asc' } });
    expect(consent.map((x) => [x.kind, x.recordedBy])).toEqual([
      ['granted', s.ownerId],
      ['withdrawn', s.otherAdminId],
    ]);
  });

  it('written consent says where the document is', async () => {
    const c = await approved();
    expect(await code(svc.recordConsent(s.ownerId, c.id, { kind: 'granted', contactId: s.parentId, method: 'written' }))).toBe(CommErrorCode.VALIDATION);
    await svc.recordConsent(s.ownerId, c.id, { kind: 'granted', contactId: s.parentId, method: 'written', note: 'signed form in the family file, 29 Oct' });
  });

  it('a PDF certificate is sent, but a Story needs an image', async () => {
    const c = await studentRequest();
    const up = await design(c.id, designerId, { mime: 'application/pdf', bytes: PDF });
    await svc.approve(s.ownerId, c.id, { fileId: up.currentFile!.id });
    await svc.recordConsent(s.ownerId, c.id, { kind: 'granted', contactId: s.parentId, method: 'written', note: 'signed form in the family file, 29 Oct' });
    expect(await code(svc.publishStory(s.ownerId, c.id))).toBe(CommErrorCode.CERTIFICATE_STORY_NEEDS_IMAGE);
  });

  it('the database refuses an undocumented consent and a Story without consent', async () => {
    const c = await approved();
    const row = await g.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id: c.id } });
    expect(
      await sqlError(
        g.prisma.$executeRawUnsafe(
          `insert into chat.certificate_story_consent (certificate_id, kind, recorded_by, action_seq) values ($1::uuid, 'granted', $2::uuid, $3)`,
          c.id,
          s.ownerId,
          row.actionSeq + 1,
        ),
      ),
    ).toMatch(/certificate_consent_grant_is_documented/);
    const story = await g.stories.create(s.ownerId, { body: 'not a certificate', audiences: [{ kind: 'all_families' }] });
    expect(
      await sqlError(
        g.prisma.appreciationCertificate.update({
          where: { id: c.id },
          data: { storyId: story.id, storyPublishedAt: new Date(), storyPublishedBy: s.ownerId, actionSeq: row.actionSeq + 1, lastAction: 'story_published', lastNote: null, lastActorStaff: s.ownerId, lastActorTeacher: null },
        }),
      ),
    ).toMatch(/recorded consent/);
  });
});

// ---------------------------------------------------------------------------

describe('5. the learner\'s assigned Operations supervisor decides a teacher\'s suggestion', () => {
  async function suggestion() {
    return svc.suggest(s.teacherId, { learnerId: s.learnerId, title: 'Juz Amma', achievement: 'Memorized Juz Amma', achievedOn: '2026-10-01', printedName: 'learner_l' });
  }

  it('another supervisor and the manager cannot; the assigned one accepts and the teacher is told', async () => {
    const { certificate, conversationId } = await suggestion();
    expect(await code(svc.accept(s.otherAdminId, certificate.id, { typeId: juzTypeId, juz: 30 }))).toBe(CommErrorCode.CERTIFICATE_NOT_FOUND);
    expect(await code(svc.accept(s.managerId, certificate.id, { typeId: juzTypeId, juz: 30 }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(svc.accept(s.ownerId, certificate.id, { juz: 30 }))).toBe(CommErrorCode.VALIDATION);

    const out = dto(await svc.accept(s.ownerId, certificate.id, { typeId: juzTypeId, juz: 30 }));
    expect(out.state).toBe('requested');
    const row = await g.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id: certificate.id } });
    expect(row).toMatchObject({ requestedByStaff: s.ownerId, decidedBy: s.ownerId });
    expect((await cardsIn(conversationId)).map((m) => m.card?.kind)).toEqual(['certificate_requested', 'certificate_accepted']);
    const told = await g.prisma.notification.findMany({ where: { recipientId: s.teacherId, templateKey: 'certificate_suggestion_decided' } });
    expect(told).toHaveLength(1);
  });

  it('an undecided suggestion can be cancelled by an overseer; a learner with no supervisor is decided by the Operations manager', async () => {
    const one = await suggestion();
    expect(await code(svc.cancel(s.ownerId, one.certificate.id, { reason: 'nobody should cancel this' }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(dto(await svc.cancel(tmgrId, one.certificate.id, { reason: 'the teacher left; no longer needed' })).state).toBe('cancelled');

    await g.prisma.$executeRawUnsafe(`delete from chat.learner_supervision where learner_id = $1::uuid`, s.learnerId);
    const two = await suggestion();
    expect(await code(svc.accept(s.ownerId, two.certificate.id, { typeId: juzTypeId, juz: 30 }))).toBe(CommErrorCode.CERTIFICATE_NOT_FOUND);
    expect(dto(await svc.accept(s.managerId, two.certificate.id, { typeId: juzTypeId, juz: 30 })).state).toBe('requested');
  });

  it('a decline needs its reason, answers the teacher, and reaches no family', async () => {
    const { certificate, conversationId } = await suggestion();
    expect(await code(svc.decline(s.ownerId, certificate.id, { reason: 'no' }))).toBe(CommErrorCode.VALIDATION);
    const out = dto(await svc.decline(s.ownerId, certificate.id, { reason: 'the level is not finished yet' }));
    expect(out.state).toBe('declined');
    expect((await cardsIn(conversationId)).map((m) => m.card?.kind)).toEqual(['certificate_requested', 'certificate_declined']);
    expect(await cardsIn(groupId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('Stories accepts only its own media (review of #216)', () => {
  it('a certificate\'s pinned file and another publisher\'s grant are refused; the sweeper never deletes outside stories/', async () => {
    const c = await studentRequest();
    const up = await design(c.id);
    const pinned = (await g.prisma.appreciationCertificateFile.findUniqueOrThrow({ where: { id: up.currentFile!.id } })).objectKey;
    expect(await code(g.stories.create(s.ownerId, { mediaObjectKey: pinned, mediaKind: 'image', mediaMime: 'image/png', audiences: [{ kind: 'all_families' }] }))).toBe(
      CommErrorCode.STORY_MEDIA_NOT_GRANTED,
    );
    const theirs = await g.stories.authorizeMediaUpload(s.managerId, { mimeType: 'image/png', byteSize: PNG.length });
    expect(await code(g.stories.create(s.ownerId, { mediaObjectKey: theirs.objectKey, mediaKind: 'image', mediaMime: 'image/png', audiences: [{ kind: 'all_families' }] }))).toBe(
      CommErrorCode.STORY_MEDIA_NOT_GRANTED,
    );
    // A legacy row naming a non-stories key: the sweep unlinks it and leaves the bytes.
    const legacy = await g.stories.create(s.ownerId, { body: 'legacy', audiences: [{ kind: 'all_families' }] });
    await g.prisma.$executeRawUnsafe(
      `update chat.story set body = null, media_object_key = $2, media_kind = 'image', media_mime = 'image/png',
              deleted_at = now() - interval '400 days', deleted_reason = 'legacy row (spec)', state = 'deleted' where id = $1::uuid`,
      legacy.id,
      pinned,
    );
    await g.storySweeper.purgeDueMedia(new Date());
    expect((await g.prisma.story.findUniqueOrThrow({ where: { id: legacy.id } })).mediaObjectKey).toBeNull();
    expect(await g.storage.readHead(pinned, 8)).not.toBeNull();
  });
});

describe('6. the super admin keeps the types; disabling deletes nothing', () => {
  it('only the super admin adds or disables a type; a disabled type takes no new request but keeps its certificates', async () => {
    expect(await code(types.create(s.managerId, { category: 'student', key: 'x_type', labelEn: 'x', labelAr: 'x' }))).toBe(CommErrorCode.CERTIFICATE_DENIED);
    expect(await code(types.update(tmgrId, excellenceTypeId, { isActive: false }))).toBe(CommErrorCode.CERTIFICATE_DENIED);

    const old = await studentRequest({ typeId: excellenceTypeId, juz: undefined });
    await types.update(superId, excellenceTypeId, { isActive: false });
    expect((await types.list(s.ownerId, { category: 'student' })).types.map((t) => t.key)).toEqual(['juz_completed']);
    // Listed by sort, then label: "Excellence" before "Juz' completed".
    expect((await types.list(superId, { category: 'student', includeDisabled: 'true' })).types.map((t) => [t.key, t.isActive])).toEqual([
      ['excellence', false],
      ['juz_completed', true],
    ]);
    expect(await code(studentRequest({ typeId: excellenceTypeId, juz: undefined }))).toBe(CommErrorCode.CERTIFICATE_TYPE_DISABLED);
    // The old certificate still reads with its type's label.
    expect(dto(await svc.get(s.ownerId, old.id)).type).toMatchObject({ key: 'excellence', isActive: false });
    expect(await sqlError(g.prisma.certificateType.delete({ where: { id: excellenceTypeId } }))).toMatch(/never deleted/);
    const audited = await g.prisma.auditLog.findMany({ where: { entity: 'certificate_type', entityId: excellenceTypeId }, orderBy: { id: 'asc' } });
    expect(audited.map((a) => a.action)).toEqual(['certificate_type.created', 'certificate_type.disabled']);
  });
});

// ---------------------------------------------------------------------------

describe('7. the trail, duplicates, and what the Designer sees', () => {
  it('every act is audited, and no trail row carries an object key', async () => {
    const c = await approved();
    await svc.send(s.ownerId, c.id, { conversationId: groupId });
    const acts = await g.prisma.auditLog.findMany({ where: { entity: 'appreciation_certificate', entityId: c.id }, orderBy: { id: 'asc' } });
    expect(acts.map((a) => a.action)).toEqual([
      'appreciation_certificate.requested',
      'appreciation_certificate.started',
      'appreciation_certificate.file_uploaded',
      'appreciation_certificate.approved',
      'appreciation_certificate.sent',
    ]);
    const events = await g.prisma.appreciationCertificateEvent.findMany({ where: { certificateId: c.id }, orderBy: { seq: 'asc' } });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    // audit_log ids are BigInt.
    const trail = JSON.stringify([acts, events], (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    expect(trail).not.toMatch(/certificates\/|certificate-uploads\/|conversations\//);
  });

  it('a double submit returns the first request; the same Juz twice is refused; a near-duplicate needs confirming', async () => {
    const requestKey = randomUUID();
    const first = await svc.create(s.ownerId, { category: 'student', typeId: juzTypeId, learnerId: s.learnerId, printedName: 'learner_l', juz: 30, requestKey });
    const again = await svc.create(s.ownerId, { category: 'student', typeId: juzTypeId, learnerId: s.learnerId, printedName: 'learner_l', juz: 30, requestKey });
    expect(again.replayed).toBe(true);
    expect(dto(again).id).toBe(dto(first).id);
    expect(await code(studentRequest({ juz: 30 }))).toBe(CommErrorCode.CERTIFICATE_DUPLICATE);
    await studentRequest({ juz: 29 });

    await studentRequest({ typeId: excellenceTypeId, juz: undefined });
    expect(await code(studentRequest({ typeId: excellenceTypeId, juz: undefined }))).toBe(CommErrorCode.CERTIFICATE_DUPLICATE_SUSPECTED);
    await studentRequest({ typeId: excellenceTypeId, juz: undefined, confirmDuplicate: true });
  });

  it('the Designer reads the design projection only, and never a suggestion', async () => {
    const c = await studentRequest();
    await svc.suggest(s.teacherId, { learnerId: s.learnerId, title: 'Juz Amma', achievement: 'Memorized', achievedOn: '2026-10-01', printedName: 'learner_l' });
    const list = await svc.list(designerId, {});
    expect(list.certificates.map((x) => [x.id, x.projection])).toEqual([[c.id, 'design']]);
    const json = JSON.stringify(list);
    for (const secret of [s.learnerId, s.teacherId, 'private family context', groupId]) expect(json).not.toContain(secret);
    expect(list.certificates[0]).toMatchObject({ designerNote: 'gold border', signatoryName: 'teacher_c', juz: 30, actions: ['start', 'return'] });
    // Operations, outside this learner's supervision, sees nothing.
    expect((await svc.list(s.otherAdminId, {})).certificates).toEqual([]);
  });

  it('the Designer is told of a new request; the requester of an upload', async () => {
    const c = await studentRequest();
    expect(await g.prisma.notification.count({ where: { recipientId: designerId, templateKey: 'certificate_requested' } })).toBe(1);
    await design(c.id);
    expect(await g.prisma.notification.count({ where: { recipientId: s.ownerId, templateKey: 'certificate_uploaded' } })).toBe(1);
  });
});
