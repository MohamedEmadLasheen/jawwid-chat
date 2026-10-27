import { Injectable, Logger } from '@nestjs/common';
import { CommEventName, CommEventPayloads } from '../contracts/events';

/**
 * PD-37: who in a conversation an event is FOR, on top of who may read it.
 * Decided on the delivering node after RT-009's checks (live identity, live
 * membership, canRead), never instead of them:
 *   - onlyActors     these people only (a message's author, for its ticks);
 *   - countableOnly  seated members only: live, not silent, not observer
 *                    (typing never reaches a PD-8 reader without a seat).
 * A socket the audience leaves out simply receives nothing; it is not
 * treated as having lost access.
 */
export interface DeliveryAudience {
  onlyActors?: string[];
  countableOnly?: boolean;
  /**
   * A payload of its own for each of these people, in place of the shared one:
   * one delivery pass (one set of RT-009 checks) for many authors, each of whom
   * still receives only their own ticks.
   */
  perActor?: Record<string, unknown>;
}

/**
 * Port for pushing a typed event to connected sockets. The gateway implements
 * it; workers depend only on this interface so they never import socket.io.
 */
export interface RealtimePublisher {
  toThread<E extends CommEventName>(
    threadId: string,
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void>;
  toUsers<E extends CommEventName>(
    userIds: string[],
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void>;
  /**
   * PD-37: a conversation event for part of the room only (see
   * DeliveryAudience). Optional so recording fakes need not grow it; a caller
   * whose publisher lacks it must FAIL rather than fall back to toThread --
   * the fallback is the whole room.
   */
  toThreadAudience?<E extends CommEventName>(
    threadId: string,
    event: E,
    payload: CommEventPayloads[E],
    audience: DeliveryAudience,
  ): Promise<void>;
}

/** Used in tests and in single-process runs without a websocket server. */
@Injectable()
export class NoopRealtimePublisher implements RealtimePublisher {
  private readonly log = new Logger(NoopRealtimePublisher.name);

  async toThread<E extends CommEventName>(
    threadId: string,
    event: E,
    _payload: CommEventPayloads[E],
  ): Promise<void> {
    this.log.debug(`(noop) ${event} -> thread:${threadId}`);
  }

  async toUsers<E extends CommEventName>(
    userIds: string[],
    event: E,
    _payload: CommEventPayloads[E],
  ): Promise<void> {
    this.log.debug(`(noop) ${event} -> ${userIds.length} user room(s)`);
  }

  async toThreadAudience<E extends CommEventName>(
    threadId: string,
    event: E,
    _payload: CommEventPayloads[E],
    _audience: DeliveryAudience,
  ): Promise<void> {
    this.log.debug(`(noop) ${event} -> part of thread:${threadId}`);
  }
}
