import type { PrismaService } from '../platform/prisma.service';

/**
 * PD-26 amendment (review of #175, P2-4): the family a complaint is about, so the
 * Teacher Supervision page can show an Operations supervisor only their own
 * families'. Here, not in platform/: parent feedback is read only by
 * src/teacher-file (PD-32, parent-feedback-confinement.spec).
 *
 * The parent's own feedback (PD-32's app complaint), else the family
 * conversation it was taken from. Null -- a teacher-level complaint -- when it
 * has neither (management's).
 */
export async function familiesOfComplaints(
  prisma: PrismaService,
  entries: ReadonlyArray<{ id: string; parentFeedbackId: string | null; conversationId: string | null }>,
): Promise<Map<string, string | null>> {
  const feedbackIds = entries.map((e) => e.parentFeedbackId).filter((x): x is string => !!x);
  const conversationIds = entries.map((e) => e.conversationId).filter((x): x is string => !!x);
  const [feedback, conversations] = await Promise.all([
    feedbackIds.length ? prisma.parentFeedback.findMany({ where: { id: { in: feedbackIds } }, select: { id: true, familyId: true } }) : [],
    conversationIds.length ? prisma.conversation.findMany({ where: { id: { in: conversationIds } }, select: { id: true, familyId: true } }) : [],
  ]);
  const ofFeedback = new Map(feedback.map((f) => [f.id, f.familyId]));
  const ofConversation = new Map(conversations.map((c) => [c.id, c.familyId]));
  return new Map(
    entries.map((e) => [
      e.id,
      (e.parentFeedbackId ? ofFeedback.get(e.parentFeedbackId) : undefined) ??
        (e.conversationId ? ofConversation.get(e.conversationId) : undefined) ??
        null,
    ]),
  );
}

/** The family a conversation is with; null for any other conversation. */
export async function familyOfConversation(prisma: PrismaService, conversationId: string): Promise<string | null> {
  const row = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { familyId: true } });
  return row?.familyId ?? null;
}
