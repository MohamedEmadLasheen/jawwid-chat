import type { Prisma } from '@prisma/client';
import { CommEvent, type FamilyFeedbackNoticePayload } from '../communication/contracts/events';
import type { OutboxService } from '../communication/outbox/outbox.service';

/**
 * PD-32 amendment (owner, 2026-11-03): tell the parent who filed a feedback
 * item that the administration answered it -- the first reply, an app
 * complaint going into review, its resolution.
 *
 * Written into the outbox INSIDE the transaction that made the change, so the
 * notice exists exactly when the change committed; OutboxWorker delivers it
 * through the PD-34 pipeline afterwards. A delivery that fails is retried
 * there and never undoes the reply. Ids only: never the words or the reply.
 * The pipeline's dedupe key (kind, item, parent) makes a repeated notice --
 * two staff racing to the first reply, a retried event -- one notification.
 */
export async function tellParent(
  tx: Prisma.TransactionClient,
  outbox: OutboxService,
  feedback: { id: string; contactId: string; organizationId: string },
  notice: FamilyFeedbackNoticePayload['notice'],
): Promise<void> {
  await outbox.enqueue(tx, CommEvent.FAMILY_FEEDBACK_NOTICE, {
    organizationId: feedback.organizationId,
    feedbackId: feedback.id,
    contactId: feedback.contactId,
    notice,
  });
}
