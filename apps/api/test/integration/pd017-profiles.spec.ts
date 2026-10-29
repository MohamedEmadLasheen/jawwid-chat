/**
 * PD-17 -- the Parent Profile, the Student Profile, and a family's money
 * recorded in Chat, end to end on the PD-8 synthetic organization.
 *
 *   1. who opens a Parent Profile: Operations supervisors (their families),
 *      the Operations Manager and the super admin -- never a teacher, a parent,
 *      the Teachers or Sales department, and a teacher never reaches the money
 *   2. editing it: the name everywhere, the admin-only file, the family's
 *      country; the audit names fields, never a phone or an e-mail
 *   3. the money: method, currency and plan; an instalment plan; a payment,
 *      once; a void, final; the database refuses edits and deletes
 *   4. who opens a Student Profile: the administration and the child's own
 *      teacher -- another teacher or a parent never, and a teacher sees no
 *      date of birth and no parents
 *   5. photos on a profile: re-decided per request by each profile's own rule;
 *      an administrator may change a parent's photo, a teacher may not
 *   6. Sales (owner, 2026-10-21): reads every parent and records payments, but
 *      does not edit the contact record
 *   7. a parent's own payments: every active parent of the family (both
 *      parents), without voided rows or who recorded what
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { hashPassword } from '@platform/auth/password';
import { CommError, CommErrorCode } from '@platform/errors';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { AvatarService } from '@communication/profile/avatar.service';
import { BillingService } from '../../src/billing/billing.service';
import { ParentRecordService } from '../../src/parent-profile/parent-record.service';
import { contactKeyHash } from '../../src/new-students/contact-key';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { EnrollmentService } from '../../src/lessons/enrollment.service';
import { todayIn } from '../../src/leave/leave.service';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd17-spec-password-1';
const DOMAIN = 'pd17.qa.jawwid.test';

const g = buildGraph();
const audit = new PrismaAuditService();
const avatars = new AvatarService(g.prisma, g.conversations, new SignedLocalObjectStorage(), audit);
const billing = new BillingService(g.prisma, g.conversations, audit);
const parents = new ParentRecordService(g.prisma, g.conversations, avatars, audit);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const enrollment = new EnrollmentService(g.prisma, g.authz, g.conversations, lessons, scheduling, audit, avatars);
parents.onModuleInit();
enrollment.onModuleInit();

let m: SeedManifest;
let orgId: string;
let today: string;

type Family = SeedManifest['families'][number];

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

function reachableFamilies(staffId: string): Set<string> {
  const principals = new Set([staffId]);
  for (const l of m.backupLinks) if (l.active && l.backupId === staffId) principals.add(l.primaryId);
  return new Set(m.families.filter((f) => f.children.some((c) => principals.has(c.supervisorId))).map((f) => f.id));
}

/** A family and an Operations supervisor who does NOT reach it. */
function familyAndOutsider(): { f: Family; outsider: string } {
  for (const f of m.families) {
    const outsider = m.supervisors.find((s) => !reachableFamilies(s.id).has(f.id));
    if (outsider) return { f, outsider: outsider.id };
  }
  throw new Error('the seed has no family outside some supervisor\'s reach');
}

/** Everyone who is not the administration of a family's money (PD-17: Sales is). */
function notAdministration(f: Family): string[] {
  return [
    m.teachersManager.id,
    ...m.teacherSupervisors.map((s) => s.id),
    ...m.teachers.map((t) => t.id),
    f.parent.id,
  ];
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd17-${orgId.slice(0, 8)}', 'PD-17 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
  });
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId,
    emailDomain: DOMAIN,
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
    messages: false,
  });
  today = todayIn('Africa/Cairo');
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await g.prisma.$executeRawUnsafe(`truncate chat.payment_refund, chat.invoice, chat.payment_receipt, chat.payment, chat.payment_checkout, chat.payment_request, chat.family_instalment, chat.family_billing, chat.parent_file`);
});

