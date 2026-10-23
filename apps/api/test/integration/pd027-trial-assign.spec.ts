/**
 * PD-27 -- a payment made BEFORE the family exists, and the database's own
 * guarantees.
 *
 *   1. After a trial, Sales asks for the subscription with a link (no family,
 *      no account yet). The parent pays by card; the verified webhook records
 *      the payment and its invoice against the trial.
 *   2. Assign (PD-16) creates the family: the request, the payment and the
 *      invoice move onto it in Assign's own transaction. The parent signs up
 *      with the form's e-mail -- Assign made it the account's subject -- and
 *      finds the invoice in their own payments. Nothing is matched on an
 *      e-mail Stripe collected.
 *   3. The guards hold for every writer: no payment, invoice, refund, receipt
 *      or request is deleted; recorded terms never change; refunds never exceed
 *      the payment; a card session is recorded once.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { NewStudentEnrolmentService } from '../../src/new-students/enrolment.service';
import { OrgStructureService } from '../../src/org/org-structure.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { BillingService } from '../../src/billing/billing.service';
import { CheckoutService } from '../../src/billing/checkout.service';
import { PaymentLedger } from '../../src/billing/payment-ledger.service';
import { PaymentReminders } from '../../src/billing/payment-reminders.service';
import { PaymentsReadService } from '../../src/billing/payments-read.service';
import { PaymentsService } from '../../src/billing/payments.service';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { FakeStripe } from './fake-stripe';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.PAYMENT_LINK_BASE_URL ??= 'https://pay.example.test/api/v1';

jest.setTimeout(60_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const stripe = new FakeStripe();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, new CardPoster(g.conversations, g.outbox, audit), g.config, audit);
const forms = new NewStudentsService(g.prisma);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, forms);
const ledger = new PaymentLedger(g.prisma, audit, g.notifications, g.reminders);
const reads = new PaymentsReadService(g.prisma);
const reminders = new PaymentReminders(g.prisma, g.reminders);
const billing = new BillingService(g.prisma, g.conversations, audit, ledger, reads, reminders, stripe);
const payments = new PaymentsService(g.prisma, g.conversations, billing, ledger, reads, g.notifications, stripe, audit);
const checkout = new CheckoutService(g.prisma, ledger, stripe, audit);
const enrolment = new NewStudentEnrolmentService(
  g.prisma, g.authz, g.conversations, forms, lessons, scheduling,
  new OrgStructureService(g.prisma, g.authz, g.conversations, audit), audit, ledger,
);

const MIN = 60_000;
let s: Scenario;
let salesId: string;
let EMAIL: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function department(kind: string, staffIds: string[]) {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`, kind,
  );
  for (const staffId of staffIds) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      staffId, id,
    );
  }
}

async function subscribedTrial(): Promise<string> {
  const prospectId = (await trials.createProspect(salesId, { displayName: `prospect_${randomUUID().slice(0, 6)}` })).id;
  const startsAt = new Date(Date.now() - 120 * MIN);
  const lesson = await g.prisma.lesson.create({
    data: {
      organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
      kind: 'trial', prospectId, teacherId: s.teacherId, startsAt, endsAt: new Date(startsAt.getTime() + 45 * MIN),
      createdByKind: 'staff', createdBy: salesId,
    },
  });
  await trials.outcome(salesId, lesson.id, {
    result: 'subscribed',
    subscription: {
      parent: { name: 'parent_q', email: EMAIL, phone: '+99 000 777 888' },
      children: [
        { name: 'child_q1', age: 9, course: 'course_q', teacherId: s.teacherId, packagePrice: 1250.5, lessonPrice: 125,
          schedule: [{ weekday: 2, time: '17:00' }] },
      ],
      payment: { currency: 'AED', method: 'invoice' },
    },
  });
  return lesson.id;
}

const payerOf = (trialId: string) => payments.trialPayer(salesId, trialId, (org, id) => forms.payerFor(org, id));

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
  salesId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sales_q', 'admin', true)`, salesId);
  await department('sales', [salesId]);
  EMAIL = `parent.${randomUUID().slice(0, 8)}@example.test`;
});

describe('1-2. paid before the family exists, attached at Assign, found by the parent after sign-up', () => {
  it('trial -> link -> card -> invoice -> Assign -> sign-up -> the parent\'s own invoice', async () => {
    const trialId = await subscribedTrial();

    // The form's package price is the suggestion; no phone or e-mail crosses into billing.
    const page = await payments.trialRequests(salesId, await payerOf(trialId));
    expect(page).toMatchObject({ suggestedAmountMinor: 125050, currency: 'AED', enrolledFamilyId: null, items: [] });
    expect(JSON.stringify(page)).not.toContain('777 888');
    expect(JSON.stringify(page)).not.toContain(EMAIL);

    const { request } = await payments.createTrialRequest(salesId, await payerOf(trialId), {
      label: 'Quran — 3 months', amountMinor: 125050, planMonths: 3,
    });
    expect(request).toMatchObject({ status: 'open', trialId, child: { id: null, name: 'child_q1' }, purpose: 'subscription' });
    expect(request.link).toMatch(/^https:\/\/pay\.example\.test\/api\/v1\/pay\/[A-Za-z0-9_-]{43}$/);
    // A teacher-side staff member without billing access cannot.
    expect(await code(payments.createTrialRequest(s.ownerId, await payerOf(trialId), { label: 'x', amountMinor: 1 }))).toBe(CommErrorCode.BILLING_DENIED);

    // The parent pays through the link (no account).
    const row = await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const url = await checkout.open(row, { locale: 'ar', returnUrl: request.link! });
    const sessionId = url.slice(url.lastIndexOf('/') + 1);
    const session = stripe.complete(sessionId);
    const signed = stripe.completedEvent(session);
    const event = stripe.verifyWebhook(Buffer.from(signed.body), signed.signature);
    expect(await checkout.handleEvent(event)).toBe('recorded');

    const payment = await g.prisma.payment.findFirstOrThrow({ where: { requestId: request.id } });
    expect(payment).toMatchObject({ familyId: null, trialLessonId: trialId, method: 'card', recordedBy: null, childName: 'child_q1' });
    const invoice = await g.prisma.invoice.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(invoice.number).toMatch(/^JW-\d{4}-000001$/);
    expect(invoice.snapshot).toMatchObject({ billedTo: 'parent_q', child: 'child_q1', planMonths: 3, amountMinor: 125050, currency: 'AED', method: 'card' });

    // Assign: the family is created, and everything moves onto it.
    const done = await enrolment.assign(s.managerId, trialId, { supervisorId: s.ownerId });
    const [learnerId] = done.learnerIds;
    expect(await g.prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ familyId: done.familyId, learnerId });
    expect(await g.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ familyId: done.familyId, learnerId });
    expect(await g.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ familyId: done.familyId });
    expect(await g.prisma.auditLog.count({ where: { action: 'payment.attached_at_assign', entityId: done.familyId } })).toBe(1);
    // Asking the trial again now points at the family.
    expect(await code(payments.createTrialRequest(salesId, await payerOf(trialId), { label: 'x', amountMinor: 1 }))).toBe(CommErrorCode.BILLING_STATE);

    // The parent signs up with the form's e-mail: Assign made it the account's
    // subject, which sign-up verifies (PD-16). Their own payments show the invoice.
    const contact = await g.prisma.contact.findFirstOrThrow({ where: { familyId: done.familyId } });
    const account = await g.prisma.account.findUniqueOrThrow({ where: { id: contact.accountId as string } });
    expect(account.subject).toBe(EMAIL.toLowerCase());
    const mine = await billing.mine(contact.id);
    expect(mine.invoices).toEqual([expect.objectContaining({ id: invoice.id, number: invoice.number, status: 'paid', amountMinor: 125050, planMonths: 3 })]);
    expect(mine.requests).toEqual([expect.objectContaining({ id: request.id, status: 'paid', child: { id: learnerId, name: 'child_q1' } })]);
  });
});

describe('3. the database guards money for every writer', () => {
  async function familyPayment() {
    const familyId = s.familyId;
    const created = await g.prisma.paymentRequest.create({
      data: {
        organizationId: (await g.prisma.family.findUniqueOrThrow({ where: { id: familyId } })).organizationId,
        token: PaymentLedger.newToken(), familyId, purpose: 'other', label: 'Guard test', amountMinor: 5000n, currency: 'AED',
        expiresAt: new Date(Date.now() + 86_400_000), createdBy: s.managerId,
      },
    });
    const recorded = await g.prisma.$transaction((tx) => ledger.record(tx, {
      organizationId: created.organizationId, familyId, trialLessonId: null, learnerId: null, childName: null,
      requestId: created.id, method: 'cash', amountMinor: 5000, currency: 'AED', paidOn: '2026-10-01',
      recordedBy: s.managerId, reference: null, auditActorId: s.managerId, auditReason: 'guard test',
    }));
    return { request: created, ...recorded };
  }

  it('nothing is deleted', async () => {
    const { request, payment, invoice } = await familyPayment();
    await expect(g.prisma.payment.delete({ where: { id: payment.id } })).rejects.toThrow(/never deleted/);
    await expect(g.prisma.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow(/never deleted/);
    await expect(g.prisma.paymentRequest.delete({ where: { id: request.id } })).rejects.toThrow(/never deleted/);
  });

  it('recorded terms never change; a void is final; an invoice never changes', async () => {
    const { request, payment, invoice } = await familyPayment();
    await expect(g.prisma.payment.update({ where: { id: payment.id }, data: { amountMinor: 1n } })).rejects.toThrow(/never changes/);
    await expect(g.prisma.paymentRequest.update({ where: { id: request.id }, data: { amountMinor: 1n } })).rejects.toThrow(/never change/);
    await expect(g.prisma.invoice.update({ where: { id: invoice.id }, data: { number: 'JW-1999-000001' } })).rejects.toThrow(/never changes/);
    await g.prisma.payment.update({ where: { id: payment.id }, data: { voidedAt: new Date(), voidedBy: s.managerId, voidReason: 'test' } });
    await expect(g.prisma.payment.update({ where: { id: payment.id }, data: { voidReason: 'changed' } })).rejects.toThrow(/is final/);
  });

  it('refunds never exceed the payment; a card session is recorded once', async () => {
    const { payment } = await familyPayment();
    await g.prisma.paymentRefund.create({ data: { organizationId: payment.organizationId, paymentId: payment.id, amountMinor: 3000n, reason: 'part', recordedBy: s.managerId } });
    await expect(g.prisma.paymentRefund.create({
      data: { organizationId: payment.organizationId, paymentId: payment.id, amountMinor: 2001n, reason: 'too much', recordedBy: s.managerId },
    })).rejects.toThrow(/never exceed/);

    const base = {
      organizationId: payment.organizationId, familyId: s.familyId, method: 'card', amountMinor: 100n, currency: 'AED',
      paidOn: new Date('2026-10-01T00:00:00Z'), stripeCheckoutSessionId: 'cs_test_once',
    };
    await g.prisma.payment.create({ data: base });
    await expect(g.prisma.payment.create({ data: base })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('invoice numbers are the database\'s, in sequence per organization and year', async () => {
    const a = await familyPayment();
    const b = await familyPayment();
    const n = (x: string) => Number(x.split('-')[2]);
    expect(n(b.invoice.number)).toBe(n(a.invoice.number) + 1);
  });
});
