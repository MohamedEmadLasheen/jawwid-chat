import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';

/** This endpoint is Jawwid Core's. The ledger's source column says so. */
export const CORE_SOURCE = 'jawwid_core';

export type IngestOutcome =
  | { status: 'applied'; detail: string }
  | { status: 'duplicate' }
  | { status: 'not_applicable'; detail: string }
  /** A disagreement retrying cannot fix. Kept in the ledger with its reason; Core should stop. */
  | { status: 'rejected'; reason: string };

/** A valid delivery Chat cannot apply YET. Core retries. (No handler raises it today.) */
export class CoreRetryLater extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreRetryLater';
  }
}

const MAX_ID = 200;

/**
 * THE CORE BOUNDARY'S PROCESSOR. It records every delivery; since the trial
 * journey (2026-10-20) no event changes a trial (Chat is the source of truth).
 *
 * `chat.core_event` is the existing ledger: unique (source, external_event_id),
 * written by chat.record_core_event. This service records a delivery and applies
 * it, and the CLAIM is part of the applying transaction -- the lesson of the
 * Core consumer branch's P1: a claim committed on its own, then a crash, left
 * `processed_at` set with nothing applied, so Core's retry was answered
 * "duplicate" and the event was lost silently. Here a crash rolls the claim back.
 *
 * TWO LAYERS, DIFFERENT QUESTIONS. The ledger's unique key says whether this
 * DELIVERY was seen; `processed_at` with no `error` says whether it was APPLIED.
 * Only the second makes a repeat a duplicate.
 */
@Injectable()
export class CoreIngestService {
  private readonly log = new Logger(CoreIngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordAndApply(input: { externalEventId: string; eventType: string; payload: Record<string, unknown> }): Promise<IngestOutcome> {
    const [recorded] = await this.prisma.$queryRaw<{ recorded: boolean }[]>`
      select chat.record_core_event(${input.externalEventId}, ${input.eventType},
                                    ${JSON.stringify(input.payload)}::jsonb, ${CORE_SOURCE}) as recorded`;
    if (recorded?.recorded !== true) {
      const [existing] = await this.ledgerRow(input.externalEventId);
      // Applied cleanly before -- or refused for good -- is a duplicate: Core should stop.
      if (existing?.processed_at && !existing.error) return { status: 'duplicate' };
      if (existing?.processed_at && existing.error?.startsWith('rejected:')) {
        return { status: 'rejected', reason: existing.error.slice('rejected:'.length) };
      }
      // Recorded but never applied: fall through and try again.
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$executeRaw`
          update chat.core_event set processed_at = now(), error = null
           where source = ${CORE_SOURCE} and external_event_id = ${input.externalEventId} and processed_at is null`;
        // Another delivery of the same event is applying it right now.
        if (claimed !== 1) return { status: 'duplicate' } as const;

        const outcome = await this.apply(tx, input.eventType, input.payload);
        if (outcome.status === 'rejected') {
          // Consumed for good, with the reason kept beside it for an operator.
          await tx.$executeRaw`
            update chat.core_event set error = ${`rejected:${outcome.reason}`}
             where source = ${CORE_SOURCE} and external_event_id = ${input.externalEventId}`;
          this.log.warn(`core event ${input.eventType} refused: ${outcome.reason}`);
        }
        return outcome;
      });
    } catch (error) {
      // The transaction rolled the claim back; record WHY, so the row is visible
      // as unprocessed-with-a-reason until Core's retry applies it.
      const why = error instanceof Error ? error.message.slice(0, 500) : 'unknown';
      await this.prisma.$executeRaw`
        update chat.core_event set error = ${why}
         where source = ${CORE_SOURCE} and external_event_id = ${input.externalEventId} and processed_at is null`;
      throw error;
    }
  }

  private ledgerRow(externalEventId: string) {
    return this.prisma.$queryRaw<{ processed_at: Date | null; error: string | null }[]>`
      select processed_at, error from chat.core_event
       where source = ${CORE_SOURCE} and external_event_id = ${externalEventId}`;
  }

  private apply(tx: Prisma.TransactionClient, eventType: string, data: Record<string, unknown>): Promise<IngestOutcome> {
    switch (eventType) {
      case 'subscription.created':
        return this.subscriptionCreated(tx, data);
      default:
        // The envelope's allowlist makes this unreachable; refusing is the safe answer if it is not.
        return Promise.resolve({ status: 'rejected', reason: 'unhandled_event_type' });
    }
  }

  /**
   * `subscription.created`: Core created a subscription. Since the trial
   * journey (owner decision 2026-10-20) Jawwid Chat is the ONLY source of truth
   * for a trial's outcome: Sales' "subscribed" in Chat is the conversion, and
   * nothing waits for Core. So a delivery is recorded in the ledger, checked,
   * and changes nothing -- no trial, no statistic, no New Students row.
   */
  private async subscriptionCreated(_tx: Prisma.TransactionClient, data: Record<string, unknown>): Promise<IngestOutcome> {
    const subscriptionId = opaqueId(data.core_subscription_id);
    if (!subscriptionId) return { status: 'rejected', reason: 'missing_core_subscription_id' };
    return { status: 'not_applicable', detail: 'trial outcomes are recorded in Chat' };
  }
}

/** A Core id is opaque text: trimmed for emptiness only, never parsed or re-cased. */
function opaqueId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 && v.length <= MAX_ID ? v : null;
}
