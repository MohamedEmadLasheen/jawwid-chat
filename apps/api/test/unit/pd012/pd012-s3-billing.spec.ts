/**
 * PD-12 S3, the pure parts: who reads instalments, the derived status and the
 * page order, and the Core invoice boundary (strict parsing, scope never widened
 * by Core, "not connected" unless switched on).
 */
import { decideBillingAccess } from '@platform/pd012-policy';
import type { Actor } from '@platform/types';
import { compareInstalments, daysFrom, statusOf } from '../../../src/billing/instalment';
import {
  CoreInvoiceSourceError,
  HttpCoreInvoiceSource,
  coreInvoiceSourceFromEnv,
  parseInvoices,
} from '../../../src/billing/core-invoice-source';

const ORG = '11111111-1111-1111-1111-111111111111';
// Core's ids are MongoDB ObjectIds -- opaque text, not UUIDs (20261019200000).
const P1 = '652f1c2ab8e4a10012ab34cd';
const P2 = '652f1c2ab8e4a10012ab34ce';
const C1 = '652f1c2ab8e4a10012ab9f01';

function staff(role: string, over: Partial<Actor> = {}): Actor {
  return { actorId: 's', kind: 'staff', displayName: 's', locale: 'ar', isActive: true, staffRole: role as never, organizationId: ORG, ...over };
}

describe('who reads instalments (billing.family_read)', () => {
  it.each`
    role             | dept         | scope      | assign
    ${'super_admin'} | ${null}      | ${'all'}   | ${true}
    ${'manager'}     | ${'manager'} | ${'all'}   | ${true}
    ${'admin'}       | ${'member'}  | ${'reach'} | ${false}
    ${'coverage'}    | ${'member'}  | ${'reach'} | ${false}
    ${'manager'}     | ${null}      | ${null}    | ${false}
    ${'manager'}     | ${'member'}  | ${null}    | ${false}
    ${'admin'}       | ${null}      | ${null}    | ${false}
    ${'admin'}       | ${'manager'} | ${null}    | ${false}
    ${'finance'}     | ${'member'}  | ${null}    | ${false}
  `('$role in Operations as $dept -> $scope', ({ role, dept, scope, assign }) => {
    expect(decideBillingAccess(staff(role), dept)).toEqual({ scope, canAssign: assign });
  });

  it('never a teacher, a parent, an inactive or org-less staff member', () => {
    const teacher: Actor = { actorId: 't', kind: 'teacher', displayName: 't', locale: 'ar', isActive: true, organizationId: ORG };
    const parent: Actor = { actorId: 'p', kind: 'contact', displayName: 'p', locale: 'ar', isActive: true, organizationId: ORG };
    expect(decideBillingAccess(teacher, 'manager').scope).toBeNull();
    expect(decideBillingAccess(parent, 'manager').scope).toBeNull();
    expect(decideBillingAccess(staff('super_admin', { isActive: false }), null).scope).toBeNull();
    expect(decideBillingAccess(staff('super_admin', { organizationId: undefined }), null).scope).toBeNull();
  });
});

