import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

/**
 * W63: the operational kill switch for card payments (chat.config, global).
 *
 * `true` pauses card payments: every `cardAvailable` (the app's /me/billing,
 * the /pay page, Admin's settings and a family's billing) says false and
 * CheckoutService.open() refuses with PAYMENTS_UNAVAILABLE, so parents fall
 * back to bank transfer. Webhooks, the reconciler and refunds are NOT paused:
 * a payment already made (or in flight on Stripe's page) and its refunds and
 * disputes are still recorded.
 *
 * Absent or `false`: not paused (the default). Anything else is malformed and
 * FAILS SAFE to paused, with an error logged: card is a convenience (bank
 * transfer always remains), and a switch someone meant to turn on must never
 * read as off. Set only by the super admin or the Operations Manager, through
 * POST /billing/settings `{ cardPaused }`, audited as `billing.card_pause_set`.
 */
export const CARD_PAUSED_KEY = 'billing.card_paused';

const log = new Logger('CardPause');

/** The stored value -> paused? (`malformed`: neither absent nor a boolean). */
export function parseCardPaused(row: { value: unknown } | null | undefined): { paused: boolean; malformed: boolean } {
  if (!row) return { paused: false, malformed: false };
  if (typeof row.value === 'boolean') return { paused: row.value, malformed: false };
  return { paused: true, malformed: true };
}

/** Read now, never cached: a pause takes effect on the next request. */
export async function isCardPaused(db: Pick<PrismaClient, 'config'>): Promise<boolean> {
  const { paused, malformed } = parseCardPaused(await db.config.findUnique({ where: { key: CARD_PAUSED_KEY } }));
  if (malformed) log.error(`${CARD_PAUSED_KEY} is not true or false; card payments are treated as PAUSED until it is set again`);
  return paused;
}
