import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { ACADEMY_ZONE } from '../../platform/time-zone';

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

    // PD-22: the person's own zone (from their phone) decides when their night
    // is; quiet_hours.timezone is only the fallback for someone who never
    // opened the app.
    const own = await this.prisma.actorTimeZone.findUnique({ where: { actorId: recipientId }, select: { timeZone: true } });
    const localMinutes = QuietHoursService.minutesInZone(scheduledAt, own?.timeZone ?? settings.timezone);
    if (!QuietHoursService.isQuiet(localMinutes, settings.startMinute, settings.endMinute)) {
      return scheduledAt;
    }

    // Defer to the end of the quiet window.
    let delta = settings.endMinute - localMinutes;
    if (delta <= 0) delta += 24 * 60;
    return new Date(scheduledAt.getTime() + delta * 60_000);
  }

  /**
   * PD-34: as `adjust`, but someone with no row of their own gets the academy
   * default (chat.config notification.quiet_hours.default_*) instead of none.
   * Used by the notification pipeline only; `adjust` -- and so every caller of
   * NotificationService.schedule -- is unchanged.
   */
  async adjustWithDefault(
    recipientId: string,
    scheduledAt: Date,
    respect: boolean,
    fallback: { enabled: boolean; startMinute: number; endMinute: number },
  ): Promise<Date> {
    if (!respect) return scheduledAt;
    const own = await this.prisma.quietHours.findUnique({ where: { actorId: recipientId } });
    const window = own ?? fallback;
    if (!window.enabled) return scheduledAt;
    const zone = await this.prisma.actorTimeZone.findUnique({ where: { actorId: recipientId }, select: { timeZone: true } });
    const localMinutes = QuietHoursService.minutesInZone(scheduledAt, zone?.timeZone ?? own?.timezone ?? ACADEMY_ZONE);
    if (!QuietHoursService.isQuiet(localMinutes, window.startMinute, window.endMinute)) return scheduledAt;
    let delta = window.endMinute - localMinutes;
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
