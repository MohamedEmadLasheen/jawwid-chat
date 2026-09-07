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

  // --- Calls, recording, stories and broadcast (Phase 5) ---------------------
  // Mirrors the rows inserted by 2026090715*.sql. As everywhere else in this
  // file, the ROW is authoritative and these are the fallbacks a fresh database
  // starts from.
  /** how many expired ringing calls one missed-call sweep claims */
  'call.missed_sweep_batch': 200,
  /** offsets after a class call starts at which a not-yet-joined recipient is reminded */
  'call.class_reminder_seconds': [60, 180],
  /**
   * Days an available recording is retained before the retention sweep deletes
   * it.
   *
   * A SAFE TECHNICAL DEFAULT, NOT A STATED BUSINESS POLICY. Neither the PRD nor
   * the audit states a retention period for call recordings, and inventing one
   * and calling it the academy's policy would be a fabrication. This exists so
   * that no recording is stored unbounded by omission; the real figure is a
   * config row away. See docs/recovery/PHASE-5-REPORT.md.
   */
  'recording.retention_days': 30,
  /** signed playback URL lifetime. Short by design: it is a bearer credential */
  'recording.playback_url_ttl_seconds': 120,
  'recording.retention_sweep_batch': 100,
  'story.default_lifetime_hours': 24,
  'story.max_body_length': 2000,
  'story.feed_page_size': 50,
  'broadcast.fanout_batch_size': 100,
  /** deliveries in flight at once -- bounded so fan-out cannot starve live chat */
  'broadcast.fanout_concurrency': 8,
  'broadcast.lease_seconds': 60,
  'broadcast.max_attempts': 5,
  /** a guard against an audience clause that accidentally means everyone */
  'broadcast.max_recipients': 5000,

  // --- Smart moderation and the Command Center (Phase 6) ---------------------
  // Mirrors the rows inserted by 2026090717*.sql. As everywhere else in this
  // file, the ROW is authoritative and these are the fallbacks a fresh database
  // starts from.
  /**
   * Hours a moderation item may stay pending before it is escalated.
   *
   * The figure is the Phase 6 brief's own ("3-4 hours"). The PRD lists
   * escalation as post-MVP and states no duration, so there was no existing
   * policy to reconcile against -- which is exactly why it is a config row.
   * Escalation changes who is ACCOUNTABLE for an item; it never sends, rejects
   * or expires the message.
   */
  'moderation.escalation_hours': 3,
  'moderation.queue_page_size': 200,
  'moderation.escalation_sweep_batch': 200,
  'moderation.max_pattern_length': 512,
  /** A scan that exceeds this fails CLOSED -- the message is held. */
  'moderation.scan_budget_ms': 250,

  // Supervisor overload. TWO thresholds per axis rather than one, because
  // "over the line" and "about to be" need different treatment on the board:
  // a manager acts on the first and watches the second.
  //
  // NOT DERIVED FROM THE FROZEN WORKLOAD ENGINE. `workload_*` is deprecated
  // machinery (PD-3, Phase 0) and nothing new may depend on it. These count
  // real, live facts -- conversations awaiting a reply, items awaiting a
  // moderation decision -- and they are INITIAL HYPOTHESES, set here so the
  // academy can tune them without a deploy.
  'command_center.overload_unanswered_warning': 6,
  'command_center.overload_unanswered_high': 12,
  'command_center.overload_pending_warning': 3,
  'command_center.overload_pending_high': 6,
  /** The trailing window the call and missed-class-call KPIs are counted over. */
  'command_center.window_hours': 24,

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

  // --- Authenticated-action abuse protection (Phase 8) ----------------------
  // The counters above bound what can be reached WITHOUT a session.
  // Authorization then answers "may this actor do this at all" -- but not "may
  // this actor do it four thousand times a minute". These bound the expensive
  // actions per ACTOR, which is the axis an authenticated caller cannot rotate.
  // Mirrors 20260908090000_chat_phase8_action_throttle.sql; the ROW is
  // authoritative and these are the fallbacks a fresh database starts from.
  //
  // A much shorter window than the auth counters: this asks whether a session
  // is behaving like a script right now, not whether somebody has been grinding
  // at an account for a quarter of an hour.
  'abuse.throttle.window_seconds': 60,
  'abuse.throttle.block_seconds': 300,
  /** initial hypothesis - one per second sustained is far above human typing */
  'abuse.throttle.message_send_actor': 60,
  /** initial hypothesis - each grant authorises a write to object storage */
  'abuse.throttle.attachment_upload_actor': 30,
  /** initial hypothesis - fans out to every family in the audience; bound hardest */
  'abuse.throttle.broadcast_send_actor': 5,
  'abuse.throttle.story_publish_actor': 20,
  /** initial hypothesis - each one mints a media token and reserves a room */
  'abuse.throttle.call_start_actor': 20,
  /**
   * Inbound WebSocket frames one socket may send per minute before it is
   * disconnected. Enforced in the gateway IN MEMORY rather than through the
   * throttle table: a typing indicator fires per keystroke, and a database
   * write per keystroke would be a self-inflicted denial of service.
   */
  'abuse.realtime.frames_per_socket_per_minute': 600,

  // --- AI and automation (Phase 7) -------------------------------------------
  // Mirrors the rows inserted by 202609071[89]*.sql. As everywhere else in this
  // file, the ROW is authoritative and these are the fallbacks a fresh database
  // starts from.
  /**
   * The master switch, INDEPENDENT of credentials. Removing an API key disables
   * the assistant by accident and takes a deployment to undo; this turns it off
   * on purpose, immediately, without one.
   */
  'ai.enabled': true,
  /** initial hypothesis - below this the assistant declines rather than guesses */
  'ai.min_confidence': 0.6,
  /** initial hypothesis - approved articles retrieved as grounding for one question */
  'ai.faq_max_articles': 6,
  /** initial hypothesis - trailing messages given to the suggested-reply prompt */
  'ai.suggestion_context_messages': 30,
  /** initial hypothesis - trailing messages given to the summary prompt */
  'ai.summary_context_messages': 120,
  /** initial hypothesis - trailing messages given to the risk classifier */
  'ai.risk_context_messages': 40,
  /**
   * initial hypothesis - a pending suggestion older than this is not offered.
   * A stale draft is worse than none: the conversation has moved on, and a
   * manager who sends it is replying to a message that is no longer last.
   */
  'ai.suggestion_stale_minutes': 120,

  /**
   * The DETERMINISTIC risk thresholds. Arithmetic over message timestamps, and
   * deliberately not a model's judgement: "the family has waited 41 hours" is a
   * fact the database holds exactly, and asking a model would be slower, dearer
   * and sometimes wrong (Phase 7 §20).
   */
  'attention.unanswered_hours': 24,
  'attention.unanswered_severe_hours': 72,
  /** initial hypothesis - conversations one risk sweep examines */
  'attention.sweep_batch': 100,
  /**
   * initial hypothesis - a conversation is not classified until the family has
   * said at least this much. One message is not a pattern, and classifying it
   * is how a queue of false positives gets manufactured.
   */
  'attention.classify_min_customer_messages': 2,
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
