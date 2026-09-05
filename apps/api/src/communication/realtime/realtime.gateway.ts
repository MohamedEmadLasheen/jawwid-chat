import { Inject, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ReceiptState } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import { Actor } from '../../platform/types';
import { CommEvent, CommEventName, CommEventPayloads, room } from '../contracts/events';
import { RealtimePublisher } from './realtime.publisher';
import { TypingService } from './typing.service';
import { PresenceService } from './presence.service';
import { MessageService } from '../messages/message.service';

interface AuthedSocket extends Socket {
  actor?: Actor;
}

/**
 * Socket.IO gateway. Horizontal scaling uses the Redis adapter, wired in main.ts.
 *
 * AUTHORIZATION: a client never joins a room by naming it. It asks to subscribe
 * to a threadId, the server authorizes that thread through the same
 * AuthorizationService the REST path uses, and only then joins the room. A
 * forged or guessed room name gains nothing.
 */
@WebSocketGateway({ cors: { origin: false } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, RealtimePublisher
{
  private readonly log = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly typing: TypingService,
    private readonly presence: PresenceService,
    private readonly messages: MessageService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    // AI #1 SEAM: replace this with verification of the auth token issued by the
    // real auth service. The shape (a resolved Actor on the socket) does not change.
    const userId = String(client.handshake.auth?.userId ?? '');
    const actor = userId ? await this.identity.resolveActor(userId) : null;

    if (!actor || !actor.isActive) {
      client.disconnect(true);
      return;
    }

    client.actor = actor;
    // Every socket joins its own user room, so multi-device fan-out is automatic.
    await client.join(room.user(actor.userId));
    await this.presence.online(actor.userId, client.id);

    await this.toUsers([actor.userId], CommEvent.PRESENCE_CHANGED, {
      userId: actor.userId,
      state: 'ONLINE',
      lastSeenAt: null,
    });
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    if (!client.actor) return;
    await this.presence.offline(client.actor.userId, client.id);
  }

  @SubscribeMessage('thread.subscribe')
  async subscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { threadId?: string },
  ): Promise<{ ok: boolean; code?: string }> {
    const actor = client.actor;
    if (!actor || !body?.threadId) return { ok: false, code: 'COMM.UNKNOWN_ACTOR' };

    const thread = await this.prisma.thread.findUnique({ where: { id: body.threadId } });
    if (!thread) return { ok: false, code: 'COMM.THREAD_NOT_FOUND' };

    const decision = this.authz.canReadThread(actor, thread);
    if (!decision.allowed) return { ok: false, code: decision.code };

    await client.join(room.thread(thread.id));
    return { ok: true };
  }

  @SubscribeMessage('thread.unsubscribe')
  async unsubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { threadId?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.threadId) return { ok: false };
    await client.leave(room.thread(body.threadId));
    return { ok: true };
  }

  @SubscribeMessage('typing.start')
  async typingStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { threadId?: string },
  ): Promise<{ ok: boolean }> {
    const actor = client.actor;
    if (!actor || !body?.threadId) return { ok: false };
    if (!(await this.canTouchThread(actor, body.threadId))) return { ok: false };

    const isNew = await this.typing.start(body.threadId, actor.userId);
    if (isNew) {
      client.to(room.thread(body.threadId)).emit(CommEvent.TYPING_STARTED, {
        threadId: body.threadId,
        userId: actor.userId,
        displayName: actor.displayName,
      });
    }
    return { ok: true };
  }

  @SubscribeMessage('typing.stop')
  async typingStop(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { threadId?: string },
  ): Promise<{ ok: boolean }> {
    const actor = client.actor;
    if (!actor || !body?.threadId) return { ok: false };
    if (await this.typing.stop(body.threadId, actor.userId)) {
      client.to(room.thread(body.threadId)).emit(CommEvent.TYPING_STOPPED, {
        threadId: body.threadId,
        userId: actor.userId,
        displayName: actor.displayName,
      });
    }
    return { ok: true };
  }

  @SubscribeMessage('presence.heartbeat')
  async heartbeat(@ConnectedSocket() client: AuthedSocket): Promise<{ ok: boolean }> {
    if (!client.actor) return { ok: false };
    await this.presence.heartbeat(client.actor.userId, client.id);
    return { ok: true };
  }

  /** Client confirms it has the message on device. */
  @SubscribeMessage('message.delivered')
  async delivered(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { messageIds?: string[] },
  ): Promise<{ ok: boolean; updated: number }> {
    const actor = client.actor;
    if (!actor || !body?.messageIds?.length) return { ok: false, updated: 0 };
    // Only this user's own receipt rows can be touched.
    const updated = await this.messages.markState(
      body.messageIds,
      actor.userId,
      ReceiptState.DELIVERED,
    );
    return { ok: true, updated };
  }

  private async canTouchThread(actor: Actor, threadId: string): Promise<boolean> {
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) return false;
    return this.authz.canReadThread(actor, thread).allowed;
  }

  // --- RealtimePublisher ---

  async toThread<E extends CommEventName>(
    threadId: string,
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    this.server?.to(room.thread(threadId)).emit(event, payload);
  }

  async toUsers<E extends CommEventName>(
    userIds: string[],
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    if (userIds.length === 0) return;
    this.server?.to(userIds.map(room.user)).emit(event, payload);
  }
}
