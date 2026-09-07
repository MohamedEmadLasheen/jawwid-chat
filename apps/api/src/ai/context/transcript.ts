import type { PrismaService } from '../../platform/prisma.service';
import { ActorKind, Moderation, Visibility } from '../../communication/contracts/vocab';

export interface Transcript {
  /** The rendered text handed to the model, already bounded. */
  readonly text: string;
  readonly messages: readonly RenderedMessage[];
  /** The family's most recent words, for knowledge retrieval. */
  readonly lastCustomerText: string | null;
  /** True when the middle of a long conversation was elided. */
  readonly truncated: boolean;
  readonly lastStaffAt: Date | null;
  readonly lastCustomerAt: Date | null;
}

interface RenderedMessage {
  readonly seq: string;
  readonly speaker: string;
  readonly text: string;
  readonly at: Date;
  readonly internal: boolean;
}

/** How many opening messages are always kept. See below. */
const OPENING_MESSAGES = 6;

/**
 * Builds the bounded context for one conversation (Phase 7 §30).
 *
 * ## Why this is not simply "the last N messages"
 *
 * §30 asks for a bounded window that nevertheless keeps the original problem,
 * promises already made and unresolved actions. A pure tail window loses
 * exactly those: in a long complaint thread the opening messages are where the
 * problem was stated, and a summary built only from the tail confidently
 * describes the argument about scheduling while missing that it started with a
 * refund request.
 *
 * So the window is the first few messages AND the last many, with the middle
 * marked as elided rather than silently dropped -- the model is told that
 * something is missing, which is the difference between a summary with a gap
 * and a summary that is wrong.
 *
 * ## What is excluded, and why
 *
 * - Deleted-for-everyone messages: withdrawn, and repeating them through an AI
 *   surface would undo the withdrawal.
 * - Messages held for approval: a moderator has not yet let them into the
 *   conversation, and the assistant must not be the path that reads them out.
 * - Internal staff notes, unless the caller asks. A suggested reply is drafted
 *   to be SENT to a family, so it must not be able to quote a staff-only note;
 *   a summary is read only by staff, and one that omitted what colleagues
 *   recorded would be answering "what was done" with half the story.
 */
export async function buildTranscript(
  prisma: PrismaService,
  conversationId: string,
  limit: number,
  options: { includeInternal?: boolean } = {},
): Promise<Transcript> {
  const includeInternal = options.includeInternal ?? false;

  const where = {
    conversationId,
    deletedForAll: false,
    moderation: Moderation.PUBLISHED,
    ...(includeInternal ? {} : { visibility: Visibility.CUSTOMER }),
  };

  const total = await prisma.message.count({ where });

  const tail = await prisma.message.findMany({
    where,
    orderBy: { seq: 'desc' },
    take: Math.max(1, limit),
  });
  tail.reverse();

  const truncated = total > tail.length;
  const opening = truncated
    ? await prisma.message.findMany({
        where,
        orderBy: { seq: 'asc' },
        take: OPENING_MESSAGES,
      })
    : [];

  // De-duplicate: on a conversation only slightly longer than the window, the
  // opening messages are already in the tail.
  const tailSeqs = new Set(tail.map((m) => String(m.seq)));
  const head = opening.filter((m) => !tailSeqs.has(String(m.seq)));

  const render = (m: (typeof tail)[number]): RenderedMessage => ({
    seq: String(m.seq ?? 0),
    speaker: speakerOf(m.authorType, m.visibility),
    text: m.body?.trim() || `(${m.type})`,
    at: m.createdAt,
    internal: m.visibility !== Visibility.CUSTOMER,
  });

  const messages = [...head.map(render), ...tail.map(render)];

  const lines: string[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (head.length && i === head.length) {
      lines.push(`... [${total - messages.length} earlier messages are not shown] ...`);
    }
    const m = messages[i];
    lines.push(`[${m.at.toISOString()}] ${m.speaker}: ${m.text}`);
  }

  const customers = messages.filter((m) => m.speaker === 'Parent');
  const staff = messages.filter((m) => m.speaker !== 'Parent');

  return {
    text: lines.join('\n'),
    messages,
    lastCustomerText: customers.length ? customers[customers.length - 1].text : null,
    truncated,
    lastStaffAt: staff.length ? staff[staff.length - 1].at : null,
    lastCustomerAt: customers.length ? customers[customers.length - 1].at : null,
  };
}

/**
 * A ROLE, never a name.
 *
 * Phase 7 §31 asks that only the minimum context leaves this system. The model
 * does not need to know that the parent is Fatma to draft "we are sorry about
 * the delay", and a transcript full of real names is a transcript that has
 * exported the family register to a third party one summary at a time.
 */
function speakerOf(authorType: string, visibility: string): string {
  if (authorType === ActorKind.CONTACT) return 'Parent';
  if (authorType === ActorKind.TEACHER) return 'Teacher';
  if (authorType === ActorKind.SYSTEM) return 'System';
  return visibility === Visibility.CUSTOMER ? 'Staff' : 'Staff (internal note)';
}
