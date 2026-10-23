import { Injectable, Logger } from '@nestjs/common';
import type { FamilyInstalment } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { ReminderService } from '../communication/notifications/reminder.service';
import { formatMajor } from './money';
import { day } from './validate';

/** chat.notification_rule.event_type of the seeded payment rules (20260905093100). */
export const PAYMENT_DUE_EVENT = 'payment_due';
/** Rules are offset from 09:00 in the academy's day, not from midnight UTC. */
const ANCHOR_HOUR_UTC = 6;
const SWEEP_BATCH = 500;

/**
 * PD-27: payment reminders, before and after an instalment's due date.
 *
 * The schedule is DATA -- the rules seeded in 2026-09 (payment_d7, d3, d0, p3,
 * p7; event `payment_due`, template `payment_reminder`, role parent), switched
 * on and off in Payments > Settings. Each open instalment schedules them for
 * every active parent of its family, deduplicated per (rule, instalment,
 * parent), so scheduling again -- at creation, and by the worker's sweep, which
 * also reaches a parent added later -- converges on one notification each. A
 * moment already past is skipped: a plan created today does not fire last
 * week's reminder at once. A full payment or a void cancels the rest.
 */
@Injectable()
export class PaymentReminders {
  private readonly log = new Logger(PaymentReminders.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: ReminderService,
  ) {}

  async scheduleFor(instalments: FamilyInstalment[]): Promise<number> {
    let count = 0;
    const byFamily = new Map<string, FamilyInstalment[]>();
    for (const i of instalments) {
      if (i.paidOn || i.voidedAt) continue;
      byFamily.set(i.familyId, [...(byFamily.get(i.familyId) ?? []), i]);
    }
    for (const [familyId, rows] of byFamily) {
      const family = await this.prisma.family.findUnique({ where: { id: familyId }, select: { language: true } });
      const locale = family?.language === 'en' ? 'en' : 'ar';
      const parents = await this.prisma.contact.findMany({ where: { familyId, isActive: true }, select: { id: true } });
      if (parents.length === 0) continue;
      for (const i of rows) {
        count += await this.reminders.scheduleForEvent(PAYMENT_DUE_EVENT, {
          subjectId: i.id,
          anchorAt: new Date(`${day(i.dueDate)}T${String(ANCHOR_HOUR_UTC).padStart(2, '0')}:00:00Z`),
          recipients: parents.map((p) => ({ actorId: p.id, role: 'parent', locale })),
          familyId,
          variables: {
            amount: formatMajor(Number(i.amountMinor), i.currency),
            currency: i.currency,
            due_date: day(i.dueDate),
          },
          skipPast: true,
        });
      }
    }
    return count;
  }

  async cancelFor(instalmentId: string): Promise<void> {
    await this.reminders.cancelForSubject(instalmentId);
  }

  /** The worker's pass: every open instalment due in the window the rules can still reach. */
  async sweep(now = new Date()): Promise<number> {
    const from = new Date(now.getTime() - 8 * 86_400_000);
    const to = new Date(now.getTime() + 8 * 86_400_000);
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.familyInstalment.findMany({
        where: { paidOn: null, voidedAt: null, dueDate: { gte: from, lte: to } },
        orderBy: { id: 'asc' },
        take: SWEEP_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      total += await this.scheduleFor(rows);
      cursor = rows[rows.length - 1]?.id;
      if (rows.length < SWEEP_BATCH) break;
    }
    if (total > 0) this.log.debug(`payment reminders: ${total} scheduled or already present`);
    return total;
  }
}