describe('1. who opens a Parent Profile', () => {
  it('the Operations Manager and the super admin open every parent; the list is the whole organization', async () => {
    for (const who of [m.operationsManager.id, m.superAdmin.id]) {
      const list = await parents.list(who);
      expect(new Set(list.items.map((p) => p.id))).toEqual(new Set(m.families.map((f) => f.parent.id)));
      for (const f of m.families) {
        const p = await parents.detail(who, f.parent.id);
        expect(p).toMatchObject({ id: f.parent.id, name: f.parent.name, family: { id: f.id }, childrenCount: f.children.length });
      }
    }
  });

  it('an Operations supervisor opens the parents of families they reach, and no other (the same 404 as no parent)', async () => {
    const { f, outsider } = familyAndOutsider();
    expect((await parents.list(outsider)).items.map((p) => p.family.id).sort()).toEqual([...reachableFamilies(outsider)].sort());
    expect(await code(parents.detail(outsider, f.parent.id))).toBe(CommErrorCode.PARENT_PROFILE_NOT_FOUND);
    expect(await code(parents.detail(outsider, randomUUID()))).toBe(CommErrorCode.PARENT_PROFILE_NOT_FOUND);
    const own = f.children[0]!.supervisorId;
    expect((await parents.detail(own, f.parent.id)).id).toBe(f.parent.id);
  });

  it('a teacher, a parent, the Teachers and Sales departments: refused before any parent is looked up', async () => {
    const f = m.families[0]!;
    for (const who of notAdministration(f)) {
      expect(await code(parents.list(who))).toBe(CommErrorCode.PARENT_PROFILE_DENIED);
      // A real parent and an id that does not exist answer the same.
      expect(await code(parents.detail(who, f.parent.id))).toBe(CommErrorCode.PARENT_PROFILE_DENIED);
      expect(await code(parents.detail(who, randomUUID()))).toBe(CommErrorCode.PARENT_PROFILE_DENIED);
      expect(await code(parents.update(who, f.parent.id, { phone: '+971 50 000 0000' }))).toBe(CommErrorCode.PARENT_PROFILE_DENIED);
      expect(await code(parents.authorizePhotoUpload(who, f.parent.id, { mimeType: 'image/png', byteSize: 10 }))).toBe(
        CommErrorCode.PARENT_PROFILE_DENIED,
      );
    }
  });

  it('a teacher never reaches a family\'s money, by any route', async () => {
    const f = m.families[0]!;
    const inst = await billing.createInstalments(m.superAdmin.id, f.id, { label: 'Fees', amountMinor: 50000, currency: 'AED', firstDueDate: today });
    const id = inst.instalments[0]!.id;
    for (const who of notAdministration(f)) {
      expect(await code(billing.familyBilling(who, f.id))).toBe(CommErrorCode.BILLING_DENIED);
      expect(await code(billing.setFamilyBilling(who, f.id, { paymentMethod: 'invoice' }))).toBe(CommErrorCode.BILLING_DENIED);
      expect(await code(billing.createInstalments(who, f.id, { label: 'x', amountMinor: 1, currency: 'AED', firstDueDate: today }))).toBe(
        CommErrorCode.BILLING_DENIED,
      );
      expect(await code(billing.recordPayment(who, id, { paidOn: today, method: 'invoice' }))).toBe(CommErrorCode.BILLING_DENIED);
      expect(await code(billing.voidInstalment(who, id, { reason: 'no' }))).toBe(CommErrorCode.BILLING_DENIED);
      expect(await code(billing.list(who, {}))).toBe(CommErrorCode.BILLING_DENIED);
    }
  });
});

