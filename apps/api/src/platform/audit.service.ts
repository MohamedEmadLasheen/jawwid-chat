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

/**
 * Both writes use createMany rather than create, so neither statement carries a
 * RETURNING clause.
 *
 * The read policies on these two tables are deliberately narrow -- the audit log
 * is manager-only, the event log is staff-and-in-scope -- and PostgreSQL applies
 * the SELECT policy to an INSERT ... RETURNING. Asking for the row back would
 * mean every actor who performs an auditable action must also be allowed to
 * READ the audit log, which is precisely backwards. Nothing needs the id.
 */
@Injectable()
export class PrismaAuditService implements AuditService {
  async audit(tx: Tx, input: AuditWriteInput): Promise<void> {
    await tx.auditLog.createMany({
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
    await tx.eventLog.createMany({
      data: {
        familyId: input.familyId ?? null,
        actorKind: input.actorKind, // maps to chat.event_log.actor_type
        actorId: input.actorId ?? null,
        type: input.type,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
