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
import { AuthService } from '../../platform/auth/auth.service';
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
  sessionId?: string;
  /** When the socket's identity was last re-validated against the database. */
  revalidatedAt?: number;
}

/**
 * How stale a socket's identity may be.
 *
 * A socket lives for hours; a revocation must not. Re-validating on every frame
 * would put a query on the typing indicator, so the identity is re-read at most
 * this often, on the frames that matter (subscribe, heartbeat). RT-009: the
 * actor used to be resolved once at connect and cached for the socket's entire
 * lifetime, so a deactivated person kept receiving messages until they
 * reconnected.
 */
const REVALIDATE_AFTER_MS = 30_000;

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
    private readonly auth: AuthService,
  ) {}

  /**
   * The socket authenticates exactly as an HTTP request does.
   *
   * Before Phase 1 the client named its own actor in `handshake.auth.actorId`
   * (RT-001 / NF-08) and nothing verified it. It now presents the same bearer
   * access token, verified by the same AuthService, so a socket can never reach
   * an identity an HTTP request could not.
   */
  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = String(
      client.handshake.auth?.token ??
        (client.handshake.headers?.authorization ?? '').toString().replace(/^Bearer /, ''),
    );
    const authenticated = token ? await this.auth.authenticate(token) : null;

    if (!authenticated || !authenticated.actor.isActive) {
      client.disconnect(true);
      return;
    }

    client.actor = authenticated.actor;
    client.sessionId = authenticated.claims.sid;
    client.revalidatedAt = Date.now();
    // Every socket joins its own actor room, so multi-device fan-out is free.
    await client.join(room.actor(authenticated.actor.actorId));
    await this.presence.online(authenticated.actor.actorId, client.id);
  }

  /**
   * Re-read the socket's identity if it has gone stale, and drop the socket if
   * the session or the principal is no longer valid.
   *
   * This is what makes "log this device out", a suspension and an offboarding
   * take effect on a connection that is already open.
   */
  private async liveActor(client: AuthedSocket): Promise<Actor | null> {
    if (!client.actor) return null;
    if (Date.now() - (client.revalidatedAt ?? 0) < REVALIDATE_AFTER_MS) return client.actor;

    const token = String(client.handshake.auth?.token ?? '');
    const authenticated = token ? await this.auth.authenticate(token) : null;
    if (!authenticated || !authenticated.actor.isActive) {
      client.disconnect(true);
      return null;
    }
    client.actor = authenticated.actor;
    client.revalidatedAt = Date.now();
    return client.actor;
  }

  /**
   * Clean up everything transient this socket owned.
   *
   * Typing is the part that matters: a socket that drops mid-word leaves its
   * Redis key behind, and until it expires every other participant sees a
   * "typing…" for somebody who is not there. The TTL bounds that to seconds,
   * but only after a disconnect the server already knew about -- so clear it
   * eagerly, and tell the room.
   */
  async handleDisconnect(client: AuthedSocket): Promise<void> {
    if (!client.actor) return;
    const actor = client.actor;

    for (const roomName of client.rooms) {
      if (!roomName.startsWith('conversation:')) continue;
      const conversationId = roomName.slice('conversation:'.length);
      if (await this.typing.stop(conversationId, actor.actorId)) {
        client.to(roomName).emit(CommEvent.TYPING_STOPPED, {
          conversationId,
          actorId: actor.actorId,
          displayName: actor.displayName,
        });
      }
    }

    await this.presence.offline(actor.actorId, client.id);
  }

  @SubscribeMessage('conversation.subscribe')
  async subscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean; code?: string; typing?: string[] }> {
    const actor = await this.liveActor(client);
    if (!actor || !body?.conversationId) return { ok: false, code: 'COMM.UNKNOWN_ACTOR' };

    const check = await this.authorize(actor, body.conversationId);
    if (!check.ok) return check;

    await client.join(room.conversation(body.conversationId));

    // Whoever is mid-sentence right now. Without this a client that joins
    // between a typing.started and its typing.stopped never learns about it,
    // and the indicator only ever appears for people who start typing AFTER
    // you open the conversation.
    const typing = (await this.typing.whoIsTyping(body.conversationId)).filter(
      (id) => id !== actor.actorId,
    );
    return { ok: true, typing };
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
    // liveActor(), not client.actor: a typing indicator is a broadcast into a
    // conversation, and a socket whose session was revoked must not be able to
    // keep announcing itself there until it happens to reconnect.
    const actor = await this.liveActor(client);
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
    // RT-009: the heartbeat is where a revoked session is noticed. liveActor()
    // disconnects the socket when the session or the principal has gone.
    const actor = await this.liveActor(client);
    if (!actor) return { ok: false };
    await this.revokeLostSubscriptions(client, actor);
    await this.presence.heartbeat(actor.actorId, client.id);
    return { ok: true };
  }

  /**
   * Remove the socket from any conversation it may no longer read.
   *
   * WHY THIS EXISTS SEPARATELY FROM liveActor(). liveActor answers "is this
   * person still who they were, and are they still allowed in at all" -- it
   * catches a revoked session, a suspended account, an offboarded colleague.
   * It does NOT catch a change of SCOPE, and scope is the thing that moves in
   * normal operation: a family is reassigned, a cover window ends, and the
   * previous supervisor is still holding a socket joined to that conversation's
   * room. Every subsequent message would be delivered to them.
   *
   * Authorization on `subscribe` is not enough for the same reason a token
   * check at login is not enough: it establishes a fact at one instant and the
   * connection outlives it.
   *
   * Exposure is therefore bounded by the heartbeat interval rather than by the
   * lifetime of the connection. The rooms are re-checked with exactly the
   * predicate canRead uses, so there is no second definition of access to keep
   * in step.
   */
  private async revokeLostSubscriptions(client: AuthedSocket, actor: Actor): Promise<void> {
    const joined = [...client.rooms].filter((r) => r.startsWith('conversation:'));
    for (const roomName of joined) {
      const conversationId = roomName.slice('conversation:'.length);
      const check = await this.authorize(actor, conversationId);
      if (check.ok) continue;

      await client.leave(roomName);
      client.emit(CommEvent.ACCESS_REVOKED, {
        conversationId,
        reason:
          check.code === 'COMM.OUT_OF_SCOPE'
            ? 'out_of_scope'
            : check.code === 'COMM.NOT_CONVERSATION_MEMBER'
              ? 'not_a_member'
              : 'session_ended',
      });
      this.log.log(`access revoked: actor=${actor.actorId} conversation=${conversationId}`);
    }
  }

  /** The client confirms it has the message on device. */
  @SubscribeMessage('message.delivered')
  async delivered(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { messageIds?: string[] },
  ): Promise<{ ok: boolean; updated: number }> {
    const actor = await this.liveActor(client);
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
      // The socket inherits supervisor scope from the same predicate the REST
      // path uses: subscribing to a conversation is reading it.
      const decision = this.authz.canRead(
        actor,
        conv,
        membership,
        await this.conversations.scopeFor(actor, conv),
      );
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