describe('2. editing a Parent Profile', () => {
  it('saves the name (everywhere), the admin-only file and the family\'s country; the audit names fields only', async () => {
    const f = m.families[0]!;
    const phone = '+971 50 123 4567';
    const email = 'Parent.Pd17@Example.test';
    const out = await parents.update(m.operationsManager.id, f.parent.id, {
      name: 'Hana Example',
      phone,
      email,
      countryCode: 'ae',
      region: 'Dubai',
      adminNote: 'Prefers calls after 6 pm.',
    });
    expect(out).toMatchObject({
      name: 'Hana Example',
      contact: { phone, email: email.toLowerCase(), countryCode: 'AE', region: 'Dubai' },
      adminNote: 'Prefers calls after 6 pm.',
    });
    expect((await g.prisma.contact.findUniqueOrThrow({ where: { id: f.parent.id } })).name).toBe('Hana Example');
    expect((await g.prisma.family.findUniqueOrThrow({ where: { id: f.id } })).countryCode).toBe('AE');

    const rows = await g.prisma.auditLog.findMany({ where: { entityId: f.parent.id, action: 'parent_profile.updated' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toMatchObject({ fields: expect.arrayContaining(['name', 'phone', 'email', 'region', 'adminNote', 'countryCode']) });
    const leaked = await g.prisma.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from chat.audit_log
       where before::text like ${'%123 4567%'} or after::text like ${'%123 4567%'}
          or before::text like ${'%pd17@example%'} or after::text like ${'%pd17@example%'}`;
    expect(Number(leaked[0]!.n)).toBe(0);

    // null clears; an absent field is left alone; the name cannot be cleared.
    const cleared = await parents.update(m.operationsManager.id, f.parent.id, { phone: null, adminNote: '' });
    expect(cleared.contact).toMatchObject({ phone: null, email: email.toLowerCase(), region: 'Dubai' });
    expect(cleared.adminNote).toBeNull();
    expect(await code(parents.update(m.operationsManager.id, f.parent.id, { name: '  ' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(parents.update(m.operationsManager.id, f.parent.id, { phone: 'call me' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(parents.update(m.operationsManager.id, f.parent.id, { email: 'nope' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(parents.update(m.operationsManager.id, f.parent.id, { countryCode: 'UAE' }))).toBe(CommErrorCode.VALIDATION);
    // PD-45: two letters are not enough -- a code that is not a country of the
    // list is a 400, never chat.family_country_listed's 500.
    for (const countryCode of ['UK', 'ZZ', 'AC', 'DG', 'EA', 'IC']) {
      expect(await code(parents.update(m.operationsManager.id, f.parent.id, { countryCode }))).toBe(CommErrorCode.VALIDATION);
    }
  });

  it('a supervisor edits only the parents they reach', async () => {
    const { f, outsider } = familyAndOutsider();
    expect(await code(parents.update(outsider, f.parent.id, { region: 'Cairo' }))).toBe(CommErrorCode.PARENT_PROFILE_NOT_FOUND);
    expect(await g.prisma.parentFile.findUnique({ where: { contactId: f.parent.id } })).toBeNull();
  });
});

describe('3. the money', () => {
  it('sets how the family pays and its plan (the one plan column Stories reads)', async () => {
    const f = m.families[0]!;
    const out = await billing.setFamilyBilling(m.operationsManager.id, f.id, { paymentMethod: 'bank_transfer', currency: 'aed', planMonths: 3 });
    expect(out).toMatchObject({ paymentMethod: 'bank_transfer', currency: 'AED', planMonths: 3, instalments: [] });
    expect((await g.prisma.family.findUniqueOrThrow({ where: { id: f.id } })).subscriptionPlanMonths).toBe(3);
    expect(await code(billing.setFamilyBilling(m.operationsManager.id, f.id, { paymentMethod: 'cash' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(billing.setFamilyBilling(m.operationsManager.id, f.id, { planMonths: 2 }))).toBe(CommErrorCode.VALIDATION);
  });

  it('creates a plan, records a payment once, voids for good, and keeps the timeline in date order', async () => {
    const f = m.families.find((x) => x.children.length >= 1)!;
    await billing.setFamilyBilling(m.superAdmin.id, f.id, { paymentMethod: 'invoice', currency: 'AED' });
    const plan = await billing.createInstalments(m.superAdmin.id, f.id, {
      label: 'Term fees',
      amountMinor: 75000,
      firstDueDate: '2026-01-31',
      count: 3,
      everyMonths: 1,
      learnerId: f.children[0]!.id,
    });
    expect(plan.instalments.map((i) => [i.label, i.dueDate, i.currency, i.amountMinor, i.child?.id])).toEqual([
      ['Term fees · 1/3', '2026-01-31', 'AED', 75000, f.children[0]!.id],
      ['Term fees · 2/3', '2026-02-28', 'AED', 75000, f.children[0]!.id],
      ['Term fees · 3/3', '2026-03-31', 'AED', 75000, f.children[0]!.id],
    ]);
    expect(new Set(plan.instalments.map((i) => i.planId)).size).toBe(1);
    expect(plan.instalments.every((i) => i.status === 'overdue' || i.status === 'due' || i.status === 'upcoming')).toBe(true);

    const [first, second] = plan.instalments as [(typeof plan.instalments)[0], (typeof plan.instalments)[0]];
    const paid = await billing.recordPayment(m.superAdmin.id, first.id, { paidOn: today, reference: 'INV-0042' });
    expect(paid.instalments.find((i) => i.id === first.id)).toMatchObject({
      status: 'paid',
      payment: { paidOn: today, method: 'invoice', reference: 'INV-0042', recordedBy: { id: m.superAdmin.id } },
    });
    expect(await code(billing.recordPayment(m.superAdmin.id, first.id, { paidOn: today }))).toBe(CommErrorCode.BILLING_STATE);
    expect(await code(billing.recordPayment(m.superAdmin.id, second.id, { paidOn: '2999-01-01' }))).toBe(CommErrorCode.VALIDATION);

    const voided = await billing.voidInstalment(m.superAdmin.id, second.id, { reason: 'the family moved to a 1-month plan' });
    expect(voided.instalments.find((i) => i.id === second.id)).toMatchObject({ status: 'voided', void: { reason: 'the family moved to a 1-month plan' } });
    expect(await code(billing.recordPayment(m.superAdmin.id, second.id, { paidOn: today }))).toBe(CommErrorCode.BILLING_STATE);
    expect(await code(billing.voidInstalment(m.superAdmin.id, second.id, { reason: 'again' }))).toBe(CommErrorCode.BILLING_STATE);

    expect(voided.totals).toEqual([{ currency: 'AED', paidMinor: 75000, outstandingMinor: 75000, overdueMinor: expect.any(Number) }]);
    const audited = await g.prisma.auditLog.findMany({ where: { entityId: f.id, action: { startsWith: 'instalment.' } }, orderBy: { at: 'asc' } });
    // The family's last three money events (an earlier test wrote one before).
    expect(audited.map((a) => a.action).slice(-3)).toEqual(['instalment.created', 'instalment.paid', 'instalment.voided']);
  });

  it('refuses a child of another family, a missing currency, and nonsense amounts', async () => {
    const [a, b] = m.families as [Family, Family];
    const base = { label: 'Fees', amountMinor: 1000, currency: 'AED', firstDueDate: today };
    expect(await code(billing.createInstalments(m.superAdmin.id, a.id, { ...base, learnerId: b.children[0]!.id }))).toBe(CommErrorCode.BILLING_NOT_FOUND);
    expect(await code(billing.createInstalments(m.superAdmin.id, a.id, { ...base, currency: undefined }))).toBe(CommErrorCode.VALIDATION);
    for (const amountMinor of [0, -5, 1.5, '100']) {
      expect(await code(billing.createInstalments(m.superAdmin.id, a.id, { ...base, amountMinor }))).toBe(CommErrorCode.VALIDATION);
    }
    expect(await code(billing.createInstalments(m.superAdmin.id, a.id, { ...base, count: 25 }))).toBe(CommErrorCode.VALIDATION);
  });

  it('the database keeps money append-only, whoever writes', async () => {
    const f = m.families[0]!;
    const out = await billing.createInstalments(m.superAdmin.id, f.id, { label: 'Fees', amountMinor: 1000, currency: 'AED', firstDueDate: today });
    const id = out.instalments[0]!.id;
    await expect(g.prisma.$executeRaw`update chat.family_instalment set amount_minor = 1 where id = ${id}::uuid`).rejects.toThrow(/terms never change/);
    await expect(g.prisma.$executeRaw`delete from chat.family_instalment where id = ${id}::uuid`).rejects.toThrow(/never deleted/);
    await billing.recordPayment(m.superAdmin.id, id, { paidOn: today, method: 'bank_transfer' });
    await expect(g.prisma.$executeRaw`update chat.family_instalment set paid_on = null, paid_method = null, paid_recorded_by = null, paid_recorded_at = null where id = ${id}::uuid`).rejects.toThrow(
      /never changes/,
    );
    await billing.voidInstalment(m.superAdmin.id, id, { reason: 'recorded on the wrong family' });
    await expect(g.prisma.$executeRaw`update chat.family_instalment set voided_at = null, voided_by = null, void_reason = null where id = ${id}::uuid`).rejects.toThrow(
      /final/,
    );
  });

  it('a supervisor records money only for families they reach', async () => {
    const { f, outsider } = familyAndOutsider();
    const base = { label: 'Fees', amountMinor: 1000, currency: 'AED', firstDueDate: today };
    expect(await code(billing.createInstalments(outsider, f.id, base))).toBe(CommErrorCode.BILLING_NOT_FOUND);
    expect(await code(billing.familyBilling(outsider, f.id))).toBe(CommErrorCode.BILLING_NOT_FOUND);
    const own = f.children[0]!.supervisorId;
    expect((await billing.createInstalments(own, f.id, base)).instalments).toHaveLength(1);
  });
});

describe('4. who opens a Student Profile', () => {
  it('the child\'s own teacher: photo, name, age, weekly times, teacher, course -- no date of birth, no parents', async () => {
    const f = m.families[0]!;
    const child = f.children[0]!;
    const p = await enrollment.profile(child.teacherId, child.id);
    expect(p).toMatchObject({ id: child.id, name: child.name, teacher: { id: child.teacherId }, viewer: 'teacher' });
    expect(p).toHaveProperty('schedule');
    expect(p).toHaveProperty('course');
    expect(p).toHaveProperty('age');
    expect(p).not.toHaveProperty('birthDate');
    expect(p).not.toHaveProperty('family');
    expect(JSON.stringify(p)).not.toContain(f.parent.id);
  });

  it('the administration: the Teachers department, the super admin, the child\'s supervisor -- with the parents to open', async () => {
    const f = m.families[0]!;
    const child = f.children[0]!;
    for (const who of [m.superAdmin.id, m.teachersManager.id, child.supervisorId]) {
      const p = await enrollment.profile(who, child.id);
      expect(p).toMatchObject({ viewer: 'staff', family: { id: f.id, parents: expect.arrayContaining([{ id: f.parent.id, name: expect.any(String) }]) } });
      expect(p).toHaveProperty('birthDate');
    }
  });

  it('another teacher, a parent, Sales and an unrelated supervisor: never', async () => {
    const f = m.families[0]!;
    const child = f.children[0]!;
    const otherTeacher = m.teachers.find((t) => t.id !== child.teacherId)!;
    expect(await code(enrollment.profile(otherTeacher.id, child.id))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(enrollment.profile(otherTeacher.id, randomUUID()))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(enrollment.profile(m.salesManager.id, child.id))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    const stranger = m.supervisors.find((s) => !reachableFamilies(s.id).has(f.id));
    if (stranger) expect(await code(enrollment.profile(stranger.id, child.id))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    // A parent's standing to their own child is 'family', and the Student Profile is not theirs.
    const refused = await code(enrollment.profile(f.parent.id, child.id));
    expect([CommErrorCode.LESSON_DENIED, CommErrorCode.LESSON_NOT_FOUND]).toContain(refused);
  });
});

describe('5. photos on a profile', () => {
  const key = (kind: 'contact' | 'learner', id: string) => `avatars/${kind}/${id}/${randomUUID()}`;

  it('a parent\'s photo: the administration that may open the profile, never a teacher', async () => {
    const { f, outsider } = familyAndOutsider();
    await g.prisma.contact.update({ where: { id: f.parent.id }, data: { avatarObjectKey: key('contact', f.parent.id) } });
    const id = `contact.${f.parent.id}.profile`;
    await expect(avatars.authorizeAvatarRead(m.operationsManager.id, id)).resolves.toHaveProperty('objectKey');
    await expect(avatars.authorizeAvatarRead(f.children[0]!.supervisorId, id)).resolves.toHaveProperty('objectKey');
    for (const who of [outsider, f.children[0]!.teacherId, m.teachersManager.id]) {
      await expect(avatars.authorizeAvatarRead(who, id)).rejects.toMatchObject({ code: CommErrorCode.PROFILE_PHOTO_NOT_FOUND });
    }
    expect((await parents.detail(m.operationsManager.id, f.parent.id)).avatarUrl).toMatch(/\/media\/avatars\/contact\./);
  });

  it('a child\'s photo: whoever may open the Student Profile', async () => {
    const child = m.families[0]!.children[0]!;
    await g.prisma.learner.update({ where: { id: child.id }, data: { avatarObjectKey: key('learner', child.id) } });
    const id = `learner.${child.id}.profile`;
    await expect(avatars.authorizeAvatarRead(child.teacherId, id)).resolves.toHaveProperty('objectKey');
    const otherTeacher = m.teachers.find((t) => t.id !== child.teacherId)!;
    await expect(avatars.authorizeAvatarRead(otherTeacher.id, id)).rejects.toMatchObject({ code: CommErrorCode.PROFILE_PHOTO_NOT_FOUND });
  });

  it('the administration may start a parent\'s photo change and remove it; the audit says who', async () => {
    const f = m.families[1]!;
    const grant = await parents.authorizePhotoUpload(m.operationsManager.id, f.parent.id, { mimeType: 'image/webp', byteSize: 2048 });
    expect(grant.objectKey.startsWith(`avatars/contact/${f.parent.id}/`)).toBe(true);
    await g.prisma.contact.update({ where: { id: f.parent.id }, data: { avatarObjectKey: key('contact', f.parent.id) } });
    await parents.removePhoto(m.operationsManager.id, f.parent.id);
    expect((await g.prisma.contact.findUniqueOrThrow({ where: { id: f.parent.id } })).avatarObjectKey).toBeNull();
    const row = await g.prisma.auditLog.findFirst({ where: { entityId: f.parent.id, action: 'profile_photo.removed' } });
    expect(row).toMatchObject({ actorId: m.operationsManager.id, reason: 'removed by an administrator' });
  });
});

describe('6. Sales records payments, and does not edit the contact record', () => {
  it('reads every parent, read-only, and records and voids money', async () => {
    const f = m.families[0]!;
    expect((await parents.list(m.salesManager.id)).items).toHaveLength(m.families.length);
    const p = await parents.detail(m.salesManager.id, f.parent.id);
    expect(p.access.canEdit).toBe(false);
    expect((await parents.detail(m.operationsManager.id, f.parent.id)).access.canEdit).toBe(true);
    expect(await code(parents.update(m.salesManager.id, f.parent.id, { region: 'Dubai' }))).toBe(CommErrorCode.PARENT_PROFILE_DENIED);
    expect(await code(parents.authorizePhotoUpload(m.salesManager.id, f.parent.id, { mimeType: 'image/png', byteSize: 10 }))).toBe(
      CommErrorCode.PARENT_PROFILE_DENIED,
    );
    expect(await code(parents.removePhoto(m.salesManager.id, f.parent.id))).toBe(CommErrorCode.PARENT_PROFILE_DENIED);

    const created = await billing.createInstalments(m.salesManager.id, f.id, { label: 'Sales fees', amountMinor: 9000, currency: 'AED', firstDueDate: today });
    expect(created.canRecord).toBe(true);
    const id = created.instalments.find((i) => i.label === 'Sales fees')!.id;
    const paid = await billing.recordPayment(m.salesManager.id, id, { paidOn: today, method: 'bank_transfer' });
    expect(paid.instalments.find((i) => i.id === id)).toMatchObject({ status: 'paid', payment: { recordedBy: { id: m.salesManager.id } } });
    expect((await billing.setFamilyBilling(m.salesManager.id, f.id, { planMonths: 6 })).planMonths).toBe(6);
  });
});

describe('7. a parent\'s own payments', () => {
  it('the billing parent reads their own family\'s instalments, never a voided row or who recorded it', async () => {
    const f = m.families[0]!;
    await billing.setFamilyBilling(m.superAdmin.id, f.id, { paymentMethod: 'invoice', currency: 'AED', planMonths: 3 });
    const plan = await billing.createInstalments(m.superAdmin.id, f.id, { label: 'Fees', amountMinor: 50000, firstDueDate: '2026-01-15', count: 2 });
    const [first, second] = plan.instalments as [(typeof plan.instalments)[0], (typeof plan.instalments)[0]];
    await billing.recordPayment(m.superAdmin.id, first.id, { paidOn: '2026-01-16', reference: 'INV-1' });
    await billing.voidInstalment(m.superAdmin.id, second.id, { reason: 'internal reason 4417' });
    await billing.createInstalments(m.superAdmin.id, m.families[1]!.id, { label: 'Another family', amountMinor: 1, currency: 'AED', firstDueDate: today });

    const mine = await billing.mine(f.parent.id);
    expect(mine).toMatchObject({ paymentMethod: 'invoice', currency: 'AED', planMonths: 3 });
    expect(mine.instalments.map((i) => [i.label, i.status])).toEqual([['Fees · 1/2', 'paid']]);
    expect(mine.instalments[0]!.payment).toEqual({ paidOn: '2026-01-16', method: 'invoice', reference: 'INV-1' });
    expect(mine.totals).toEqual([{ currency: 'AED', paidMinor: 50000, outstandingMinor: 0, overdueMinor: 0 }]);
    const wire = JSON.stringify(mine);
    for (const leak of ['internal reason 4417', 'Another family', m.superAdmin.id, 'recordedBy', 'createdBy', 'void']) {
      expect({ leak, found: wire.includes(leak) }).toEqual({ leak, found: false });
    }
  });

  it('both parents read it -- the billing permission is not needed (owner, 2026-10-21)', async () => {
    const f = m.families[0]!;
    await billing.createInstalments(m.superAdmin.id, f.id, { label: 'Fees', amountMinor: 50000, currency: 'AED', firstDueDate: today });
    await g.prisma.contact.update({ where: { id: f.parent.id }, data: { canManageBilling: false } });
    try {
      expect((await billing.mine(f.parent.id)).instalments.length).toBeGreaterThan(0);
    } finally {
      await g.prisma.contact.update({ where: { id: f.parent.id }, data: { canManageBilling: true } });
    }
    const second = await g.prisma.contact.create({
      data: {
        organizationId: orgId,
        familyId: f.id,
        name: 'Second Parent',
        relationship: 'parent',
        rolePreset: 'authorized_contact',
        canMessage: true,
        canViewProgress: true,
        canManageSchedule: false,
        canManageBilling: false,
        canManageContacts: false,
        canCancel: false,
        isActive: true,
      },
    });
    try {
      const both = [await billing.mine(f.parent.id), await billing.mine(second.id)];
      expect(both[1]).toEqual(both[0]);
      // Another family's parent never reads this family's.
      const other = await billing.mine(m.families[1]!.parent.id);
      expect(other.instalments.map((i) => i.id)).not.toEqual(expect.arrayContaining(both[0].instalments.map((i) => i.id)));
      await g.prisma.contact.update({ where: { id: second.id }, data: { isActive: false } });
      expect(await code(billing.mine(second.id))).toBe(CommErrorCode.BILLING_DENIED);
    } finally {
      await g.prisma.contact.update({ where: { id: second.id }, data: { isActive: false } });
    }
  });

  it('a teacher and staff are refused', async () => {
    const f = m.families[0]!;
    for (const who of [f.children[0]!.teacherId, m.superAdmin.id, m.operationsManager.id]) {
      expect(await code(billing.mine(who))).toBe(CommErrorCode.BILLING_DENIED);
    }
  });
});

describe('PD-45: a family\'s location on the Parent Profile', () => {
  const famA = () => m.families[m.families.length - 1]!;
  const famB = () => m.families[m.families.length - 2]!;
  const family = (id: string) => g.prisma.family.findUniqueOrThrow({ where: { id } });

  beforeAll(() => {
    process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
  });

  it('saves a country and its subdivision, names them in both languages, and says who set them', async () => {
    const out = await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'eg', subdivisionCode: 'eg-gz' });
    expect(out.contact).toMatchObject({
      countryCode: 'EG',
      subdivisionCode: 'EG-GZ',
      location: {
        country: { code: 'EG', en: 'Egypt', ar: 'مصر' },
        subdivision: { code: 'EG-GZ', en: 'Giza', ar: 'الجيزة' },
        label: { en: 'Governorate', ar: 'المحافظة' },
      },
      locationSource: 'staff',
    });
    expect(out.contact.locationUpdatedAt).toEqual(expect.any(String));
    expect(await family(famA().id)).toMatchObject({ countryCode: 'EG', subdivisionCode: 'EG-GZ', locationSource: 'staff', locationUpdatedBy: m.operationsManager.id });
    const rows = await g.prisma.auditLog.findMany({ where: { entityId: famA().parent.id, action: 'parent_profile.updated' }, orderBy: { id: 'desc' }, take: 1 });
    expect(rows[0]!.after).toMatchObject({ fields: expect.arrayContaining(['countryCode', 'subdivisionCode']) });
    expect(JSON.stringify(rows[0]!.after)).not.toMatch(/EG-GZ|Giza|الجيزة/);
  });

  it('refuses a subdivision of another country or one without a country, and drops the subdivision when the country changes', async () => {
    expect(await code(parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'EG', subdivisionCode: 'AE-DU' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(parents.update(m.operationsManager.id, famA().parent.id, { countryCode: null, subdivisionCode: 'EG-GZ' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(parents.update(m.operationsManager.id, famA().parent.id, { subdivisionCode: 'SA-01' }))).toBe(CommErrorCode.VALIDATION);
    expect(await family(famA().id)).toMatchObject({ countryCode: 'EG', subdivisionCode: 'EG-GZ' });
    const moved = await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'AE' });
    expect(moved.contact).toMatchObject({ countryCode: 'AE', subdivisionCode: null, location: { subdivision: null, label: { en: 'Emirate' } } });
    await parents.update(m.operationsManager.id, famA().parent.id, { subdivisionCode: 'AE-DU' });
    expect(await family(famA().id)).toMatchObject({ countryCode: 'AE', subdivisionCode: 'AE-DU' });
  });

  it('suggests the country of an international phone number while the family has none, and never saves it', async () => {
    const out = await parents.update(m.operationsManager.id, famB().parent.id, { countryCode: null, phone: '+966 50 765 4321' });
    expect(out.contact).toMatchObject({ countryCode: null, location: null });
    expect(out.suggestedCountryCode).toBe('SA');
    expect((await family(famB().id)).countryCode).toBeNull();
    const set = await parents.update(m.operationsManager.id, famB().parent.id, { countryCode: 'SA' });
    expect(set.suggestedCountryCode).toBeNull();
  });

  it('lists the parents whose location is missing (no country, or a country with subdivisions but none chosen), with each row\'s location', async () => {
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'EG', subdivisionCode: 'EG-C' });
    await parents.update(m.operationsManager.id, famB().parent.id, { countryCode: 'EG', subdivisionCode: null });
    const all = await parents.list(m.operationsManager.id);
    expect(all.items.find((i) => i.id === famA().parent.id)!.location).toEqual({ countryCode: 'EG', subdivisionCode: 'EG-C' });
    const missing = (await parents.list(m.operationsManager.id, undefined, 'missing')).items.map((i) => i.id);
    expect(missing).toContain(famB().parent.id);
    expect(missing).not.toContain(famA().parent.id);
    const noCountry = m.families.find((f) => f.id !== famA().id && f.id !== famB().id)!;
    await parents.update(m.operationsManager.id, noCountry.parent.id, { countryCode: null });
    expect((await parents.list(m.operationsManager.id, undefined, 'missing')).items.map((i) => i.id)).toContain(noCountry.parent.id);
    expect(await code(parents.list(m.operationsManager.id, undefined, 'everything'))).toBe(CommErrorCode.VALIDATION);
  });

  // ---- the contact keys (PD-42 S1, plan §9; review of #294) ---------------
  const keysOf = (familyId: string) =>
    g.prisma.$queryRawUnsafe<Array<{ key_hash: string; source: string }>>(
      `select key_hash, source from chat.family_contact_key where family_id = $1::uuid and kind = 'phone' order by key_hash`, familyId,
    );
  const holder = async (e164: string) =>
    (await g.prisma.$queryRawUnsafe<Array<{ family_id: string }>>(
      `select family_id::text from chat.family_contact_key where organization_id = $1::uuid and key_hash = $2`, orgId, contactKeyHash('phone', e164),
    ))[0]?.family_id ?? null;
  const holdFor = (familyId: string, e164: string) =>
    g.prisma.$executeRawUnsafe(
      `insert into chat.family_contact_key (organization_id, key_hash, family_id, kind) values ($1::uuid, $2, $3::uuid, 'phone')`,
      orgId, contactKeyHash('phone', e164), familyId,
    );

  it('re-keys a stored local number when a new country reads it as another one, and refuses a number another family already holds', async () => {
    // A local Gulf number, entered while the family had no country: unreadable, so not keyed.
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: null, phone: '050 765 0000' });
    await holdFor(famB().id, '+971507650000');
    const refused = await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'AE' }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: CommErrorCode.PARENT_EXISTS, status: 409 });
    // The answer names no family: not in the message, not in any detail.
    expect(JSON.stringify({ message: (refused as CommError).message, details: (refused as { details?: unknown }).details ?? null }))
      .not.toMatch(new RegExp(`${famB().id}|${famB().displayName}`));
    expect((await family(famA().id)).countryCode).toBeNull();
  });

  it('a country chosen by mistake leaves no key behind: Egypt, then the UAE, keeps only the UAE reading', async () => {
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: null, phone: '050 765 3333' });
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'EG' });
    expect(await holder('+20507653333')).toBe(famA().id);
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'AE' });
    expect(await holder('+20507653333')).toBeNull();
    expect(await holder('+971507653333')).toBe(famA().id);
    expect((await keysOf(famA().id)).filter((k) => k.source === 'rekey')).toEqual([
      { key_hash: contactKeyHash('phone', '+971507653333'), source: 'rekey' },
    ]);
    // A recorded key is not a re-key: it is never removed while the family exists.
    await expect(g.prisma.$executeRawUnsafe(
      `delete from chat.family_contact_key where family_id = $1::uuid and source = 'rekey'`, famA().id,
    )).rejects.toThrow(/never removed while its family exists/);
  });

  it('two country changes at once are serialised: one wins, and the family is keyed by that one reading only', async () => {
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'AE' });
    const outcomes = await Promise.allSettled([
      parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'EG' }),
      parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'SA' }),
    ]);
    expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
    const final = (await family(famA().id)).countryCode;
    expect(['EG', 'SA']).toContain(final);
    const reading = final === 'EG' ? '+20507653333' : '+966507653333';
    expect((await keysOf(famA().id)).filter((k) => k.source === 'rekey')).toEqual([{ key_hash: contactKeyHash('phone', reading), source: 'rekey' }]);
  });

  it('keys every changed number, read in the family\'s country -- alone or with a new country -- and refuses one another family holds', async () => {
    await parents.update(m.operationsManager.id, famA().parent.id, { phone: '+20 100 765 5555' });
    expect((await keysOf(famA().id)).find((k) => k.key_hash === contactKeyHash('phone', '+201007655555'))).toEqual({
      key_hash: contactKeyHash('phone', '+201007655555'), source: 'record',
    });
    // A new LOCAL number and a new country in one edit: read in the new country,
    // as a re-keyed reading -- so correcting that country replaces it.
    await parents.update(m.operationsManager.id, famA().parent.id, { phone: '050 765 4444', countryCode: 'AE' });
    expect((await keysOf(famA().id)).find((k) => k.key_hash === contactKeyHash('phone', '+971507654444'))).toEqual({
      key_hash: contactKeyHash('phone', '+971507654444'), source: 'rekey',
    });
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'SA' });
    expect(await holder('+971507654444')).toBeNull();
    expect(await holder('+966507654444')).toBe(famA().id);
    // Clearing the country reads the number in no country: a Gulf local number then has no key at all.
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: null });
    expect(await holder('+966507654444')).toBeNull();
    await parents.update(m.operationsManager.id, famA().parent.id, { countryCode: 'AE' });
    // Another family's number is refused, and nothing of the edit is kept.
    await holdFor(famB().id, '+971507659999');
    expect(await code(parents.update(m.operationsManager.id, famA().parent.id, { phone: '050 765 9999' }))).toBe(CommErrorCode.PARENT_EXISTS);
    expect((await g.prisma.parentFile.findUniqueOrThrow({ where: { contactId: famA().parent.id } })).adminOnlyParentPhone).toBe('050 765 4444');
  });

  it('lists as missing a family whose old country is not a country of the list, and only what the caller reaches', async () => {
    const legacy = m.families.find((f) => f.id !== famA().id && f.id !== famB().id)!;
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(`update chat.family set country_code = 'UK', subdivision_code = null where id = $1::uuid`, legacy.id);
    });
    expect((await parents.list(m.operationsManager.id, undefined, 'missing')).items.map((i) => i.id)).toContain(legacy.parent.id);
    for (const sup of m.supervisors) {
      const reach = reachableFamilies(sup.id);
      const listed = (await parents.list(sup.id, undefined, 'missing')).items;
      for (const item of listed) expect(reach.has(item.family.id)).toBe(true);
    }
  });
});
