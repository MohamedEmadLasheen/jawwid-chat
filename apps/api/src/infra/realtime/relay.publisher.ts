import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { CommEventName, CommEventPayloads } from '../../communication/contracts/events';
import { room } from '../../communication/contracts/events';
import type { RealtimePublisher } from '../../communication/realtime/realtime.publisher';
import { RealtimeGateway } from '../../communication/realtime/realtime.gateway';
import { encodeEnvelope, realtimeChannel, RealtimeEnvelope } from './realtime-channel';

/**
 * The realtime publisher used by the outbox worker. Owner: AI #7.
 *
 * THE DEFECT THIS EXISTS TO FIX (D-2)
 * RealtimeGateway.toThread() emits with `this.server?.to(...)`. In the worker,
 * started with createApplicationContext, there is no Socket.IO server, so
 * `server` is undefined and the optional chain turns the emit into a silent
 * no-op. OutboxWorker.drain() claims the row as `published` first and only
 * reverts it if publish() throws -- and a no-op does not throw. Every realtime
 * event was therefore marked delivered and delivered to nobody.
 *
 * THE RULE
 * This class NEVER returns successfully unless the event reached a process that
 * can deliver it. If it cannot, it throws, and drain()'s existing error path
 * returns the row to `pending` with backoff. An event is only `published` when
 * publication actually happened.
 *
 * TWO PATHS, chosen per call rather than at construction, because the Socket.IO
 * server is attached during app.listen() -- after DI has finished:
 *
 *   in-process   this process owns the server (API, or a single-process run):
 *                emit through the gateway. With the Socket.IO Redis adapter
 *                already wired, that fans out to every other instance.
 *
 *   via Redis    this process has no server (the worker): PUBLISH onto our own
 *                channel. Redis reports how many subscribers received it; zero
 *                means no API instance is listening, which is a delivery
 *                failure and is raised as one.
 */
@Injectable()
export class RelayRealtimePublisher implements RealtimePublisher, OnModuleDestroy {
  private readonly log = new Logger(RelayRealtimePublisher.name);
  private publisher?: Redis;

  constructor(private readonly gateway: RealtimeGateway) {}

  async toThread<E extends CommEventName>(
    conversationId: string,
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    if (this.hasLocalServer()) {
      await this.gateway.toThread(conversationId, event, payload);
      return;
    }
    await this.viaRedis({ target: 'room', ids: [conversationId], event, payload });
  }

  async toUsers<E extends CommEventName>(
    actorIds: string[],
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    if (actorIds.length === 0) return;
    if (this.hasLocalServer()) {
      await this.gateway.toUsers(actorIds, event, payload);
      return;
    }
    await this.viaRedis({ target: 'users', ids: actorIds, event, payload });
  }

  /**
   * True only once Socket.IO has attached a server to the gateway. Checked per
   * call: DI runs before app.listen(), so a decision made in a factory would
   * always say "no server" even in the API.
   */
  private hasLocalServer(): boolean {
    const server = (this.gateway as { server?: unknown }).server;
    return server !== undefined && server !== null;
  }

  private client(): Redis {
    if (!this.publisher) {
      const url = process.env.REDIS_URL;
      if (!url) {
        // Fail loudly rather than degrade. A worker with no delivery path must
        // not drain the outbox -- it would burn through every event's retries.
        throw new Error('REDIS_URL is not set: this process has no realtime delivery path');
      }
      this.publisher = new Redis(url, { maxRetriesPerRequest: 2 });
      this.publisher.on('error', (e) => this.log.error(`realtime publisher redis: ${e.name}`));
    }
    return this.publisher;
  }

  private async viaRedis(envelope: RealtimeEnvelope): Promise<void> {
    const receivers = await this.client().publish(realtimeChannel(), encodeEnvelope(envelope));

    if (receivers === 0) {
      // The whole point of D-2. Do NOT return normally here: returning is what
      // marks the outbox row published, and nothing received this event.
      throw new Error(
        `realtime event '${envelope.event}' reached no API instance ` +
          `(0 subscribers on ${realtimeChannel()}); returning it to the outbox`,
      );
    }
    this.log.debug(`${envelope.event} -> ${receivers} relay(s)`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher?.quit().catch(() => undefined);
  }
}

/** Re-exported so the relay and the publisher agree on room naming. */
export const realtimeRoom = room;
