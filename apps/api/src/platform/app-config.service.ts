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
  /** initial hypothesis - window in which an author may edit a text message */
  'communication.edit_window_minutes': 15,
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
  /**
   * PD-34 defaults (owner questions open 2026-10-26; an answer changes these
   * values, not code). Quiet hours for someone who never set their own:
   * 22:00-08:00 in their own zone. Calls, the T-30/T-15 lesson reminders and
   * security are exempt by their rules (respect_quiet_hours = false).
   */
  'notification.quiet_hours.default_enabled': true,
  'notification.quiet_hours.default_start_minute': 1320,
  'notification.quiet_hours.default_end_minute': 480,
  /** PD-34: at most this many pushes an hour per person in a rate-limited category; the rest go to the Center only. */
  'notification.push_per_hour': 6,
  'notification.rate_limited_categories': ['conversation', 'announcement', 'marketing'] as readonly string[],
  /** PD-34: categories a person cannot switch off (operational). */
  'notification.locked_categories': ['lesson', 'payment', 'call', 'task', 'system'] as readonly string[],
  /** PD-34: after a message push, further messages in that chat wait this long and go out as one. */
  'notification.message_coalesce_seconds': 60,
  /** PD-34: someone reading the chat right now gets the push this late, and not at all if they read it. */
  'notification.message_reading_grace_seconds': 20,
  /** PD-34: names (a child's, an amount) on the lock screen, for someone who has not chosen. */
  'notification.lock_screen_names_default': false,
  /** PD-34: delivery rows are kept this long; Center entries this long. */
  'notification.delivery_retention_days': 90,
  'notification.item_retention_days': 365,
  /** initial hypothesis - how long a published story stays readable */
  'story.default_lifetime_hours': 24,
  /** initial hypothesis - longest story body accepted */
  'story.max_body_length': 2000,
  /** initial hypothesis - stories returned in one feed page */
  'story.feed_page_size': 50,
  /**
   * initial hypothesis - how long story media survives in object storage after
   * access ends, before the sweep purges it. Access ends at expires_at
   * regardless of this value; this only governs the bytes.
   */
  'story.media_retention_hours': 72,
  /** PD-9: an open lesson this long after its end is escalated to the Teachers department. */
  'lesson.escalation_after_minutes': 1440,
  /** PD-12 default: a held lesson counts as late only from this many minutes. */
  'teacher.late_threshold_minutes': 10,
  /** PD-12 default: a temporary suspension's length when the approver does not change it. */
  'teacher.suspension_default_days': 7,
  /** PD-11 T2: a teacher-cancelled lesson with no make-up this many days later goes to a supervisor. */
  'lesson.makeup_window_days': 7,
  /** How far ahead lessons are materialized from regular times. */
  'lesson.materialize_weeks': 4,
  /** A family books a make-up at least this long ahead, and at most this many days out. */
  'lesson.booking_lead_minutes': 120,
  'lesson.makeup_horizon_days': 14,
  /** PD-31: a family moves at most this many of one child's lessons per calendar month (stats.zone). */
  'lesson.family_moves_per_month': 4,
  /** PD-31: a teacher moves one of their lessons at least this long before it starts. */
  'lesson.teacher_move_lead_minutes': 120,
  /** Free times are offered on this grid (minutes). */
  'lesson.slot_step_minutes': 30,
  /** PD-11 T3: the family and the team hear this many days before a paused learner returns. */
  'lesson.return_notice_days': 2,
  /** PD-11 T5: the academy's zone for calendar months in statistics. */
  'stats.zone': 'Africa/Cairo',
  /** A report is on time when submitted within this many hours of the lesson's end. */
  'stats.report_grace_hours': 24,
  /** A family message counts as answered when the teacher replied within this many hours. */
  'stats.reply_within_hours': 24,
  /**
   * initial hypothesis - Phase 8 abuse limits (docs/security/ABUSE-LIMITS.md).
   * The fixed window every authenticated-action counter below is measured over.
   */
  'abuse.throttle.window_seconds': 60,
  /** initial hypothesis - message sends (and forwards) per actor per window. */
  'abuse.throttle.message_send_actor': 60,
  /** initial hypothesis - upload grants (attachments, story media) per actor per window. */
  'abuse.throttle.attachment_upload_actor': 30,
  /** initial hypothesis - story publications per actor per window. */
  'abuse.throttle.story_publish_actor': 20,
  /** initial hypothesis - call starts (and scheduled-call joins) per actor per window. */
  'abuse.throttle.call_start_actor': 20,
  /** initial hypothesis - inbound WebSocket frames one socket may send per minute. */
  'abuse.realtime.frames_per_socket_per_minute': 600,
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
