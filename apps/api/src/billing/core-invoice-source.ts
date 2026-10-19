import { Logger } from '@nestjs/common';

/**
 * PD-12 S3 / PD-10: Jawwid Core's invoices, read at request time and NEVER
 * stored in Chat. This file is the whole boundary: the shape Chat needs, and
 * the one HTTP call that fetches it.
 *
 * THE CONTRACT IS CHAT'S REQUIREMENT, NOT YET CORE'S API. Core does not publish
 * an invoice read API today (PD-10 open item 2). docs/admin/pd012-s3.md states
 * what Chat asks for; when Core ships it, only this file changes.
 *
 *   POST {CORE_BASE_URL}/integration/chat/invoices/query
 *   Authorization: Bearer {CORE_API_KEY}
 *   { "parent_ids": ["<core_parent_id>", ...], "include_paid": false }
 *   ->
 *   { "invoices": [ { "id", "parent_id", "child_id" | null, "amount_minor",
 *                     "currency", "due_date": "YYYY-MM-DD",
 *                     "status": "open" | "paid" | "void",
 *                     "paid_at"?, "label"? } ] }
 *
 * Chat asks ONLY for the parents the viewer may see, and drops anything Core
 * returns for a parent it did not ask about: a Core bug can never widen a
 * supervisor's scope.
 */
export interface CoreInvoice {
  id: string;
  parentId: string;
  /** Set when Core invoiced one child (a child taking more subjects); null = a family invoice. */
  childId: string | null;
  amountMinor: number;
  currency: string;
  dueDate: string;
  status: 'open' | 'paid';
  paidAt: string | null;
  label: string | null;
}

export interface CoreInvoiceSource {
  /** false = Core's invoice API is not connected in this deployment; the page says so. */
  readonly connected: boolean;
  invoicesFor(parentIds: readonly string[], opts: { includePaid: boolean }): Promise<CoreInvoice[]>;
}

export const CORE_INVOICE_SOURCE = Symbol('CORE_INVOICE_SOURCE');

export class CoreInvoiceSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreInvoiceSourceError';
  }
}

/** No Core invoice API configured: nothing is fetched, and nothing is pretended. */
export const NOT_CONNECTED: CoreInvoiceSource = Object.freeze({
  connected: false,
  invoicesFor: async () => [],
});

const BATCH = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export class HttpCoreInvoiceSource implements CoreInvoiceSource {
  readonly connected = true;
  private readonly logger = new Logger(HttpCoreInvoiceSource.name);

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async invoicesFor(parentIds: readonly string[], opts: { includePaid: boolean }): Promise<CoreInvoice[]> {
    const out: CoreInvoice[] = [];
    for (let i = 0; i < parentIds.length; i += BATCH) {
      const batch = parentIds.slice(i, i + BATCH);
      out.push(...(await this.query(batch, opts.includePaid)));
    }
    return out;
  }

  private async query(parentIds: readonly string[], includePaid: boolean): Promise<CoreInvoice[]> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/integration/chat/invoices/query`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ parent_ids: parentIds, include_paid: includePaid }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      this.logger.warn(`Core invoice API unreachable: ${e instanceof Error ? e.name : 'error'}`);
      throw new CoreInvoiceSourceError('Jawwid Core did not answer');
    }
    if (!response.ok) {
      this.logger.warn(`Core invoice API answered ${response.status}`);
      throw new CoreInvoiceSourceError(`Jawwid Core answered ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CoreInvoiceSourceError('Jawwid Core answered something that is not JSON');
    }
    return parseInvoices(body, new Set(parentIds.map((p) => p.toLowerCase())), includePaid);
  }
}

/**
 * Strict: a malformed invoice is dropped, not guessed at, and so is one for a
 * parent Chat did not ask about. A void invoice is not an instalment.
 */
export function parseInvoices(body: unknown, askedFor: ReadonlySet<string>, includePaid: boolean): CoreInvoice[] {
  const list = (body as { invoices?: unknown } | null)?.invoices;
  if (!Array.isArray(list)) throw new CoreInvoiceSourceError('Jawwid Core answered without an invoices list');
  const out: CoreInvoice[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const parentId = typeof r.parent_id === 'string' ? r.parent_id.toLowerCase() : '';
    if (!askedFor.has(parentId)) continue;
    const childId = r.child_id === null || r.child_id === undefined ? null : r.child_id;
    if (childId !== null && (typeof childId !== 'string' || !UUID_RE.test(childId))) continue;
    if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 200) continue;
    if (typeof r.amount_minor !== 'number' || !Number.isSafeInteger(r.amount_minor) || r.amount_minor < 0) continue;
    if (typeof r.currency !== 'string' || !CURRENCY_RE.test(r.currency)) continue;
    if (typeof r.due_date !== 'string' || !DATE_RE.test(r.due_date)) continue;
    if (r.status !== 'open' && r.status !== 'paid') continue;
    if (r.status === 'paid' && !includePaid) continue;
    out.push({
      id: r.id,
      parentId,
      childId: childId === null ? null : childId.toLowerCase(),
      amountMinor: r.amount_minor,
      currency: r.currency,
      dueDate: r.due_date,
      status: r.status,
      paidAt: r.status === 'paid' && typeof r.paid_at === 'string' ? r.paid_at : null,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 200) : null,
    });
  }
  return out;
}

/**
 * The source for this deployment. Connected only when explicitly switched on:
 * CORE_BASE_URL already has a placeholder in .env.example, and its presence
 * alone must not turn a developer's page into "Core is down".
 */
export function coreInvoiceSourceFromEnv(env: NodeJS.ProcessEnv = process.env): CoreInvoiceSource {
  if (env.CORE_INVOICES_ENABLED !== 'true') return NOT_CONNECTED;
  const base = env.CORE_BASE_URL?.trim();
  const key = env.CORE_API_KEY?.trim();
  if (!base || !key) return NOT_CONNECTED;
  const timeout = Number(env.CORE_TIMEOUT_MS ?? 5000);
  return new HttpCoreInvoiceSource(base, key, Number.isFinite(timeout) && timeout > 0 ? timeout : 5000);
}
