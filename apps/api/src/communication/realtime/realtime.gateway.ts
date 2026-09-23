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
import { AuthService } from '../../platform/auth/auth.service';
import { Actor } from '../../platform/types';
import { CommEvent, CommEventName, CommEventPayloads, room } from '../contracts/events';
import { RealtimePublisher } from './realtime.publisher';
import { TypingService } from './typing.service';
import { PresenceService } from './presence.service';
import { MessageService } from '../messages/message.service';
import { ConversationService } from '../conversations/conversation.service';
import { ReceiptState } from '../contracts/vocab';
import { bearerToken } from '../../platform/auth/auth.guard';

interface AuthedSocket extends Socket {
  actor?: Actor;
  /** chat.session.id behind this connection. Revoking it ends the socket. */
  sessionId?: string;
}

/**
 * Socket.IO gateway. Horizontal scaling uses the Redis adapter (wired in main.ts),
 * so a message sent on one node reaches sockets held by every other node.
 *
 * AUTHENTICATION: the handshake carries `auth: { token }` -- the SAME access
 * token the HTTP Authorization header carries -- and it is verified by the SAME
 * AuthService.authenticate() the global HTTP guard uses. There is one verifier
 * in this codebase and one definition of who a caller is; a socket-specific
 * copy would be a second place for those two answers to drift apart.
 *
 * This replaces the RT-001 seam, in which the client named its own actor id and
 * the server believed it. That seam is why platform/identity-seam.ts refused to
 * let the process start outside a local environment -- which also meant realtime
 * notifications could never reach a parent in production. Both are now closed.
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
    private readonly auth: AuthService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    // The same credential and the same verifier as HTTP. authenticate() checks
    // the signature, the issuer, the audience and the expiry, then re-resolves
    // the actor from the database and refuses if the token's claim and the
    // database disagree -- so a revoked session or a deactivated account cannot
    // open a socket even with a syntactically valid token.
    const token = RealtimeGateway.handshakeToken(client);
    const authenticated = token ? await this.auth.authenticate(token) : null;

    if (!authenticated) {
      // No reason is sent back. A client that can distinguish "expired" from
      // "revoked" from "no such session" learns which session ids are real.
      client.disconnect(true);
      return;
    }

    client.actor = authenticated.actor;
    client.sessionId = authenticated.sessionId;
    // Every socket joins its own actor room, so multi-device fan-out is free:
    // one emit reaches the parent's phone, their tablet and their browser.
    await client.join(room.actor(authenticated.actor.actorId));
    await this.presence.online(authenticated.actor.actorId, client.id);
    void this.auth.touchSession(authenticated.sessionId);
  }

  /**
   * The handshake credential.
   *
   * `auth.token` is the documented place (API-CONTRACT §4). The Authorization
   * header is accepted too because a browser cannot set arbitrary headers on a
   * WebSocket upgrade but CAN on the Socket.IO polling transport, and a client
   * that falls back to polling must not silently lose its identity.
   *
   * A query parameter is deliberately NOT accepted: query strings end up in
   * access logs and proxy logs, and an access token in a log file is a
   * credential leak that outlives the session.
   */
  static handshakeToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

    const header = client.handshake.headers?.authorization;
    return bearerToken(header);
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    if (!client.actor) return;
    await this.presence.offline(client.actor.actorId, client.id);
    // A closed socket is not viewing anything. Without this, a backgrounded app
    // would keep suppressing its own pushes until the TTL expired.
    await this.presence.leaveConversation(client.actor.actorId, client.id);
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
    // Remember WHICH thread this socket is on, so a message arriving in it does
    // not also buzz the phone the parent is already reading it on.
    await this.presence.enterConversation(actor.actorId, body.conversationId, client.id);
    return { ok: true };
  }

  @SubscribeMessage('conversation.unsubscribe')
  async unsubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.conversationId) return { ok: false };
    await client.leave(room.conversation(body.conversationId));
    if (client.actor) await this.presence.leaveConversation(client.actor.actorId, client.id);
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
