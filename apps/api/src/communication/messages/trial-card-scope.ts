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
 * about is assigned to them. A card names its trial (`payload.trialId`, surfaced as the generated column
 * `message_card.trial_id`); the trial's prospect carries the CURRENT owner (`trial_prospect.owner_staff_id`),
 * so a reassignment moves a card's visibility with the lead. Fail closed: a card with no (or an invalid)
 * trialId, a trial with no prospect, or a prospect with no owner is hidden from every representative. The
 * Sales manager, the super admin, Operations, the Teachers department and the trial's own teacher are
 * unaffected.
 *
 * Returns a Prisma `where` fragment to AND into a message query, or null when the viewer is not a
 * representative (no restriction). It is ONE in-database relation predicate (card -> lesson -> prospect, all
 * primary-key joins): nothing is shipped from the application, so it does not grow with the number of cards.
 * It keeps every non-trial message and the viewer's own trial cards, and is the rule behind the message
 * page, pins, stars, search, export, a list row's preview and the unread counts.
 */
export async function trialCardScopeWhere(prisma: Db, actor: Actor): Promise<Prisma.MessageWhereInput | null> {
  const rep = await salesRepScopeOf(prisma, actor);
  if (!rep) return null;
  return {
    OR: [
      { card: { is: null } },
      { card: { is: { kind: { notIn: TRIAL_CARD_KINDS } } } },
      { card: { is: { trialLesson: { is: { prospect: { is: { ownerStaffId: rep } } } } } } },
    ],
  };
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
    SELECT mc.trial_id::text AS trial_id, mc.organization_id::text AS organization_id
      FROM chat.message_card mc
     WHERE mc.message_id = ${messageId}::uuid AND mc.kind = ANY(${TRIAL_CARD_KINDS}::text[])`;
  if (!card) return new Set();
  const reps = await salesRepsAmong(db, card.organization_id, audience);
  if (reps.size === 0) return new Set();
  const [owner] = card.trial_id
    ? await db.$queryRaw<Array<{ owner: string | null }>>`
        SELECT p.owner_staff_id::text AS owner
          FROM chat.lesson l JOIN chat.trial_prospect p ON p.id = l.prospect_id
         WHERE l.id = ${card.trial_id}::uuid`
    : [];
  return new Set([...reps].filter((id) => id !== (owner?.owner ?? null)));
}
