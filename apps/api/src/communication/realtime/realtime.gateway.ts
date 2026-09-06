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
import { Server, Socket } from 'socket.io';
import { AuthorizationService } from '../../platform/authorization.service';
import { IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import { Actor } from '../../platform/types';
import { CommEvent, CommEventName, CommEventPayloads, room } from '../contracts/events';
import { RealtimePublisher } from './realtime.publisher';
import { TypingService } from './typing.service';
import { PresenceService } from './presence.service';
import { MessageService } from '../messages/message.service';
import { ConversationService } from '../conversations/conversation.service';
import { ReceiptState } from '../contracts/vocab';

interface AuthedSocket extends Socket {
  actor?: Actor;
}

/**
 * Socket.IO gateway. Horizontal scaling uses the Redis adapter (wired in main.ts),
 * so a message sent on one node reaches sockets held by every other node.
 *
 * AUTHORIZATION: a client never joins a room by naming it. It asks to subscribe
 * to a conversationId, the server runs the same AuthorizationService the REST
 * path uses, and only then joins. Guessing or forging a room name gains nothing.
 */
@WebSocketGateway({ cors: { origin: false } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, RealtimePublisher
{
  private readonly log = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly typing: TypingService,
    private readonly presence: PresenceService,
    private readonly messages: MessageService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    // AI #1 SEAM: replace with verification of the real auth token. The shape -
    // a resolved Actor on the socket - does not change.
    const actorId = String(client.handshake.auth?.actorId ?? '');
    const actor = actorId ? await this.identity.resolveActor(actorId) : null;

    if (!actor || !actor.isActive) {
      client.disconnect(true);
      return;
    }

    client.actor = actor;
    // Every socket joins its own actor room, so multi-device fan-out is free.
    await client.join(room.actor(actor.actorId));
    await this.presence.online(actor.actorId, client.id);
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    if (!client.actor) return;
    await this.presence.offline(client.actor.actorId, client.id);
  }

  @SubscribeMessage('conversation.subscribe')
  async subscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean; code?: string }> {
    const actor = client.actor;
    if (!actor || !body?.conversationId) return { ok: false, code: 'COMM.UNKNOWN_ACTOR' };

    const check = await this.authorize(actor, body.conversationId);
    if (!check.ok) return check;

    await client.join(room.conversation(body.conversationId));
    return { ok: true };
  }

  @SubscribeMessage('conversation.unsubscribe')
  async unsubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.conversationId) return { ok: false };
    await client.leave(room.conversation(body.conversationId));
    return { ok: true };
  }

  @SubscribeMessage('typing.start')
  async typingStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const actor = client.actor;
    if (!actor || !body?.conversationId) return { ok: false };
    if (!(await this.authorize(actor, body.conversationId)).ok) return { ok: false };

    // Server-side debounce: a repeat ping inside the TTL only refreshes the key,
    // so a chatty client cannot amplify fan-out.
    if (await this.typing.start(body.conversationId, actor.actorId)) {
      client.to(room.conversation(body.conversationId)).emit(CommEvent.TYPING_STARTED, {
        conversationId: body.conversationId,
        actorId: actor.actorId,
        displayName: actor.displayName,
      });
    }
    return { ok: true };
  }

  @SubscribeMessage('typing.stop')
  async typingStop(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const actor = client.actor;
    if (!actor || !body?.conversationId) return { ok: false };
    if (await this.typing.stop(body.conversationId, actor.actorId)) {
      client.to(room.conversation(body.conversationId)).emit(CommEvent.TYPING_STOPPED, {
        conversationId: body.conversationId,
        actorId: actor.actorId,
        displayName: actor.displayName,
      });
    }
    return { ok: true };
  }

  @SubscribeMessage('presence.heartbeat')
  async heartbeat(@ConnectedSocket() client: AuthedSocket): Promise<{ ok: boolean }> {
    if (!client.actor) return { ok: false };
    await this.presence.heartbeat(client.actor.actorId, client.id);
    return { ok: true };
  }

  /** The client confirms it has the message on device. */
  @SubscribeMessage('message.delivered')
  async delivered(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { messageIds?: string[] },
  ): Promise<{ ok: boolean; updated: number }> {
    const actor = client.actor;
    if (!actor || !body?.messageIds?.length) return { ok: false, updated: 0 };
    // Scoped to this actor's own receipt rows; a client cannot acknowledge for
    // somebody else.
    const updated = await this.messages.markState(
      body.messageIds,
      actor.actorId,
      ReceiptState.DELIVERED,
    );
    return { ok: true, updated };
  }

  private async authorize(
    actor: Actor,
    conversationId: string,
  ): Promise<{ ok: boolean; code?: string }> {
    try {
      const conv = await this.conversations.requireConversation(conversationId);
      const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
      const decision = this.authz.canRead(actor, conv, membership);
      return decision.allowed ? { ok: true } : { ok: false, code: decision.code };
    } catch {
      return { ok: false, code: 'COMM.CONVERSATION_NOT_FOUND' };
    }
  }

  // --- RealtimePublisher ---

  async toThread<E extends CommEventName>(
    conversationId: string,
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    this.server?.to(room.conversation(conversationId)).emit(event, payload);
  }

  async toUsers<E extends CommEventName>(
    actorIds: string[],
    event: E,
    payload: CommEventPayloads[E],
  ): Promise<void> {
    if (actorIds.length === 0) return;
    this.server?.to(actorIds.map(room.actor)).emit(event, payload);
  }
}
