/**
 * The push (lock-screen) template for a family notice scheduled straight on
 * NotificationService, outside the PD-34 pipeline's emit().
 *
 * The pipeline keeps names, amounts and free text off the lock screen: the push
 * renders a generic template, and only someone who turned lock-screen names on
 * gets the variant with details (NotificationPipeline.emit, `namedPush`). The
 * Notification Center entry is behind sign-in and keeps the details: it is
 * rendered from the catalog's in-app template (notification-catalog.ts) with
 * the same variables, whatever push template the delivery row names.
 *
 * Producers not on the pipeline (payment received / receipt rejected, PD-30's
 * subscription notices) choose their push template here, so the same rule holds
 * for them. Without a pipeline, or when the choice cannot be made, the push is
 * the generic one: privacy is the safe failure.
 */
import { Logger } from '@nestjs/common';

/** "Jawwid" / "You have a new notification." (chat.notification_template, PD-34). No variables. */
export const GENERIC_PUSH_TEMPLATE = 'inbox.generic';

/** The part of NotificationPipeline this needs: the recipient's lock-screen names setting. */
export interface LockScreenNames {
  showsNames(recipientId: string): Promise<boolean>;
}

const log = new Logger('LockScreenPush');

/**
 * `named`: the template with details, for someone who turned names on; null
 * when the text must never reach a lock screen (a staff member's free text).
 */
export async function lockScreenTemplate(
  names: LockScreenNames | undefined | null,
  recipientId: string,
  named: string | null,
): Promise<string> {
  if (!named || !names) return GENERIC_PUSH_TEMPLATE;
  try {
    return (await names.showsNames(recipientId)) ? named : GENERIC_PUSH_TEMPLATE;
  } catch (e) {
    log.warn(`lock-screen names setting not read; generic push: ${(e as Error).name}`);
    return GENERIC_PUSH_TEMPLATE;
  }
}
