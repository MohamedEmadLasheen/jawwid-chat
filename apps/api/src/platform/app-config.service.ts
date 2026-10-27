import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Brief section 1: "All thresholds/weights/windows live in a config table."
 * Brief section 12: "Every number in this brief is treated as a config default
 * with a comment 'initial hypothesis'."
 *
 * Nothing in the communication engine may hardcode one of these numbers.
 */
/** PD-38: a category's default shift -- wall-clock "HH:MM" in the teacher's zone, ISO weekdays. */
export interface ShiftDefault {
  start: string;
  end: string;
  weekdays: number[];
}

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
  /**
   * PD-37: announce read/delivery ticks (receipts.advanced -> message.status).
   * OFF by default and turned ON only once the WORKER that knows the event is
   * deployed: a worker from before PD-37 has no case for it, and its default
   * branch would broadcast the reader's cursor to the whole room. Off, cursors
   * and receipts still move; only the live tick push waits. See the runbook.
   */
  'realtime.receipts_announce': false as boolean,
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
   * PD-34. Every value below is a PROPOSAL awaiting the owner (2026-10-26); an
   * answer changes these values, not code. Until then the two that would
   * change what people receive are OFF: no default quiet hours (a person may
   * still set their own) and no hourly push cap. Calls, the T-30/T-15 lesson
   * reminders and security are exempt from quiet hours by their rules anyway.
   */
  'notification.quiet_hours.default_enabled': false,
  /**
   * PD-34 amendment, DECIDED (owner, 2026-10-27), for CHAT pushes only (new
   * messages and PD-36 mentions): quiet hours ON by default, 22:00-08:00 in
   * each recipient's own zone; a person's own setting always wins, off
   * included. Lessons, payments, renewals, calls, cover lines, approvals and
   * administrative alerts keep their own rules and never read this.
   */
  'notification.chat.quiet_hours.default_enabled': true,
  'notification.chat.quiet_hours.default_start_minute': 1320,
  'notification.chat.quiet_hours.default_end_minute': 480,
  /**
   * PD-34 amendment, DECIDED (owner, 2026-10-27): at most this many chat-message
   * pushes per person per rolling hour. The excess is never dropped: it is held
   * into ONE summary push sent when the hour frees up (or when quiet hours end).
   * Mentions are exempt. Every message is in the Notification Center regardless.
   */
  'notification.chat.pushes_per_hour': 6,
  'notification.quiet_hours.default_start_minute': 1320,
  'notification.quiet_hours.default_end_minute': 480,
  /** PD-34 (proposed: 6): pushes an hour per person in a rate-limited category before the rest go to the Center only. 0 = no cap. */
  'notification.push_per_hour': 0,
  'notification.rate_limited_categories': ['conversation', 'announcement', 'marketing'] as readonly string[],
  /** PD-34: categories a person cannot switch off (operational). */
  'notification.locked_categories': ['lesson', 'payment', 'call', 'task', 'system'] as readonly string[],
  /** PD-34: after a message push, further messages in that chat wait this long and go out as one. */
  'notification.message_coalesce_seconds': 60,
  /** PD-34: someone reading the chat right now gets the push this late, and not at all if they read it. */
  'notification.message_reading_grace_seconds': 20,
  /** PD-34 (proposed; privacy-safe default): names (a child's, an amount) on the lock screen, for someone who has not chosen. */
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
   * PD-38: the shift a full-shift teacher gets when the category is chosen
   * (editable per teacher). ISO weekdays: Saturday-Thursday, Friday off.
   */
  'schedule.shift.full_shift': { start: '12:00', end: '19:00', weekdays: [6, 7, 1, 2, 3, 4] } as ShiftDefault,
  /** PD-38: the same for a part-shift teacher. */
  'schedule.shift.part_shift': { start: '14:00', end: '18:00', weekdays: [6, 7, 1, 2, 3, 4] } as ShiftDefault,
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
  /** initial hypothesis - PD-37 read/delivery cursor moves per actor per window. */
  'abuse.throttle.receipt_cursor_actor': 240,
  /** initial hypothesis - PD-37 presence questions (GET /presence) per actor per window. */
  'abuse.throttle.presence_read_actor': 60,
  /**
   * initial hypothesis - PD-37 typing pings over HTTP per actor per window. A
   * client pings every 3 s while typing (20 a minute) plus its stops. No seeded
   * row: the compiled default applies until an operator adds one to tune it.
   */
  'abuse.throttle.typing_actor': 40,
  /** initial hypothesis - inbound WebSocket frames one socket may send per minute. */
  'abuse.realtime.frames_per_socket_per_minute': 600,
  /** PD-33: how many supervisors one backup may cover at the same time. */
  'cover.max_concurrent': 2,
  /** PD-33: the longest a cover may run; longer is a change of supervisor (PD-24). */
  'cover.max_days': 30,
  /** PD-36: people one sender may mention in one conversation per hour; more stay plain text. */
  'mention.per_sender_hour': 5,
  /** PD-36: times the super admin may be mentioned in one conversation per day. */
  'mention.super_admin_day': 3,
  /** PD-36: "@supervisor" / "@admin" role mentions one parent may send in one conversation per day. */
  'mention.parent_role_day': 3,
  /** PD-36: an unanswered summons expires after this many days. */
  'mention.expiry_days': 7,
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
