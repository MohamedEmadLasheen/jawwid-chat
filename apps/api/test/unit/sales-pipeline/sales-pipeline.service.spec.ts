/**
 * PD-59: SalesPipelineService against a stub database -- who is refused before
 * anything is read, that a list never carries a contact value, that only the
 * detail read returns the contact and audits it, and that a conversion links an
 * existing family instead of creating one. (The SQL itself is exercised by the
 * integration suite where a database is available.)
 */
import { SalesPipelineService } from '../../../src/sales-pipeline/sales-pipeline.service';
import { CommErrorCode } from '../../../src/platform/errors';

const ORG = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const LEAD = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const SECRET_PHONE = '+201001234567';
const SECRET_EMAIL = 'parent@example.com';

interface Stub {
  staff: { role: string; sales: string | null; active?: boolean } | null;
  prospects: unknown[];
  contact: Record<string, unknown> | null;
  family: string | null;
  owns: boolean;
}

function build(stub: Stub) {
  const audits: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  let contactReads = 0;
  const tx: Record<string, unknown> = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) return [{ id: LEAD }];
      if (sql.includes('staff_owns_family')) return [{ owns: stub.owns }];
      return [];
    },
    trialProspect: {
      findFirst: async () => ({
        id: LEAD, displayName: 'Layla', level: null, note: null, createdAt: new Date('2026-06-01T00:00:00Z'),
        pipelineStage: 'contacted', lostReason: null, lastContactedAt: null, nextFollowUpOn: null, followUpNote: null,
        convertedAt: null, convertedFamilyId: null, lessons: [],
      }),
      update: async (a: Record<string, unknown>) => { updates.push(a); },
    },
    salesLeadContact: {
      findUnique: async () => { contactReads += 1; return stub.contact; },
      delete: async (a: { where: { prospectId: string } }) => { deleted.push(a.where.prospectId); },
    },
    account: { findUnique: async () => null },
    contact: { findFirst: async () => null },
    familyContactKey: { findFirst: async () => (stub.family ? { familyId: stub.family } : null) },
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
    trialProspect: { ...(tx.trialProspect as object), findMany: async () => stub.prospects },
    studentEnrolment: { findMany: async () => [] },
    $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  };
  const audit = { audit: async (_t: unknown, i: Record<string, unknown>) => { audits.push(i); }, event: async () => undefined };
  const config = { get: async () => null };
  const service = new SalesPipelineService(prisma as never, config as never, audit as never);
  return { service, audits, updates, deleted, contactReads: () => contactReads };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: LEAD, displayName: 'Layla', level: null, createdAt: new Date('2026-06-01T00:00:00Z'),
  pipelineStage: 'contacted', lostReason: null, lastContactedAt: null, nextFollowUpOn: null, followUpNote: null,
  convertedAt: null, convertedFamilyId: null, lessons: [], ...over,
});
const contact = { parentName: 'Sara', confinedLeadPhone: SECRET_PHONE, confinedLeadWhatsapp: null, confinedLeadEmail: SECRET_EMAIL, countryCode: null };

