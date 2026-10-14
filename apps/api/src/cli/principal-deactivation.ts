import type { PrismaClient } from '@prisma/client';

/**
 * RT-032 -- take an account, contact, staff member or teacher out of service,
 * and report success only once the deactivation is COMPLETE.
 *
 * ## Two steps, and why the caller waits for the second
 *
 * 1. `chat.deactivate_principal()` commits the deactivation. The same
 *    transaction writes a `chat.principal_revocation` row (an ENABLE ALWAYS
 *    trigger does this for EVERY writer, not only this one).
 * 2. An API node runs the realtime completion barrier for that row and stamps
 *    `confirmed_at`. Until then a realtime event decided before the commit can
 *    still be in flight on some node; after it, none can.
 *
 * A database statement cannot wait for step 2 -- the barrier must start after
 * the commit -- so this procedure does: it polls the row and answers
 * `confirmed: true` only once the stamp exists. Running out of time is
 * `confirmed: false` ("saved, not yet complete"), never a success. Re-running it
 * is safe: the operation is idempotent and hands back the same revocation.
 */

export const PRINCIPAL_KINDS = ['account', 'contact', 'staff', 'teacher'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export interface DeactivationInput {
  readonly kind: PrincipalKind;
  readonly principalId: string;
  readonly reason: string;
  /** Who asked (a staff or account id). Recorded on the journal row; informational. */
  readonly requestedBy?: string | null;
  /** 'suspended' is an account-only alternative to 'deactivated'. */
  readonly status?: 'deactivated' | 'suspended';
}

export interface DeactivationResult {
  readonly revocationId: string;
  readonly confirmed: boolean;
  readonly confirmedAt: string | null;
  /** The last reason a barrier did not confirm, when there was one. */
  readonly lastError: string | null;
}

export class DeactivationRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DeactivationRefusal';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateDeactivationInput(input: DeactivationInput): void {
  if (!PRINCIPAL_KINDS.includes(input.kind)) {
    throw new DeactivationRefusal('USAGE', `kind must be one of ${PRINCIPAL_KINDS.join(', ')}`);
  }
  if (!UUID.test(input.principalId)) throw new DeactivationRefusal('USAGE', 'the principal id is not a uuid');
  if (input.requestedBy && !UUID.test(input.requestedBy)) {
    throw new DeactivationRefusal('USAGE', 'requested-by is not a uuid');
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new DeactivationRefusal('USAGE', 'a reason is required');
  }
  if (input.status === 'suspended' && input.kind !== 'account') {
    throw new DeactivationRefusal('USAGE', 'only an account can be suspended');
  }
}

/** Step 1: commit (idempotent). Returns the revocation whose confirmation completes it. */
export async function commitDeactivation(prisma: PrismaClient, input: DeactivationInput): Promise<string> {
  validateDeactivationInput(input);
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT chat.deactivate_principal(
        ${input.kind}, ${input.principalId}::uuid, ${input.reason},
        ${input.requestedBy ?? null}::uuid, ${input.status ?? 'deactivated'})::text AS id`;
    return rows[0].id;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/does not exist/.test(message)) throw new DeactivationRefusal('NOT_FOUND', message);
    if (/still the primary owner/.test(message)) throw new DeactivationRefusal('OWNS_FAMILIES', message);
    if (/RT-032|permission denied/.test(message)) throw new DeactivationRefusal('NOT_PERMITTED', message);
    throw e;
  }
}

/** Step 2: wait for an API node to confirm the barrier ran after the commit. */
export async function awaitConfirmation(
  prisma: PrismaClient,
  revocationId: string,
  opts: { timeoutMs: number; pollMs?: number },
): Promise<DeactivationResult> {
  const deadline = Date.now() + opts.timeoutMs;
  const pollMs = opts.pollMs ?? 250;
  for (;;) {
    const rows = await prisma.$queryRaw<{ confirmed_at: Date | null; last_error: string | null }[]>`
      SELECT confirmed_at, last_error FROM chat.principal_revocation WHERE id = ${revocationId}::uuid`;
    if (rows.length === 0) throw new DeactivationRefusal('NOT_FOUND', `revocation ${revocationId} does not exist`);
    const { confirmed_at: confirmedAt, last_error: lastError } = rows[0];
    if (confirmedAt) {
      return { revocationId, confirmed: true, confirmedAt: confirmedAt.toISOString(), lastError: null };
    }
    if (Date.now() >= deadline) return { revocationId, confirmed: false, confirmedAt: null, lastError };
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}

export async function deactivatePrincipal(
  prisma: PrismaClient,
  input: DeactivationInput,
  opts: { timeoutMs: number; pollMs?: number },
): Promise<DeactivationResult> {
  const revocationId = await commitDeactivation(prisma, input);
  return awaitConfirmation(prisma, revocationId, opts);
}
