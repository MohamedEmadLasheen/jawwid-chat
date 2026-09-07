import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { IDENTITY_SERVICE } from '../platform/tokens';
import type { IdentityService } from '../platform/identity.service';
import type { Actor } from '../platform/types';
import { ActorKind } from '../communication/contracts/vocab';
import { actorHasPermission } from '../platform/types';
import { CommError, CommErrorCode } from '../platform/errors';

/**
 * The shared front door for every Phase 7 service.
 *
 * Two rules, in one place, so no assistant surface can be the one that forgot:
 *
 *  1. the actor is RESOLVED from the session, never read from the request; and
 *  2. the permission is checked SERVER-SIDE before any work begins (§32).
 *
 * `requireStaff` and not `requireActor`, because every Phase 7 surface is a
 * staff assistant. A parent or a teacher reaching one of these endpoints is
 * refused here rather than three layers down, where the refusal would depend on
 * a permission set they simply do not hold and the code would read as if the
 * call were expected.
 */
@Injectable()
export abstract class IdentityAwareService {
  /**
   * Constructor injection rather than a property `@Inject`, matching
   * ConversationService. It costs each subclass one parameter and buys a
   * service that can be constructed directly in a unit test -- which is where
   * the grounding and no-auto-send rules are cheapest to prove.
   */
  constructor(
    protected readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  protected async requireStaff(actorId: string): Promise<Actor> {
    const actor = await this.identity.resolveActor(actorId);
    if (!actor) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    if (!actor.isActive) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'this account is not active', 403);
    }
    if (actor.kind !== ActorKind.STAFF) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        'the assistant is a staff surface',
        403,
      );
    }
    return actor;
  }

  protected require(actor: Actor, permission: string): void {
    if (!actorHasPermission(actor, permission)) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        `this action requires ${permission}`,
        403,
      );
    }
  }
}