describe('SalesPipelineService', () => {
  it.each([
    ['a teacher or a parent (no staff row)', null],
    ['an Operations supervisor', { role: 'admin', sales: null }],
    ['a Teachers manager', { role: 'manager', sales: null }],
    ['an inactive Sales member', { role: 'admin', sales: 'member', active: false }],
  ])('refuses %s before reading anything', async (_label, staff) => {
    const { service, contactReads } = build({ staff, prospects: [row()], contact, family: null, owns: false });
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
    expect(await build({ staff: { role: 'admin', sales: 'member' }, prospects: [], contact: null, family: null, owns: false }).service.access(ME))
      .toEqual({ allowed: true, standing: 'sales_member' });
    expect(await build({ staff: { role: 'admin', sales: null }, prospects: [], contact: null, family: null, owns: false }).service.access(ME))
      .toEqual({ allowed: false, standing: null });
  });

  it('a list row says a channel exists and never carries a contact value', async () => {
    const { service, contactReads, audits } = build({ staff: { role: 'admin', sales: 'member' }, prospects: [row()], contact, family: null, owns: false });
    const page = await service.list(ME, {});
    expect(page.leads).toHaveLength(1);
    expect(page.leads[0]!.contact).toEqual({ phone: true, whatsapp: false, email: true });
    const text = JSON.stringify(page);
    expect(text).not.toContain(SECRET_PHONE);
    expect(text).not.toContain(SECRET_EMAIL);
    expect(text).not.toContain('Sara');
    expect(contactReads()).toBe(0); // the values were never read for a list
    expect(audits).toEqual([]);
    expect(page.counts.contacted).toBe(1);
  });

  it('refuses an unknown stage filter with a 400 that names the field', async () => {
    const { service } = build({ staff: { role: 'admin', sales: 'member' }, prospects: [], contact: null, family: null, owns: false });
    await expect(service.list(ME, { stage: 'won' })).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_INVALID, status: 400, message: 'stage: a known stage' });
  });

  it('the detail read returns the contact and audits that it was read, without the values', async () => {
    const { service, audits } = build({ staff: { role: 'admin', sales: 'member' }, prospects: [], contact, family: null, owns: false });
    const lead = await service.get(ME, LEAD);
    expect(lead.contact).toEqual({ parentName: 'Sara', phone: SECRET_PHONE, whatsapp: null, email: SECRET_EMAIL, country: null });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: ME, action: 'sales_lead.contact_viewed', entity: 'trial_prospect', entityId: LEAD });
    expect(JSON.stringify(audits)).not.toContain(SECRET_PHONE);
    expect(JSON.stringify(audits)).not.toContain(SECRET_EMAIL);
  });

  it('convert links the family that already holds the parent, deletes the lead\'s copy and audits it', async () => {
    const { service, audits, updates, deleted } = build({ staff: { role: 'admin', sales: 'member' }, prospects: [], contact, family: FAMILY, owns: true });
    expect(await service.convert(ME, LEAD)).toEqual({ outcome: 'linked', familyId: FAMILY });
    expect(updates[0]).toMatchObject({ where: { id: LEAD }, data: { convertedFamilyId: FAMILY } });
    expect(deleted).toEqual([LEAD]);
    expect(audits.map((a) => a.action)).toEqual(['sales_lead.converted']);
    expect(JSON.stringify(audits)).not.toContain(SECRET_EMAIL);
  });

  it('convert creates nothing when no family holds the parent: the family intake is the hand-over', async () => {
    const { service, audits, updates, deleted } = build({ staff: { role: 'admin', sales: 'member' }, prospects: [], contact, family: null, owns: true });
    expect(await service.convert(ME, LEAD)).toEqual({ outcome: 'intake_required', familyId: null });
    expect(updates).toEqual([]);
    expect(deleted).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('convert onto a family that is not the caller\'s answers as the intake does, naming nothing', async () => {
    const { service, updates } = build({ staff: { role: 'admin', sales: 'member' }, prospects: [], contact, family: FAMILY, owns: false });
    const err = await service.convert(ME, LEAD).catch((e) => e);
    expect(err).toMatchObject({ code: CommErrorCode.PARENT_EXISTS, status: 409 });
    expect(err.message).not.toContain(FAMILY);
    expect(err.detail).toBeUndefined();
    expect(updates).toEqual([]);
  });

  it('convert refuses a lead with no contact to match', async () => {
    const { service } = build({ staff: { role: 'admin', sales: 'member' }, prospects: [], contact: null, family: null, owns: true });
    await expect(service.convert(ME, LEAD)).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_STATE, status: 409 });
  });

  it('a malformed lead id is not found, not an error from the database', async () => {
    const { service } = build({ staff: { role: 'admin', sales: 'member' }, prospects: [], contact, family: null, owns: false });
    await expect(service.get(ME, 'not-a-uuid')).rejects.toMatchObject({ code: CommErrorCode.SALES_LEAD_NOT_FOUND, status: 404 });
  });
});
