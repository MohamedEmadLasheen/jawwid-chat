import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import {
  NotificationCategory,
  NotificationDefinition,
  OPTIONAL_CATEGORIES,
} from '../contracts/notifications';

export interface CategoryPreference {
  category: string;
  /** False for approvals and account: the UI renders these as locked. */
  isOptional: boolean;
  pushEnabled: boolean;
  displayOrder: number;
}

/**
 * Notification preferences.
 *
 * TWO RULES, and they are the whole design:
 *
 *   1. IN-APP IS NEVER DISABLEABLE. The notification centre is the record of
 *      what happened to a family. A setting that erases that record is a defect
 *      dressed as a feature -- a parent who muted "class reminders" six months
 *      ago must still be able to find the cancellation they were sent.
 *      Preferences therefore control PUSH only.
 *
 *   2. AN ESSENTIAL NOTIFICATION IGNORES PREFERENCES. A cancelled class reaches
 *      a parent who muted class reminders. `essential` is a property of the
 *      TYPE in the registry, not of the category, precisely so that "remind me
 *      before class" and "the class is cancelled" can live in one category and
 *      still be mutable and unmutable respectively.
 *
 * The database enforces rule 2's boundary independently: a trigger on
 * chat.notification_preference refuses a row that mutes a non-optional
 * category, so a client cannot achieve through the API what the product
 * forbids.
 */
@Injectable()
export class PreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * May a push be sent for this notification?
   *
   * Absence of a preference row means enabled. Opting out is an act; nobody is
   * opted out by default, and a fresh account receives everything.
   */
  async allowsPush(actorId: string, def: NotificationDefinition): Promise<boolean> {
    if (def.essential) return true;

    const pref = await this.prisma.notificationPreference.findUnique({
      where: { actorId_category: { actorId, category: def.category } },
      select: { pushEnabled: true },
    });
    return pref?.pushEnabled ?? true;
  }

  /** The settings screen: every category, with the ones that cannot be muted marked. */
  async list(actorId: string): Promise<CategoryPreference[]> {
    const [categories, prefs] = await Promise.all([
      this.prisma.notificationCategoryRow.findMany({ orderBy: { displayOrder: 'asc' } }),
      this.prisma.notificationPreference.findMany({ where: { actorId } }),
    ]);

    const byCategory = new Map(prefs.map((p) => [p.category, p.pushEnabled]));

    return categories.map((c) => ({
      category: c.key,
      isOptional: c.isOptional,
      pushEnabled: c.isOptional ? (byCategory.get(c.key) ?? true) : true,
      displayOrder: c.displayOrder,
    }));
  }

  /**
   * Idempotent. Setting the same value twice is a no-op, which matters because
   * a settings toggle is exactly the control a flaky connection makes a client
   * retry.
   */
  async set(actorId: string, category: string, pushEnabled: boolean): Promise<void> {
    const row = await this.prisma.notificationCategoryRow.findUnique({
      where: { key: category },
    });
    if (!row) {
      throw new CommError(
        CommErrorCode.UNKNOWN_ACTOR,
        `unknown notification category: ${category}`,
        400,
      );
    }

    // Refused here as well as by the database trigger. The trigger is the
    // backstop; this is the one that produces an error a client can render.
    if (!pushEnabled && !row.isOptional) {
      throw new CommError(
        CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
        `notification category ${category} is essential and cannot be muted`,
        400,
      );
    }

    await this.prisma.notificationPreference.upsert({
      where: { actorId_category: { actorId, category } },
      create: { actorId, category, pushEnabled },
      update: { pushEnabled },
    });
  }

  /**
   * Static mirror of chat.notification_category.is_optional, for the paths that
   * must decide without a query (the registry's own consistency test).
   */
  static isOptional(category: NotificationCategory): boolean {
    return OPTIONAL_CATEGORIES.has(category);
  }
}
