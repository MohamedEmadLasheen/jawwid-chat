/**
 * PD-59: SalesPipelineService against a stub database -- who is refused before
 * anything is read, that a list never carries a contact value, that only a genuine
 * detail read audits a view, and how a conversion links an existing family without
 * losing a channel or leaving a refusal unaudited. (The SQL itself is exercised by
 * the integration suite where a database is available.)
 */
import { SalesPipelineService } from '../../../src/sales-pipeline/sales-pipeline.service';
import { CommErrorCode } from '../../../src/platform/errors';
import { contactKeyHash } from '../../../src/new-students/contact-key';

const ORG = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const LEAD = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const OTHER_FAMILY = '55555555-5555-4555-8555-555555555555';
const CONTACT_ID = '66666666-6666-4666-8666-666666666666';
const LESSON = '77777777-7777-4777-8777-777777777777';
const SECRET_PHONE = '+201001234567';
const SECRET_WA = '+201005550000';
const SECRET_EMAIL = 'parent@example.com';

const phoneKey = (n: string) => contactKeyHash('phone', n);
const emailKey = (e: string) => contactKeyHash('email', e);

interface Stub {
  staff: { role: string; sales: string | null; active?: boolean } | null;
  prospects?: unknown[];
  contact: Record<string, unknown> | null;
  /** The family the lead's keys find (as a held key), or null. */
  family?: string | null;
  owns?: boolean;
  /** Keys the matched family holds. */
  familyKeys?: string[];
  /** The family's parent file: which slots are filled. */
  file?: { phone: boolean; email: boolean } | null;
  /** The lead's own trial lessons (a subscribed one makes it Converted by derivation). */
  lessons?: unknown[];
  convertedAt?: Date | null;
  enrolledFamily?: string | null;
  /** A key of the lead already held by another family. */
  foreignKey?: string | null;
}

function build(stub: Stub) {
  const audits: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const filled: Array<Record<string, unknown>> = [];
  const keysCreated: Array<Record<string, unknown>> = [];
  let contactReads = 0;
  let rolledBack = 0;
  const familyKeys = stub.familyKeys ?? [];
  const tx: Record<string, unknown> = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) return [{ id: LEAD }];
      if (sql.includes('staff_owns_family')) return [{ owns: stub.owns ?? false }];
      return [];
    },
    trialProspect: {
      findFirst: async () => ({
        id: LEAD, displayName: 'Layla', level: null, note: null, createdAt: new Date('2026-06-01T00:00:00Z'),
        pipelineStage: 'contacted', lostReason: null, lastContactedAt: null, nextFollowUpOn: null, followUpNote: null,
        convertedAt: stub.convertedAt ?? null, convertedFamilyId: null, lessons: stub.lessons ?? [],
      }),
      update: async (a: Record<string, unknown>) => { updates.push(a); },
    },
    salesLeadContact: {
      findUnique: async () => { contactReads += 1; return stub.contact; },
      create: async () => undefined,
      update: async () => undefined,
      delete: async (a: { where: { prospectId: string } }) => { deleted.push(a.where.prospectId); },
    },
    account: { findUnique: async () => null },
    contact: { findFirst: async () => null },
    studentEnrolment: { findFirst: async () => (stub.enrolledFamily ? { familyId: stub.enrolledFamily } : null) },
    family: { findFirst: async () => ({ primaryContactId: CONTACT_ID }) },
    parentFile: {
      findUnique: async () => (stub.file ? { adminOnlyParentPhone: stub.file.phone ? 'x' : null, adminOnlyParentEmail: stub.file.email ? 'x' : null } : null),
      updateMany: async (a: Record<string, unknown>) => { filled.push(a); return { count: 1 }; },
    },
    familyContactKey: {
      findFirst: async () => (stub.family ? { familyId: stub.family } : null),
      findMany: async () => [
        ...familyKeys.map((keyHash) => ({ keyHash, familyId: stub.family ?? FAMILY })),
        ...(stub.foreignKey ? [{ keyHash: stub.foreignKey, familyId: OTHER_FAMILY }] : []),
      ],
      create: async (a: Record<string, unknown>) => { keysCreated.push(a); },
    },
  };
  const prisma = {
    ...tx,
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('chat.sales_department_role')) {
        return stub.staff ? [{ organization_id: ORG, role: stub.staff.role, is_active: stub.staff.active !== false, left: false, sales: stub.staff.sales }] : [];
      }
      if (sql.includes('sales_lead_contact')) return stub.contact ? [{ id: LEAD, phone: true, whatsapp: false, email: true }] : [];
      return [];
    },
    trialProspect: { ...(tx.trialProspect as object), findMany: async () => stub.prospects ?? [] },
    studentEnrolment: { findMany: async () => [], findFirst: (tx.studentEnrolment as { findFirst: () => unknown }).findFirst },
    // A failing callback rolls its audit rows back, as a real transaction does.
    $transaction: async (fn: (t: unknown) => unknown) => {
      const mark = audits.length;
      try {
        return await fn(tx);
      } catch (e) {
        audits.length = mark;
        rolledBack += 1;
        throw e;
      }
    },
  };
  const audit = { audit: async (_t: unknown, i: Record<string, unknown>) => { audits.push(i); }, event: async () => undefined };
  const config = { get: async () => null };
  const service = new SalesPipelineService(prisma as never, config as never, audit as never);
  return { service, audits, updates, deleted, filled, keysCreated, contactReads: () => contactReads, rolledBack: () => rolledBack };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: LEAD, displayName: 'Layla', level: null, createdAt: new Date('2026-06-01T00:00:00Z'),
  pipelineStage: 'contacted', lostReason: null, lastContactedAt: null, nextFollowUpOn: null, followUpNote: null,
  convertedAt: null, convertedFamilyId: null, lessons: [], ...over,
});
const contact = { parentName: 'Sara', confinedLeadPhone: SECRET_PHONE, confinedLeadWhatsapp: null, confinedLeadEmail: SECRET_EMAIL, countryCode: null };
const member = { role: 'admin', sales: 'member' };
const subscribedLesson = {
  id: LESSON, startsAt: new Date('2026-06-02T09:00:00Z'), outcome: 'held', trialOutcome: { result: 'subscribed', reasonCode: null },
};

