import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface AuditWriteInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** NOT NULL by design: a sensitive action without a reason is a bug. */
  reason: string;
}

export interface EventWriteInput {
  familyId?: string | null;
  caseId?: string | null;
  actorKind: string;
  actorId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
}

/**
 * PLATFORM SEAM - AI #1 owns chat.event_log and chat.audit_log.
 *
 * Every method takes a transaction client: an audit write happens in the same
 * transaction as the action it records, or it is not an audit trail.
 */
export interface AuditService {
  audit(tx: Tx, input: AuditWriteInput): Promise<void>;
  event(tx: Tx, input: EventWriteInput): Promise<void>;
}

@Injectable()
export class PrismaAuditService implements AuditService {
  async audit(tx: Tx, input: AuditWriteInput): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: (input.before ?? Prisma.DbNull) as Prisma.InputJsonValue,
        after: (input.after ?? Prisma.DbNull) as Prisma.InputJsonValue,
        reason: input.reason,
      },
    });
  }

  async event(tx: Tx, input: EventWriteInput): Promise<void> {
    await tx.eventLog.create({
      data: {
        familyId: input.familyId ?? null,
        caseId: input.caseId ?? null,
        actorKind: input.actorKind, // maps to chat.event_log.actor_type
        actorId: input.actorId ?? null,
        type: input.type,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
