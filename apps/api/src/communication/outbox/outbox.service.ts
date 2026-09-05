import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommEventName, CommEventPayloads } from '../contracts/events';

/**
 * Transactional outbox.
 *
 * The row is written inside the same transaction as the domain change, so a
 * committed message can never lose its realtime fan-out or its notification.
 * A worker drains PENDING rows and publishes them. At-least-once delivery;
 * consumers are idempotent (realtime is a fan-out, notifications dedupe on
 * dedupeKey).
 */
@Injectable()
export class OutboxService {
  async enqueue<E extends CommEventName>(
    tx: Prisma.TransactionClient,
    type: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: { type, payload: payload as unknown as Prisma.InputJsonValue },
    });
  }
}
