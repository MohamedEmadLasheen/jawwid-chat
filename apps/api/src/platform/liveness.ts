import type { PrismaClient } from '@prisma/client';

/**
 * RT-032 / RT-037. Whether an actor id is LIVE right now, as identity
 * resolution and authentication read it: the principal (contact; staff /
 * teacher not left) and, when it has one, its login account. Unknown ids are
 * not live. One query, read at the moment of use -- never a cached verdict.
 *
 * The one definition used wherever an out-of-band channel (push dispatch, the
 * media webhook, the media download route) must decide whether a credential
 * issued earlier may still be honoured.
 */
export async function actorIsLive(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  actorId: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)) return false;
  const rows = await prisma.$queryRaw<{ live: boolean | null }[]>`
    SELECT bool_or(live) AS live FROM (
      SELECT c.is_active AND coalesce(a.is_active AND a.status = 'active', true) AS live
        FROM chat.contact c LEFT JOIN chat.account a ON a.id = c.account_id WHERE c.id = ${actorId}::uuid
      UNION ALL
      SELECT s.is_active AND s.left_at IS NULL AND coalesce(a.is_active AND a.status = 'active', true)
        FROM chat.staff s LEFT JOIN chat.account a ON a.id = s.account_id WHERE s.id = ${actorId}::uuid
      UNION ALL
      SELECT t.is_active AND t.left_at IS NULL AND coalesce(a.is_active AND a.status = 'active', true)
        FROM chat.teacher t LEFT JOIN chat.account a ON a.id = t.account_id WHERE t.id = ${actorId}::uuid
    ) x`;
  return rows[0]?.live === true;
}
