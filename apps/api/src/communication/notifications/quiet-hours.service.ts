import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';

/**
 * Quiet hours, per recipient, in their own timezone.
 *
 * A notification is never dropped for quiet hours - it is deferred to the end of
 * the window. Dropping would silently lose a class reminder.
 *
 * Exemptions are data, not code: a rule with respect_quiet_hours = false (calls,
 * the T-30m class reminder) bypasses this entirely. No additional quiet-hour
 * rules are invented here.
 */
@Injectable()
export class QuietHoursService {
  constructor(private readonly prisma: PrismaService) {}

  async adjust(recipientId: string, scheduledAt: Date, respect: boolean): Promise<Date> {
    if (!respect) return scheduledAt;

    const settings = await this.prisma.quietHours.findUnique({ where: { actorId: recipientId } });
    if (!settings || !settings.enabled) return scheduledAt;

    const localMinutes = QuietHoursService.minutesInZone(scheduledAt, settings.timezone);
    if (!QuietHoursService.isQuiet(localMinutes, settings.startMinute, settings.endMinute)) {
      return scheduledAt;
    }

    // Defer to the end of the quiet window.
    let delta = settings.endMinute - localMinutes;
    if (delta <= 0) delta += 24 * 60;
    return new Date(scheduledAt.getTime() + delta * 60_000);
  }

  /** Handles windows that wrap past midnight, e.g. 22:00 -> 08:00. */
  static isQuiet(minute: number, start: number, end: number): boolean {
    if (start === end) return false;
    if (start < end) return minute >= start && minute < end;
    return minute >= start || minute < end;
  }

  static minutesInZone(at: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  }
}