describe('the instalment status and order', () => {
  const today = '2026-10-19';

  it('derives paid / overdue / due / upcoming from the academy day', () => {
    expect(statusOf({ status: 'paid', dueDate: '2026-10-01' }, today)).toBe('paid');
    expect(statusOf({ status: 'open', dueDate: '2026-10-18' }, today)).toBe('overdue');
    expect(statusOf({ status: 'open', dueDate: today }, today)).toBe('due');
    expect(statusOf({ status: 'open', dueDate: '2026-10-20' }, today)).toBe('upcoming');
  });

  it('orders overdue (oldest first) > due today > upcoming (soonest) > paid (latest first)', () => {
    const rows = [
      { id: 'u2', status: 'upcoming' as const, dueDate: '2026-11-30' },
      { id: 'p1', status: 'paid' as const, dueDate: '2026-09-01' },
      { id: 'o2', status: 'overdue' as const, dueDate: '2026-10-10' },
      { id: 'd1', status: 'due' as const, dueDate: today },
      { id: 'u1', status: 'upcoming' as const, dueDate: '2026-10-25' },
      { id: 'p2', status: 'paid' as const, dueDate: '2026-10-01' },
      { id: 'o1', status: 'overdue' as const, dueDate: '2026-08-01' },
    ];
    expect(rows.sort(compareInstalments).map((r) => r.id)).toEqual(['o1', 'o2', 'd1', 'u1', 'u2', 'p2', 'p1']);
  });

  it('counts whole calendar days across a month end', () => {
    expect(daysFrom('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysFrom(today, '2026-10-12')).toBe(-7);
  });
});

describe('the Core invoice boundary', () => {
  const asked = new Set([P1]);
  const good = { id: 'inv-1', parent_id: P1, child_id: null, amount_minor: 150000, currency: 'EGP', due_date: '2026-10-25', status: 'open' };

  it('reads a well-formed invoice, family or per child, keeping Core ids exactly as sent', () => {
    const out = parseInvoices({ invoices: [good, { ...good, id: 'inv-2', child_id: C1, label: ' Quran ' }] }, asked, false);
    expect(out).toEqual([
      { id: 'inv-1', parentId: P1, childId: null, amountMinor: 150000, currency: 'EGP', dueDate: '2026-10-25', status: 'open', paidAt: null, label: null },
      { id: 'inv-2', parentId: P1, childId: C1, amountMinor: 150000, currency: 'EGP', dueDate: '2026-10-25', status: 'open', paidAt: null, label: 'Quran' },
    ]);
  });

  it('drops an invoice for a parent Chat did not ask about: Core cannot widen the scope', () => {
    expect(parseInvoices({ invoices: [{ ...good, parent_id: P2 }] }, asked, false)).toEqual([]);
    // Exact comparison: a re-cased id is another id, not the same one.
    expect(parseInvoices({ invoices: [{ ...good, parent_id: P1.toUpperCase() }] }, asked, false)).toEqual([]);
  });

  it('drops malformed invoices instead of guessing, and void ones always', () => {
    const bad = [
      { ...good, amount_minor: 1.5 },
      { ...good, amount_minor: -1 },
      { ...good, amount_minor: '100' },
      { ...good, currency: 'egp' },
      { ...good, due_date: '25/10/2026' },
      { ...good, status: 'void' },
      { ...good, child_id: 42 },
      { ...good, child_id: '   ' },
      { ...good, child_id: 'x'.repeat(201) },
      { ...good, id: '' },
      null,
      'x',
    ];
    expect(parseInvoices({ invoices: bad }, asked, true)).toEqual([]);
  });

  it('hides paid invoices unless asked for them', () => {
    const paid = { ...good, status: 'paid', paid_at: '2026-10-02T09:00:00Z' };
    expect(parseInvoices({ invoices: [paid] }, asked, false)).toEqual([]);
    expect(parseInvoices({ invoices: [paid] }, asked, true)[0]).toMatchObject({ status: 'paid', paidAt: '2026-10-02T09:00:00Z' });
  });

  it('refuses an answer without an invoices list', () => {
    expect(() => parseInvoices({}, asked, false)).toThrow(CoreInvoiceSourceError);
    expect(() => parseInvoices(null, asked, false)).toThrow(CoreInvoiceSourceError);
  });

  it('is not connected unless explicitly switched on', () => {
    expect(coreInvoiceSourceFromEnv({}).connected).toBe(false);
    expect(coreInvoiceSourceFromEnv({ CORE_BASE_URL: 'http://localhost:54321', CORE_API_KEY: 'k' }).connected).toBe(false);
    expect(coreInvoiceSourceFromEnv({ CORE_INVOICES_ENABLED: 'true', CORE_BASE_URL: 'http://core' }).connected).toBe(false);
    expect(coreInvoiceSourceFromEnv({ CORE_INVOICES_ENABLED: 'true', CORE_BASE_URL: 'http://core', CORE_API_KEY: 'k' }).connected).toBe(true);
  });

  it('asks Core for exactly the parents in scope, with the API key, in batches', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ invoices: [good] }), { status: 200 });
    }) as unknown as typeof fetch;
    const parents = Array.from({ length: 450 }, (_, i) => (i === 0 ? P1 : `652f1c2ab8e4a1${String(i).padStart(10, '0')}`));
    const source = new HttpCoreInvoiceSource('http://core/', 'secret', 1000, fake);
    const out = await source.invoicesFor(parents, { includePaid: false });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe('http://core/integration/chat/invoices/query');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    const sent = calls.map((c) => JSON.parse(c.init.body as string) as { parent_ids: string[]; include_paid: boolean });
    expect(sent.flatMap((b) => b.parent_ids)).toEqual(parents);
    expect(sent.every((b) => b.include_paid === false)).toBe(true);
    // P1 is only in the first batch: the same invoice echoed by the others is dropped.
    expect(out).toHaveLength(1);
  });

  it('turns an unreachable or failing Core into one error, never an empty list', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(new HttpCoreInvoiceSource('http://core', 'k', 1000, down).invoicesFor([P1], { includePaid: false })).rejects.toThrow(
      CoreInvoiceSourceError,
    );
    await expect(new HttpCoreInvoiceSource('http://core', 'k', 1000, failing).invoicesFor([P1], { includePaid: false })).rejects.toThrow(
      CoreInvoiceSourceError,
    );
  });
});
