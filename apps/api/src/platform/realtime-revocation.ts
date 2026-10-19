import { Injectable } from '@nestjs/common';
import { CommError, CommErrorCode } from './errors';

/**
 * RT-009 -- the push half of realtime revocation.
 *
 * Revocation is decided where it happens (AuthService for sessions,
 * ConversationService for membership), but it is ENFORCED on live sockets,
 * which only the RealtimeGateway holds. This port is the narrow seam between
 * the two: the deciding service calls it after its own transaction commits,
 * and the gateway -- when this process has one -- carries it out on every node
 * through the Socket.IO adapter.
 *
 * The four pushes are best-effort and never throw into the caller: a
 * revocation that has committed must not be rolled back because a socket could
 * not be reached, and none of them is what denies delivery.
 *
 * `confirmRevoked` is different: it is the COMPLETION BARRIER, and it throws.
 * A revoking operation calls it after its transaction commits and before it
 * returns; it resolves only once every API node that could still emit on a
 * decision made before the commit has been fenced (see the gateway). If that
 * cannot be established, it throws RevocationUnconfirmedError and the
 * operation must not report success.
 */
export interface RealtimeRevocation {
  /** These actors' sockets leave the conversation's room, on every node. */
  leaveConversation(actorIds: readonly string[], conversationId: string): void;
  /** Sockets that authenticated with (or were rebound to) these sessions disconnect. */
  disconnectSessions(sessionIds: readonly string[]): void;
  /** Every socket of this account disconnects. */
  disconnectAccount(accountId: string): void;
  /** A refresh rotated `from` into `to`: sockets bound to `from` now also answer to `to`. */
  sessionRotated(from: string, to: string): void;
  /**
   * Resolves once no API node can emit on a decision made before this call.
   * Call it AFTER the revocation commits. Throws RevocationUnconfirmedError
   * when that cannot be confirmed -- never resolves because a wait ran out.
   */
  confirmRevoked(): Promise<void>;
}

/**
 * The revocation is committed, but its completion could not be confirmed on
 * every node. Mapped to 503 COMM.REVOCATION_UNCONFIRMED: not a success, and
 * safe to retry.
 */
export class RevocationUnconfirmedError extends CommError {
  constructor(detail: string) {
    super(
      CommErrorCode.REVOCATION_UNCONFIRMED,
      `the change is saved, but realtime delivery could not be confirmed stopped on every server (${detail}); retry the request`,
      503,
    );
    this.name = 'RevocationUnconfirmedError';
  }
}

/**
 * What a service holds when it is built with no realtime anywhere (unit tests,
 * scripts): no node exists, so there is nothing to fence. The application
 * never uses it -- PlatformModule injects the hub below.
 */
export const NO_REALTIME_REVOCATION: RealtimeRevocation = {
  leaveConversation: () => undefined,
  disconnectSessions: () => undefined,
  disconnectAccount: () => undefined,
  sessionRotated: () => undefined,
  confirmRevoked: async () => undefined,
};

/**
 * The process-wide hub. Services depend on it; the gateway attaches itself to
 * it once Socket.IO has a server. Before that -- and in the worker, which has no
 * server -- every push is a no-op (the API nodes' delivery-time checks and
 * re-validation sweep enforce the same state), and `confirmRevoked` FAILS: a
 * process that cannot fence the cluster must not report a revocation complete.
 */
@Injectable()
export class RealtimeRevocationHub implements RealtimeRevocation {
  private target?: RealtimeRevocation;

  attach(target: RealtimeRevocation): void {
    this.target = target;
  }

  async confirmRevoked(): Promise<void> {
    // Not wrapped in `safely`: this one must reach the caller.
    if (!this.target) throw new RevocationUnconfirmedError('no realtime server in this process');
    await this.target.confirmRevoked();
  }

  leaveConversation(actorIds: readonly string[], conversationId: string): void {
    if (actorIds.length > 0) this.safely((t) => t.leaveConversation(actorIds, conversationId));
  }

  disconnectSessions(sessionIds: readonly string[]): void {
    if (sessionIds.length > 0) this.safely((t) => t.disconnectSessions(sessionIds));
  }

  disconnectAccount(accountId: string): void {
    this.safely((t) => t.disconnectAccount(accountId));
  }

  sessionRotated(from: string, to: string): void {
    this.safely((t) => t.sessionRotated(from, to));
  }

  private safely(op: (t: RealtimeRevocation) => void): void {
    if (!this.target) return;
    try {
      op(this.target);
    } catch {
      /* best-effort by contract: the sweep re-checks every socket regardless */
    }
  }
}
