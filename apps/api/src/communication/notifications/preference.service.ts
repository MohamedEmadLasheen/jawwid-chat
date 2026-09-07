import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';

/**
 * What a person is choosing when they turn something off.
 *
 * Coarse on purpose. The engine has fourteen notification rules; nobody
 * configures fourteen rules, and a settings screen that offered them would be
 * left at its defaults by everybody. The mapping from rule to category is a
 * COLUMN on `chat.notification_rule`, not a switch here, for the same reason
 * the schedules are rows: a category list in TypeScript would put half the
 * decision back into a deploy, and the two halves would drift the first time
 * somebody added a rule.
 */
export const NotificationCategory = {
  MESSAGES: 'messages',
  APPROVALS: 'approvals',
  CALLS: 'calls',
  PAYMENTS: 'payments',
  CLASSES: 'classes',
} as const;
export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

const ALL: NotificationCategory[] = Object.values(NotificationCategory);

/**
 * Per-recipient, per-category opt-out — enforced where notifications are
 * GENERATED.
 *
 * ## Why not on the client
 *
 * Because a preference the client applies is not a preference. The server has
 * already handed the payload to APNs or FCM by then; the phone has already
 * buzzed, the lock screen has already lit up, and the message text has already
 * left the building. Discarding it in the app afterwards changes what is
 * displayed and nothing that matters. §27 says this outright, and it is the
 * reason this class exists on the server side of the seam.
 *
 * ## The default is ON, and that is a decision
 *
 * A category with no row has never been chosen. It reads as enabled. The
 * alternative — treat absent as off, or as unknown — means everybody who has
 * never opened the settings screen silently receives nothing, which is the one
 * failure mode a notification system must not have. Losing a payment reminder
 * because a row was missing is worse than sending one somebody would have
 * turned off.
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The category this rule belongs to, or null when the notification is not
   * driven by a rule.
   *
   * Null means "uncategorised", and an uncategorised notification is SENT.
   * Suppressing something the system cannot classify would silently drop
   * whatever a future feature scheduled before it remembered to add a rule.
   */
  async categoryOf(ruleKey: string | null | undefined): Promise<NotificationCategory | null> {
    if (!ruleKey) return null;
    const rule = await this.prisma.notificationRule.findUnique({
      where: { key: ruleKey },
      select: { category: true },
    });
    return (rule?.category as NotificationCategory | undefined) ?? null;
  }

  /** Whether this recipient still wants this category. */
  async isEnabled(actorId: string, category: NotificationCategory | null): Promise<boolean> {
    if (category === null) return true;

    const row = await this.prisma.notificationPreference.findUnique({
      where: { actorId_category: { actorId, category } },
      select: { enabled: true },
    });
    return row?.enabled ?? true;
  }

  /**
   * Everything this person has decided, with the defaults filled in.
   *
   * Returns every category rather than only the rows that exist, so a settings
   * screen renders the same list whether or not anything has been chosen — and
   * so the client never has to know what the default is.
   */
  async forActor(actorId: string): Promise<Record<NotificationCategory, boolean>> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { actorId },
      select: { category: true, enabled: true },
    });
    const chosen = new Map(rows.map((r) => [r.category, r.enabled]));

    return Object.fromEntries(
      ALL.map((category) => [category, chosen.get(category) ?? true]),
    ) as Record<NotificationCategory, boolean>;
  }

  /**
   * Record a choice.
   *
   * Scoped to the caller's own actor id by the signature, and again by the
   * row-level policy on the table: a preference is one person's own setting and
   * nobody else's business — not a supervisor's, not an admin's.
   */
  async set(
    actorId: string,
    category: NotificationCategory,
    enabled: boolean,
  ): Promise<void> {
    if (!ALL.includes(category)) {
      throw new Error(`unknown notification category ${category}`);
    }
    await this.prisma.notificationPreference.upsert({
      where: { actorId_category: { actorId, category } },
      create: { actorId, category, enabled },
      update: { enabled, updatedAt: new Date() },
    });
  }
}
