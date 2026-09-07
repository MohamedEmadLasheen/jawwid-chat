import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** What happens when an account reaches its device limit (SessionService). */
export type DeviceLimitPolicy = 'revoke_oldest' | 'reject_new';

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

  // --- Messaging lifecycle (Phase 2) -----------------------------------------
  /** initial hypothesis - how long an author may edit their own message */
  'communication.edit_window_minutes': 15,
  /** hard cap on search results per request */
  'communication.search_page_size_max': 50,
  /** initial hypothesis - conversations one forward may target */
  'communication.forward_max_targets': 5,
  /** matches the mobile composer's cap, so client and server agree */
  'communication.message_max_length': 4000,
  /** initial hypothesis - LiveKit room token lifetime, short by design */
  'call.token_ttl_seconds': 120,
  /** initial hypothesis - unanswered call becomes a missed call */
  'call.ring_timeout_seconds': 45,
  /** initial hypothesis - notification delivery retry budget */
  'notification.max_attempts': 5,

  // --- Authentication and sessions (Phase 1) ---------------------------------
  // ONE source of truth for session policy. Nothing in the auth code may
  // hardcode these numbers, and changing the device limit is a config change,
  // not a deploy.
  /** initial hypothesis - maximum concurrent active sessions (devices) per account */
  'auth.max_active_devices': 5,
  /** revoke_oldest | reject_new -- what happens when the device limit is reached */
  'auth.device_limit_policy': 'revoke_oldest' as DeviceLimitPolicy,
  'auth.access_token_ttl_seconds': 900,
  'auth.refresh_token_ttl_seconds': 2592000,
  'auth.reset_token_ttl_seconds': 3600,
  'auth.verification_token_ttl_seconds': 86400,
  'auth.max_failed_attempts': 10,
  'auth.lockout_seconds': 900,
  'auth.min_password_length': 12,

  // --- Authentication abuse protection (Phase 1 closure) --------------------
  // Two axes: per SOURCE (bounds one address) and per TARGET (bounds attempts
  // against one subject from anywhere, which address rotation cannot avoid).
  // See docs/security/AUTH-THROTTLING.md for what this does and does not cover.
  'auth.throttle.window_seconds': 900,
  'auth.throttle.block_seconds': 900,
  'auth.throttle.login_per_ip': 30,
  'auth.throttle.login_per_subject': 10,
  'auth.throttle.reset_request_per_ip': 10,
  'auth.throttle.reset_request_per_subject': 5,
  'auth.throttle.reset_redeem_per_ip': 10,
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
