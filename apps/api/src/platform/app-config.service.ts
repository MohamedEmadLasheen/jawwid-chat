import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Brief section 1: "All thresholds/weights/windows live in a config table."
 * Brief section 12: "Every number in this brief is treated as a config default
 * with a comment 'initial hypothesis'."
 *
 * Nothing in the communication engine may hardcode one of these numbers.
 */
export const COMMUNICATION_CONFIG_DEFAULTS = {
  /** initial hypothesis - window in which a sender may delete for everyone */
  'communication.delete_for_everyone_window_minutes': 60,
  /** initial hypothesis - brief section 4 handoff.grace_minutes */
  'handoff.grace_minutes': 15,
  /** initial hypothesis - brief section 9 "batch wait ~60s" */
  'automation.ack_batch_seconds': 60,
  /** initial hypothesis - brief section 9 no-reply reminders [24h, 72h] */
  'automation.no_reply_reminder_hours': [24, 72],
  /** initial hypothesis - brief section 9 operational auto-resolve after 168h */
  'automation.auto_resolve_hours': 168,
  /** initial hypothesis - brief section 9 reopen.window_hours */
  'automation.reopen_window_hours': 72,
  /** initial hypothesis - typing indicator TTL in Redis */
  'realtime.typing_ttl_seconds': 8,
  /** initial hypothesis - presence heartbeat TTL in Redis */
  'realtime.presence_ttl_seconds': 45,
  /** initial hypothesis - max messages returned per page */
  'communication.page_size_max': 100,
  'communication.page_size_default': 50,
  /** initial hypothesis - LiveKit room token lifetime, short by design */
  'call.token_ttl_seconds': 120,
  /** initial hypothesis - unanswered call becomes a missed call */
  'call.ring_timeout_seconds': 45,
  /** initial hypothesis - notification delivery retry budget */
  'notification.max_attempts': 5,
  /** per-channel delivery retry budget; bounds one push, not the notification */
  'notification.delivery_max_attempts': 5,
  /** initial hypothesis - messages from one sender inside this window collapse */
  'notification.group_window_seconds': 300,
  /** how long a READ notification stays in a parent's history */
  'notification.retention_days': 180,
  /** the per-channel delivery record outlives the notification, for support */
  'notification.delivery_retention_days': 400,
  /** the academy's record of what it told families, kept far longer */
  'notification.announcement_retention_days': 730,
} as const;

export type CommunicationConfigKey = keyof typeof COMMUNICATION_CONFIG_DEFAULTS;

@Injectable()
export class AppConfigService {
  private cache = new Map<string, { value: unknown; at: number }>();
  private readonly ttlMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<K extends CommunicationConfigKey>(
    key: K,
  ): Promise<(typeof COMMUNICATION_CONFIG_DEFAULTS)[K]> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) {
      return cached.value as (typeof COMMUNICATION_CONFIG_DEFAULTS)[K];
    }
    const row = await this.prisma.config.findUnique({ where: { key } });
    const value = (row?.value ?? COMMUNICATION_CONFIG_DEFAULTS[key]) as (typeof COMMUNICATION_CONFIG_DEFAULTS)[K];
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  /** Test/ops helper; invalidates the read-through cache. */
  invalidate(): void {
    this.cache.clear();
  }
}
