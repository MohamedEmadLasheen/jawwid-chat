import { Logger } from '@nestjs/common';
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
import { Actor } from '../../platform/types';
import { CommEvent, CommEventName, CommEventPayloads, room } from '../contracts/events';
import { RealtimePublisher } from './realtime.publisher';
import { TypingService } from './typing.service';
import { PresenceService } from './presence.service';
import { MessageService } from '../messages/message.service';
import { ConversationService } from '../conversations/conversation.service';
import { ReceiptState } from '../contracts/vocab';
import { AuthService } from '../../platform/auth/auth.service';
import { bearerToken } from '../../platform/auth/auth.guard';

interface AuthedSocket extends Socket {
  /** Written ONLY by handleConnection, ONLY from a verified token. */
  actor?: Actor;
  accountId?: string;
  sessionId?: string;
}

/**
 * The token, from the handshake.
 *
 * `auth: { token }` is the contracted position (API-CONTRACT section 1,
 * "WebSocket: socket.io handshake auth: { token } on the default namespace").
 * The Authorization header is accepted as well because some socket.io clients
 * cannot set `auth` on a reconnect, and a client that falls back to the header
 * should not silently become unauthenticated.
 *
 * Everything else in the handshake is data, not identity. In particular
 * `auth.actorId` -- the old seam -- is not read here or anywhere else.
 */
function handshakeToken(client: Socket): string | null {
  const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0 && fromAuth === fromAuth.trim()) {
    return fromAuth;
  }
  return bearerToken(client.handshake.headers?.authorization);
}

/**
 * Socket.IO gateway. Horizontal scaling uses the Redis adapter (wired in main.ts),
 * so a message sent on one node reaches sockets held by every other node.
 *
 * AUTHENTICATION: the handshake carries a bearer token and nothing else that
 * matters. It is verified by AuthService.authenticate() -- the same method the
 * HTTP guard uses -- and the resolved Actor is the socket's identity for its
 * lifetime. `handshake.auth.actorId`, the pre-PR-B seam, is not read.
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
    // IDENTITY_SERVICE is deliberately NOT injected any more. It was here only
    // to resolve the actor the client named; AuthService now resolves the actor
    // from the token, and leaving a second way to obtain an Actor in this class
    // is how the old path would find its way back.
    private readonly auth: AuthService,
  ) {}

  /**
   * RT-001 CLOSED (2026-09-23). Identity comes from a verified token and from
   * nothing else.
   *
   * This used to read `handshake.auth.actorId` and resolve it verbatim, so any
   * caller who could reach the socket could name any active actor and receive
   * that actor's conversation traffic, call events and presence. PR-B closed
   * the HTTP half of that seam; this closes the WebSocket half, and with it the
   * boot restriction that kept such a build out of production.
   *
   * ONE IMPLEMENTATION, NOT TWO. `AuthService.authenticate()` is the same
   * method the global AuthenticatedGuard calls for every HTTP request: same
   * signature verification, same session lookup, same revocation check, same
   * account-status check, same token-claims-versus-database reconciliation. A
   * second verifier written for sockets is a second thing to get wrong, and the
   * two would drift the first time either changed.
   *
   * WHO, NOT WHAT. This method answers "who is this actor?" and stops there.
   * What the actor may do stays with AuthorizationService, which `subscribe`
   * below consults with the same rules the REST path uses.
   */
  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = handshakeToken(client);
    if (!token) {
      // No credential is a refusal, not an anonymous connection. A socket that
      // connects without identity has no room it could legitimately join.
      client.disconnect(true);
      return;
    }

    const authenticated = await this.auth.authenticate(token);
    if (!authenticated || !authenticated.actor.isActive) {
      client.disconnect(true);
      return;
    }

    client.actor = authenticated.actor;
    client.accountId = authenticated.accountId;
    client.sessionId = authenticated.sessionId;

    // Every socket joins its own actor room, so multi-device fan-out is free.
    // The room is named from the RESOLVED actor, never from anything the client
    // sent, so a forged handshake field cannot place a socket in another
    // actor's room.
    await client.join(room.actor(authenticated.actor.actorId));
    await this.presence.online(authenticated.actor.actorId, client.id);
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
