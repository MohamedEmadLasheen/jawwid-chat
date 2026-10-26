import type { PrismaService } from '../../platform/prisma.service';

type Db = Pick<PrismaService, '$queryRaw'>;

/**
 * WHO HEARS A PUBLISHED MESSAGE (a push and, with PD-34, a Notification Center
 * entry). The single source of that answer, used when the message is fanned
 * out (OutboxWorker.notifyNewMessage) AND again just before a deferred push is
 * sent (NotificationPipeline.guardDueMessages), so the two can never disagree.
 *
 *   - every live member, except member rows a seat opened (PD-35: a seat is
 *     presence, never charge);
 *   - plus each open seat's holder, but only while
 *     chat.staff_conversation_access still holds for them (PD-35 P2-3);
 *   - never the author;
 *   - an away supervisor is replaced by the backup covering for them, once
 *     per person (PD-33).
 */
export async function messageAudience(db: Db, conversationId: string, authorId: string | null): Promise<string[]> {
  const live = await db.$queryRaw<Array<{ actor_id: string; seat_row: boolean }>>`
    SELECT cm.actor_id::text AS actor_id,
           EXISTS (SELECT 1 FROM chat.conversation_seat st WHERE st.member_id = cm.id AND st.left_at IS NULL) AS seat_row
      FROM chat.conversation_member cm
     WHERE cm.conversation_id = ${conversationId}::uuid AND cm.left_at IS NULL`;
  const seats = await db.$queryRaw<Array<{ staff_id: string }>>`
    SELECT st.staff_id::text AS staff_id
      FROM chat.conversation_seat st
     WHERE st.conversation_id = ${conversationId}::uuid AND st.left_at IS NULL
       AND chat.staff_conversation_access(st.staff_id, st.conversation_id, now()) IS NOT NULL`;
  const reachable = [...live.filter((m) => !m.seat_row).map((m) => m.actor_id), ...seats.map((s) => s.staff_id)];
  // The author first: their own seat is never pushed -- nor remapped, so an
  // away supervisor's own message does not push the backup covering for them.
  const recipients = [...new Set(reachable)].filter((id) => id !== authorId);
  if (recipients.length === 0) return [];
  const covers = await db.$queryRaw<Array<{ primary_id: string; backup_id: string }>>`
    SELECT primary_id::text AS primary_id, backup_id::text AS backup_id
      FROM chat.live_covers(now())
     WHERE primary_id = ANY(${recipients}::uuid[])`;
  const cover = new Map(covers.map((r) => [r.primary_id, r.backup_id]));
  return [...new Set(recipients.map((id) => cover.get(id) ?? id))];
}