describe('SalesPipelineService', () => {
  it.each([
    ['a teacher or a parent (no staff row)', null],
    ['an Operations supervisor', { role: 'admin', sales: null }],
    ['a Teachers manager', { role: 'manager', sales: null }],
    ['an inactive Sales member', { role: 'admin', sales: 'member', active: false }],
  ])('refuses %s before reading anything', async (_label, staff) => {
    const { service, contactReads } = build({ staff, prospects: [row()], contact });
    for (const call of [
      () => service.list(ME, {}),
      () => service.get(ME, LEAD),
      () => service.create(ME, { displayName: 'x' }),
      () => service.update(ME, LEAD, {}),
      () => service.markContacted(ME, LEAD, {}),
      () => service.convert(ME, LEAD),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_DENIED, status: 403 });
    }
    expect(contactReads()).toBe(0);
  });

  it('answers the advisory probe without throwing', async () => {
    expect(await build({ staff: member, contact: null }).service.access(ME)).toEqual({ allowed: true, standing: 'sales_member' });
    expect(await build({ staff: { role: 'admin', sales: null }, contact: null }).service.access(ME)).toEqual({ allowed: false, standing: null });
  });

  it('a list row says a channel exists and never carries a contact value', async () => {
    const { service, contactReads, audits } = build({ staff: member, prospects: [row()], contact });
    const page = await service.list(ME, {});
    expect(page.leads[0]!.contact).toEqual({ phone: true, whatsapp: false, email: true });
    const text = JSON.stringify(page);
    for (const secret of [SECRET_PHONE, SECRET_EMAIL, 'Sara']) expect(text).not.toContain(secret);
    expect(contactReads()).toBe(0);
    expect(audits).toEqual([]);
    expect(page.counts.contacted).toBe(1);
  });

  it('refuses an unknown stage filter, and a search that is a number or an e-mail (it would reach request logs)', async () => {
    const { service } = build({ staff: member, contact: null });
    await expect(service.list(ME, { stage: 'won' })).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_INVALID, message: 'stage: a known stage' });
    await expect(service.list(ME, { q: '+20 100 123 4567' })).rejects.toMatchObject({ message: 'q: search by name only' });
    await expect(service.list(ME, { q: 'a@b.co' })).rejects.toMatchObject({ message: 'q: search by name only' });
    await expect(service.list(ME, { q: 'Layla' })).resolves.toBeDefined();
  });

  it('the detail read returns the contact and audits that it was read, without the values', async () => {
    const { service, audits } = build({ staff: member, contact });
    const lead = await service.get(ME, LEAD);
    expect(lead.contact).toEqual({ parentName: 'Sara', phone: SECRET_PHONE, whatsapp: null, email: SECRET_EMAIL, country: null });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: ME, action: 'sales_lead.contact_viewed', entity: 'trial_prospect', entityId: LEAD });
    expect(JSON.stringify(audits)).not.toContain(SECRET_PHONE);
  });

  it('a write returns the lead WITHOUT a separate audited view row: the write is itself audited', async () => {
    const a = build({ staff: member, contact });
    const updated = await a.service.update(ME, LEAD, { nextFollowUpOn: '2026-12-01' });
    expect(updated.contact?.phone).toBe(SECRET_PHONE);
    expect(a.audits.map((x) => x.action)).toEqual(['sales_lead.follow_up_changed']);
    const b = build({ staff: member, contact });
    await b.service.markContacted(ME, LEAD, {});
    expect(b.audits.map((x) => x.action)).toEqual(['sales_lead.contacted']);
    const c = build({ staff: member, contact: null });
    await expect(c.service.update(ME, LEAD, { contact: { parentName: 'Sara', phone: SECRET_PHONE } })).resolves.toBeDefined();
    expect(c.audits.map((x) => x.action)).not.toContain('sales_lead.contact_viewed');
  });

  describe('convert', () => {
    const keys = { phone: phoneKey(SECRET_PHONE), email: emailKey(SECRET_EMAIL) };

    it('links the family that already holds the parent, deletes the lead\'s copy and audits it', async () => {
      const t = build({ staff: member, contact, family: FAMILY, owns: true, familyKeys: [keys.phone, keys.email] });
      expect(await t.service.convert(ME, LEAD)).toEqual({ outcome: 'linked', familyId: FAMILY });
      expect(t.updates[0]).toMatchObject({ where: { id: LEAD }, data: { convertedFamilyId: FAMILY } });
      expect(t.deleted).toEqual([LEAD]);
      expect(t.filled).toEqual([]);
      expect(t.audits.map((a) => a.action)).toEqual(['sales_lead.converted']);
      expect(JSON.stringify(t.audits)).not.toContain(SECRET_EMAIL);
    });

    it('S3: a channel the family lacks is written into its EMPTY slot and keyed before the copy is deleted', async () => {
      // Matched by e-mail; the family record has no phone yet.
      const t = build({ staff: member, contact, family: FAMILY, owns: true, familyKeys: [keys.email], file: { phone: false, email: true } });
      expect(await t.service.convert(ME, LEAD)).toEqual({ outcome: 'linked', familyId: FAMILY });
      expect(t.filled).toHaveLength(1);
      expect(t.filled[0]).toMatchObject({ where: { contactId: CONTACT_ID, adminOnlyParentPhone: null } });
      expect(t.keysCreated).toEqual([{ data: expect.objectContaining({ keyHash: keys.phone, familyId: FAMILY, kind: 'phone' }) }]);
      expect(t.deleted).toEqual([LEAD]);
      expect(t.audits[0]).toMatchObject({ action: 'sales_lead.converted', after: expect.objectContaining({ channelsAdded: ['phone'] }) });
    });

    it('S3: when a channel has no room the hand-over is REFUSED, the contact is kept, and the refusal is audited', async () => {
      // WhatsApp number the family does not hold, and its phone slot is already taken.
      const withWa = { ...contact, confinedLeadWhatsapp: SECRET_WA };
      const t = build({ staff: member, contact: withWa, family: FAMILY, owns: true, familyKeys: [keys.phone, keys.email], file: { phone: true, email: true } });
      await expect(t.service.convert(ME, LEAD)).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_STATE, status: 409 });
      expect(t.deleted).toEqual([]);
      expect(t.updates).toEqual([]);
      expect(t.filled).toEqual([]);
      expect(t.audits).toEqual([{ actorId: ME, action: 'sales_lead.convert_refused', entity: 'trial_prospect', entityId: LEAD, after: { outcome: 'channel_missing' }, reason: expect.any(String) }]);
      expect(JSON.stringify(t.audits)).not.toContain(SECRET_WA);
    });

    it('S3: a key another family holds is the intake\'s refusal, and nothing is merged', async () => {
      const t = build({ staff: member, contact, family: FAMILY, owns: true, familyKeys: [keys.email], foreignKey: keys.phone, file: { phone: false, email: true } });
      await expect(t.service.convert(ME, LEAD)).rejects.toMatchObject({ code: CommErrorCode.PARENT_EXISTS });
      expect(t.filled).toEqual([]);
      expect(t.deleted).toEqual([]);
    });

    it('S1: a lead a SUBSCRIBED TRIAL made Converted is linked to the family Operations enrolled, and its copy deleted', async () => {
      const t = build({
        staff: member, contact, lessons: [subscribedLesson], enrolledFamily: FAMILY, family: FAMILY, owns: false,
        familyKeys: [keys.phone, keys.email],
      });
      expect(await t.service.convert(ME, LEAD)).toEqual({ outcome: 'linked', familyId: FAMILY });
      expect(t.updates[0]).toMatchObject({ data: { convertedFamilyId: FAMILY } });
      expect(t.deleted).toEqual([LEAD]);
    });

    it('S1: a subscribed-trial lead not yet enrolled says so and changes nothing', async () => {
      const t = build({ staff: member, contact, lessons: [subscribedLesson] });
      expect(await t.service.convert(ME, LEAD)).toEqual({ outcome: 'awaiting_enrolment', familyId: null });
      expect(t.updates).toEqual([]);
      expect(t.deleted).toEqual([]);
      expect(t.audits.map((a) => [a.action, a.after])).toEqual([['sales_lead.convert_attempted', { outcome: 'awaiting_enrolment' }]]);
    });

    it('S1: a lead already handed over is never converted twice (the row lock decides one at a time)', async () => {
      const t = build({ staff: member, contact: null, lessons: [subscribedLesson], convertedAt: new Date() });
      await expect(t.service.convert(ME, LEAD)).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_STATE, message: 'this lead is already converted' });
      expect(t.updates).toEqual([]);
      expect(t.audits.map((a) => a.after)).toEqual([{ outcome: 'already_converted' }]);
    });

    it('creates nothing when no family holds the parent: the family intake is the hand-over, and the attempt is audited', async () => {
      const t = build({ staff: member, contact, family: null, owns: true });
      expect(await t.service.convert(ME, LEAD)).toEqual({ outcome: 'intake_required', familyId: null });
      expect(t.updates).toEqual([]);
      expect(t.deleted).toEqual([]);
      expect(t.audits.map((a) => [a.action, a.after])).toEqual([['sales_lead.convert_attempted', { outcome: 'intake_required' }]]);
    });

    it('S4: a family that is not the caller\'s answers as the intake does, naming nothing, and the refusal is audited', async () => {
      const t = build({ staff: member, contact, family: FAMILY, owns: false, familyKeys: [keys.phone, keys.email] });
      const err = await t.service.convert(ME, LEAD).catch((e) => e);
      expect(err).toMatchObject({ code: CommErrorCode.PARENT_EXISTS, status: 409 });
      expect(err.message).not.toContain(FAMILY);
      expect(err.detail).toBeUndefined();
      expect(t.updates).toEqual([]);
      expect(t.audits.map((a) => [a.action, a.after])).toEqual([['sales_lead.convert_refused', { outcome: 'unavailable' }]]);
    });

    it('S4: a lead with no contact is refused and audited', async () => {
      const t = build({ staff: member, contact: null, family: null, owns: true });
      await expect(t.service.convert(ME, LEAD)).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_STATE, status: 409 });
      expect(t.audits.map((a) => a.after)).toEqual([{ outcome: 'no_contact' }]);
    });

    it('S4: an unreadable number is refused with the channel kind, never the number, and audited', async () => {
      const t = build({ staff: member, contact: { ...contact, confinedLeadPhone: '050 123 4567' }, owns: true });
      const err = await t.service.convert(ME, LEAD).catch((e) => e);
      expect(err).toMatchObject({ code: CommErrorCode.SALES_LEAD_STATE });
      expect(String(err.message)).not.toContain('050 123');
      expect(t.audits.map((a) => a.after)).toEqual([{ outcome: 'number_unreadable' }]);
    });
  });

  it('a malformed lead id is not found, not an error from the database', async () => {
    const { service } = build({ staff: member, contact });
    await expect(service.get(ME, 'not-a-uuid')).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_NOT_FOUND, status: 404 });
  });
});
