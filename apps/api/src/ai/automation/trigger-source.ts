import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { TriggerType, type TriggerEvent } from './automation.types';

/**
 * Where trigger events come from.
 *
 * Two kinds, and the difference is which system owns the fact:
 *
 *   LOCAL   FOLLOW_UP_DUE and MESSAGE_UNANSWERED are arithmetic over columns
 *           this database owns. They are computed in SQL, exactly, every sweep.
 *
 *   CORE    CLASS_UPCOMING, PAYMENT_DUE and RENEWAL_APPROACHING are facts about
 *           schedules and money, which the product boundary puts in Jawwid Core
 *           and which reach Chat only through chat.core_event. There is no
 *           local schedule table and no local invoice table, and there must not
 *           be one: chat.subscription is frozen machinery, and mirroring Core's
 *           billing here would create a second source of truth for the number
 *           a family is asked to pay.
 *
 * So `fromCoreEvents` is written, tested and dormant -- it drains an ingestion
 * table nothing currently writes. That is the honest shape of an integration
 * that is specified but not connected, and it is a great deal better than
 * inventing the data or asking a model to guess it (Phase 7 §20).
 */
@Injectable()
export class TriggerSource {
  private readonly log = new Logger(TriggerSource.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Conversations whose follow-up deadline has passed.
   *
   * The occurrence key is the DEADLINE, not the conversation. A supervisor who
   * sets a new follow-up next week gets a new occurrence and a new reminder;
   * re-running today's sweep converges on the one already sent.
   */
  async followUpsDue(now = new Date(), limit = 200): Promise<TriggerEvent[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { followUpAt: { not: null, lte: now }, resolvedAt: null, archivedAt: null },
      select: { id: true, familyId: true, followUpAt: true },
      orderBy: { followUpAt: 'asc' },
      take: limit,
    });

    return rows.map((r) => ({
      triggerType: TriggerType.FOLLOW_UP_DUE,
      subjectId: r.id,
      occurrenceKey: r.followUpAt!.toISOString(),
      conversationId: r.id,
      familyId: r.familyId,
    }));
  }

  /**
   * Families who have been waiting longer than the configured window.
   *
   * Deterministic: a family message newer than the last staff message means
   * nobody has replied, and the gap is subtraction. No model is consulted, and
   * this keeps working when the assistant is switched off.
   *
   * The occurrence key is the unanswered MESSAGE's timestamp, so one waiting
   * period raises one reminder however many times the sweep runs -- and a new
   * message after a reply starts a genuinely new one.
   */
  async unansweredConversations(now = new Date(), limit = 200): Promise<TriggerEvent[]> {
    const hours = Number(await this.config.get('attention.unanswered_hours'));
    const cutoff = new Date(now.getTime() - hours * 3_600_000);

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; family_id: string | null; last_customer_message_at: Date }>
    >`
      SELECT c.id, c.family_id, c.last_customer_message_at
      FROM chat.conversation c
      WHERE c.last_customer_message_at IS NOT NULL
        AND c.last_customer_message_at <= ${cutoff}
        AND (c.last_staff_message_at IS NULL
             OR c.last_staff_message_at < c.last_customer_message_at)
        AND c.resolved_at IS NULL
        AND c.archived_at IS NULL
      ORDER BY c.last_customer_message_at ASC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      triggerType: TriggerType.MESSAGE_UNANSWERED,
      subjectId: r.id,
      occurrenceKey: r.last_customer_message_at.toISOString(),
      conversationId: r.id,
      familyId: r.family_id,
    }));
  }

  /**
   * Trigger events carried in from Jawwid Core.
   *
   * DORMANT: chat.core_event is the ingestion boundary and nothing writes the
   * three types below yet. When Core does, these fire with no code change --
   * which is why the mapping is written now rather than left as a comment.
   *
   * The event's own id is the occurrence key, so redelivery from Core -- which
   * an at-least-once webhook will do -- converges instead of reminding a family
   * about the same invoice twice.
   */
  async fromCoreEvents(limit = 200): Promise<TriggerEvent[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ external_event_id: string; event_type: string; payload: Record<string, unknown> }>
    >`
      SELECT e.external_event_id, e.event_type, e.payload
      FROM chat.core_event e
      WHERE e.event_type IN ('class.upcoming', 'payment.due', 'renewal.approaching')
        AND e.processed_at IS NULL
      ORDER BY e.received_at ASC
      LIMIT ${limit}
    `;

    const events: TriggerEvent[] = [];
    for (const row of rows) {
      const triggerType = CORE_EVENT_TRIGGERS[row.event_type];
      if (!triggerType) continue;

      const payload = row.payload ?? {};
      const familyId = asUuid(payload.family_id);
      if (!familyId) {
        // A Core event that names no family cannot be evaluated against
        // family_active, so it is not actionable. Skipped rather than fired
        // against a null family, which would fail every condition anyway.
        this.log.warn(`core_event ${row.external_event_id} (${row.event_type}) names no family`);
        continue;
      }

      events.push({
        triggerType,
        subjectId: asString(payload.subject_id) ?? row.external_event_id,
        // CORE's own event id, not our local row id. chat.record_core_event
        // already dedupes on it, so an at-least-once webhook redelivering the
        // same invoice converges here instead of reminding a family twice.
        occurrenceKey: row.external_event_id,
        conversationId: null,
        familyId,
        // Only the display fields a template needs. Deliberately not the whole
        // payload: §31 keeps what leaves this system to the minimum, and a
        // notification template does not need Core's internal identifiers.
        variables: {
          amount: payload.amount ?? null,
          due_date: payload.due_date ?? null,
          starts_at: payload.starts_at ?? null,
        },
      });
    }
    return events;
  }
}

const CORE_EVENT_TRIGGERS: Readonly<Record<string, TriggerType>> = {
  'class.upcoming': TriggerType.CLASS_UPCOMING,
  'payment.due': TriggerType.PAYMENT_DUE,
  'renewal.approaching': TriggerType.RENEWAL_APPROACHING,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Core's payload is untrusted input like any other. */
function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}
