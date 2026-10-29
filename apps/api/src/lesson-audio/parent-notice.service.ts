import { Injectable } from '@nestjs/common';
import { ActorKind } from '../communication/contracts/vocab';
import { CommError, CommErrorCode } from '../platform/errors';
import { PrismaService } from '../platform/prisma.service';
import { currentImpersonationId } from '../platform/request-context';
import type { Actor } from '../platform/types';
import { PARENT_NOTICES, acknowledgeParentNotice, acknowledgedParentNotices, isParentNoticeKey } from './parent-notices';

/**
 * PD-48: the notices a signed-in PARENT has still to acknowledge, and the one
 * write that acknowledges them. A teacher (or anyone else who is not a family
 * contact) has none and acknowledges none: the notice is the parents' alone, and
 * the child's lesson screen shows nothing.
 *
 * A PD-21 support session (an administrator acting as the parent) is shown no
 * notice and acknowledges none: the acknowledgement is the parent's own. The
 * support-session interceptor already refuses the POST; this holds it here too.
 */
@Injectable()
export class ParentNoticeService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: Actor): Promise<{ notices: Array<{ key: string; version: number; acknowledged: boolean }> }> {
    if (actor.kind !== ActorKind.CONTACT || currentImpersonationId()) return { notices: [] };
    const done = await acknowledgedParentNotices(this.prisma, actor.actorId);
    return {
      notices: Object.entries(PARENT_NOTICES).map(([key, version]) => ({
        key,
        version,
        acknowledged: done.some((d) => d.key === key && d.version === version),
      })),
    };
  }

  async acknowledge(actor: Actor, key: string, body: Record<string, unknown>): Promise<{ key: string; version: number; acknowledged: true }> {
    if (actor.kind !== ActorKind.CONTACT) throw new CommError(CommErrorCode.LESSON_AUDIO_DENIED, 'only a parent acknowledges a parent notice');
    if (currentImpersonationId()) {
      throw new CommError(CommErrorCode.SUPPORT_SESSION_FORBIDDEN, 'only the parent acknowledges a parent notice, never a support session');
    }
    if (!isParentNoticeKey(key)) throw new CommError(CommErrorCode.LESSON_AUDIO_NOT_FOUND, `no notice ${key}`);
    const version = PARENT_NOTICES[key];
    // The version the parent was SHOWN: an app showing an older text acknowledges nothing.
    if (body.version !== version) throw new CommError(CommErrorCode.LESSON_AUDIO_STATE, `the current ${key} notice is version ${version}; show it, then acknowledge`, 409);
    await acknowledgeParentNotice(this.prisma, actor.actorId, key, version);
    return { key, version, acknowledged: true };
  }
}
