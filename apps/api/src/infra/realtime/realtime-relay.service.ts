import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import { RealtimeGateway } from '../../communication/realtime/realtime.gateway';
import { decodeEnvelope, realtimeChannel } from './realtime-channel';

/**
 * API-side half of the worker realtime path (D-2). Owner: AI #7.
 *
 * Subscribes to the channel the worker publishes on and emits each envelope
 * into this instance's Socket.IO server.
 *
 * `.local` is essential. Redis pub/sub delivers to EVERY subscribed API
 * instance, and each one holds its own sockets. Emitting without `.local` would
 * hand the event to the Socket.IO Redis adapter, which fans it out to all the
 * other instances again -- so with N instances every client would receive the
 * message N times. `.local` restricts delivery to the sockets this process
 * actually holds, which together cover every connected client exactly once.
 *
 * Started explicitly from main.ts after listen(), because it needs the attached
 * Socket.IO server.
 */
@Injectable()
export class RealtimeRelay implements OnModuleDestroy {
  private readonly log = new Logger(RealtimeRelay.name);
  private subscriber?: Redis;

  constructor(private readonly gateway: RealtimeGateway) {}

  async start(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.log.warn(
        'REDIS_URL is not set: realtime events published by a separate worker ' +
          'will not be relayed. Run the drain in-process, or set REDIS_URL.',
      );
      return;
    }

    this.subscriber = new Redis(url, { maxRetriesPerRequest: null });
    this.subscriber.on('error', (e) => this.log.error(`relay redis: ${e.name}`));

    this.subscriber.on('message', (channel, raw) => {
      if (channel !== realtimeChannel()) return;
      const envelope = decodeEnvelope(raw);
      if (!envelope) {
        this.log.warn('discarded a malformed realtime envelope');
        return;
      }

      const server = (this.gateway as unknown as { server?: Server }).server;
      if (!server) return;

      // RT-009: never a raw room emit. Each recipient on THIS node is
      // authorized at delivery (live membership, session-precise identity,
      // canRead), so a revocation that has committed is honoured here even if
      // no eviction message ever reached this node.
      if (envelope.target === 'room') {
        for (const id of envelope.ids) {
          void this.gateway.deliverToConversationLocally(id, envelope.event, envelope.payload);
        }
      } else if (envelope.target === 'room-audience') {
        // PD-37: part of the room, after the same checks.
        for (const id of envelope.ids) {
          void this.gateway.deliverToConversationLocally(id, envelope.event, envelope.payload, undefined, envelope.audience);
        }
      } else {
        void this.gateway.deliverToActorsLocally(envelope.ids, envelope.event, envelope.payload);
      }
    });

    await this.subscriber.subscribe(realtimeChannel());
    this.log.log(`relaying worker realtime events from ${realtimeChannel()}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
