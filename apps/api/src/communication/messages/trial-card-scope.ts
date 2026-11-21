import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../platform/prisma.service';
import type { Actor } from '../../platform/types';
import { CardKind } from '../contracts/vocab';
import { salesRepScopeOf, salesRepsAmong } from '../../lessons/sales-rep-scope';

type Db = Pick<PrismaService, '$queryRaw'>;

/** Every card kind posted into a teacher's trial group (PD-11 T4). */
export const TRIAL_CARD_KINDS: string[] = Object.entries(CardKind)
  .filter(([name]) => name.startsWith('TRIAL_'))
  .map(([, kind]) => kind as string);

/**
 * PD-59 / F7 (owner, 2026-11-21): a Sales REPRESENTATIVE reads a trial card only while the prospect it is
 * about is assigned to them. A card names its trial (`payload.trialId`); the trial's prospect carries the
 * CURRENT owner (`trial_prospect.owner_staff_id`), so a reassignment moves a card's visibility with the
 * lead, and a card whose prospect has no owner is hidden from every representative. The Sales manager,
 * the super admin, Operations, the Teachers department and the trial's own teacher are unaffected.
 *
 * Returns a Prisma `where` fragment to AND into a message query, or null when the viewer is not a
 * representative (no restriction). The fragment keeps every non-trial message and the viewer's own trial
 * cards; it is the one rule behind the message page, pins, stars, search, export, a list row's preview
 * and the unread counts.
 */
export async function trialCardScopeWhere(
  prisma: Db,
  actor: Actor,
  conversationIds?: readonly string[],
): Promise<Prisma.MessageWhereInput | null> {
  const rep = await salesRepScopeOf(prisma, actor);
  if (!rep) return null;
  const owned = await ownedTrialCardMessageIds(prisma, rep, conversationIds);
  return { OR: [{ card: { is: null } }, { card: { is: { kind: { notIn: TRIAL_CARD_KINDS } } } }, { id: { in: owned } }] };
}

/** The messages that are trial cards about a prospect `staffId` owns now. */
async function ownedTrialCardMessageIds(db: Db, staffId: string, conversationIds?: readonly string[]): Promise<string[]> {
  const scoped = conversationIds ? [...conversationIds] : null;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT mc.message_id::text AS id
      FROM chat.message_card mc
      JOIN chat.message m ON m.id = mc.message_id
     WHERE mc.kind = ANY(${TRIAL_CARD_KINDS}::text[])
       AND (${scoped}::uuid[] IS NULL OR m.conversation_id = ANY(${scoped}::uuid[]))
       AND EXISTS (
             SELECT 1
               FROM chat.lesson l
               JOIN chat.trial_prospect p ON p.id = l.prospect_id
              WHERE l.id::text = mc.payload->>'trialId'
                AND p.owner_staff_id = ${staffId}::uuid)`;
  return rows.map((r) => r.id);
}

/**
 * Of a message's would-be audience, the Sales representatives who may NOT read it, when it is a trial card
 * (for any other message: nobody). Used by the push / Notification Center fan-out and the realtime event,
 * so a hidden card is neither notified nor signalled. `audience` null: every staff member of the organization
 * (a realtime room also holds readers who are not members).
 */
export async function trialCardHiddenFrom(
  db: Db,
  messageId: string,
  audience: readonly string[] | null,
): Promise<Set<string>> {
  if (audience && audience.length === 0) return new Set();
  const [card] = await db.$queryRaw<Array<{ trial_id: string | null; organization_id: string }>>`
    SELECT mc.payload->>'trialId' AS trial_id, mc.organization_id::text AS organization_id
      FROM chat.message_card mc
     WHERE mc.message_id = ${messageId}::uuid AND mc.kind = ANY(${TRIAL_CARD_KINDS}::text[])`;
  if (!card) return new Set();
  const reps = await salesRepsAmong(db, card.organization_id, audience);
  if (reps.size === 0) return new Set();
  const [owner] = card.trial_id
    ? await db.$queryRaw<Array<{ owner: string | null }>>`
        SELECT p.owner_staff_id::text AS owner
          FROM chat.lesson l JOIN chat.trial_prospect p ON p.id = l.prospect_id
         WHERE l.id::text = ${card.trial_id}`
    : [];
  return new Set([...reps].filter((id) => id !== (owner?.owner ?? null)));
}
