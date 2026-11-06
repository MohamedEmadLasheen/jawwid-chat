import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { currentRequestContext } from './request-context';

type Db = Pick<PrismaService | Prisma.TransactionClient, '$queryRaw'>;

/**
 * PD-57 WP-2 (closure plan 2026-11-06 §5, roadmap §6.2 "One helper"): who has
 * blocked whom, for every enforcement point -- messages, attachments, the chat
 * list, push and the Notification Center, realtime, calls and direct
 * conversations. Server-side (owner D-5): nothing here trusts a client.
 *
 * Read from chat.actor_block (no request role may read it; the API reads it as
 * the owner). Matched on actor ids: the blocker is a contact or a teacher, the
 * blocked a contact, teacher or staff member, and actor ids are uuids that are
 * never shared between those tables.
 *
 * Cached per HTTP request (RequestContext.blockedBy), so a page of messages
 * costs one read. Outside a request (the outbox worker, sockets) nothing is
 * cached. A block or an unblock forgets the blocker's entry at once
 * (forgetBlocks), so nothing is ever left stale -- across requests there is no
 * cache at all.
 */

/**
 * The message types a block hides (roadmap §6.2). `system` and `card` (lesson
 * cards, schedule, cancellations) are NEVER hidden: D-6 exception 2.
 */
export const BLOCK_HIDEABLE_MESSAGE_TYPES: ReadonlySet<string> = new Set(['text', 'image', 'video', 'voice', 'file']);

export function hideableByBlock(type: string | null | undefined): boolean {
  return !!type && BLOCK_HIDEABLE_MESSAGE_TYPES.has(type);
}

/**
 * A message filter: none of the messages these blocks hide (a blocked author's
 * hideable types). For counts -- the unread badge, the waiting push -- which must
 * give no signal of contact either. A message without an author always passes.
 */
export function notHiddenByBlock(blocked: ReadonlySet<string>): Prisma.MessageWhereInput {
  if (blocked.size === 0) return {};
  return {
    AND: [{ OR: [{ authorId: null }, { authorId: { notIn: [...blocked] } }, { type: { notIn: [...BLOCK_HIDEABLE_MESSAGE_TYPES] } }] }],
  };
}

/** The ids of everyone this viewer has blocked. Empty for staff (staff never block). */
export async function blockedBy(db: Db, viewerId: string): Promise<ReadonlySet<string>> {
  const cache = currentRequestContext();
  const hit = cache?.blockedBy?.get(viewerId);
  if (hit) return hit;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT blocked_id::text AS id FROM chat.actor_block WHERE blocker_id = ${viewerId}::uuid`;
  const set: ReadonlySet<string> = new Set(rows.map((r) => r.id));
  if (cache) (cache.blockedBy ??= new Map()).set(viewerId, set);
  return set;
}

/** Has `blockerId` blocked `blockedId`? */
export async function hasBlocked(db: Db, blockerId: string, blockedId: string | null | undefined): Promise<boolean> {
  if (!blockedId) return false;
  return (await blockedBy(db, blockerId)).has(blockedId);
}

/** Which of `candidates` have blocked `blockedId` (an audience filter: one query). */
export async function blockersAmong(db: Db, blockedId: string, candidates: readonly string[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT blocker_id::text AS id FROM chat.actor_block
     WHERE blocked_id = ${blockedId}::uuid AND blocker_id = ANY(${[...candidates]}::uuid[])`;
  return new Set(rows.map((r) => r.id));
}

/** Everyone who has blocked `blockedId`. */
export async function blockersOf(db: Db, blockedId: string): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT blocker_id::text AS id FROM chat.actor_block WHERE blocked_id = ${blockedId}::uuid`;
  return rows.map((r) => r.id);
}

/** After a block or an unblock: the request's cached answer for this blocker is dropped. */
export function forgetBlocks(blockerId: string): void {
  currentRequestContext()?.blockedBy?.delete(blockerId);
}

/** The same helper, injectable (roadmap §6.2's `BlockService.blockedBy(viewer)`). */
@Injectable()
export class BlockService {
  constructor(private readonly prisma: PrismaService) {}

  blockedBy(viewerId: string): Promise<ReadonlySet<string>> {
    return blockedBy(this.prisma, viewerId);
  }

  hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    return hasBlocked(this.prisma, blockerId, blockedId);
  }
}
