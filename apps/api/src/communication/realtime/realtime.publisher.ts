import { Injectable, Logger } from '@nestjs/common';
import { CommEventName, CommEventPayloads } from '../contracts/events';

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
}
