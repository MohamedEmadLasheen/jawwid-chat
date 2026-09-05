import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * PLATFORM SEAM - AI #1 OWNS THE TABLES.
 * Brief section 3: "Audit write happens in the same transaction as the sensitive
 * action." Every method therefore accepts a transaction client.
 */
export type Tx = Prisma.TransactionClient;

export interface AuditWriteInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** NOT NULL by design. A sensitive action without a reason is a bug. */
  reason: string;
}

export interface EventWriteInput {
  familyId?: string | null;
  actorType: string;
  actorId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
}

export interface AuditService {
  audit(tx: Tx, input: AuditWriteInput): Promise<void>;
  event(tx: Tx, input: EventWriteInput): Promise<void>;
}

@Injectable()
export class PrismaAuditService implements AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async audit(tx: Tx, input: AuditWriteInput): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: (input.before ?? null) as Prisma.InputJsonValue,
        after: (input.after ?? null) as Prisma.InputJsonValue,
        reason: input.reason,
      },
    });
  }

  async event(tx: Tx, input: EventWriteInput): Promise<void> {
    await tx.eventLog.create({
      data: {
        familyId: input.familyId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        type: input.type,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
