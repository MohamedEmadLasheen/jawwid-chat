import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Thread, ThreadKind } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { IDENTITY_SERVICE, COVERAGE_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { CoverageService } from '../../platform/coverage.service';
import { Actor } from '../../platform/types';
import { ThreadDto, toThreadDto, conversationState } from '../contracts/dto';

@Injectable()
export class ThreadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(COVERAGE_SERVICE) private readonly coverage: CoverageService,
  ) {}

  async requireActor(userId: string): Promise<Actor> {
    const actor = await this.identity.resolveActor(userId);
    if (!actor) {
      throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    }
    return actor;
  }

  /**
   * Get-or-create the single family thread.
   *
   * There is exactly one customer-facing thread per family and it is created on
   * demand, never duplicated. Brief section 12: "thread is UNIQUE per family;
   * cases never create a second thread." A coverage change or a handler change
   * does NOT create a new thread - the relationship belongs to the family.
   */
  async getOrCreateFamilyThread(familyId: string, tx?: Prisma.TransactionClient): Promise<Thread> {
    const db = tx ?? this.prisma;
    const existing = await db.thread.findUnique({
      where: { familyId_kind: { familyId, kind: ThreadKind.FAMILY } },
    });
    if (existing) return existing;

    try {
      return await db.thread.create({ data: { familyId, kind: ThreadKind.FAMILY } });
    } catch (e) {
      // Lost a race with a concurrent create; the unique constraint is the
      // source of truth, so re-read rather than trusting our own check.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const t = await db.thread.findUnique({
          where: { familyId_kind: { familyId, kind: ThreadKind.FAMILY } },
        });
        if (t) return t;
      }
      throw e;
    }
  }

  async getThreadForActor(threadId: string, userId: string): Promise<ThreadDto> {
    const actor = await this.requireActor(userId);
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);

    const decision = this.authz.canReadThread(actor, thread);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    return toThreadDto(thread);
  }

  /**
   * The staff member currently responsible: sticky handler while live, else
   * on_duty(). Returns null for Unattended - never a silent assignment.
   */
  async currentHandler(thread: Thread, now = new Date()): Promise<string | null> {
    if (thread.stickyHandlerId && thread.stickyUntil && thread.stickyUntil > now) {
      return thread.stickyHandlerId;
    }
    return this.coverage.onDuty(thread.familyId, now);
  }

  /** Staff marks the conversation resolved; a new customer message reopens it. */
  async setResolved(threadId: string, userId: string, resolved: boolean): Promise<ThreadDto> {
    const actor = await this.requireActor(userId);
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);
    if (actor.kind !== 'STAFF') {
      throw new CommError(CommErrorCode.NOT_THREAD_PARTICIPANT, 'only staff may resolve');
    }
    const decision = this.authz.canReadThread(actor, thread);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: { resolvedAt: resolved ? new Date() : null },
    });
    return toThreadDto(updated);
  }

  /** Per-user preferences. Pinning by one user never affects another. */
  async setPreferences(
    threadId: string,
    userId: string,
    prefs: { archived?: boolean; pinned?: boolean; mutedUntil?: Date | null },
  ): Promise<void> {
    const actor = await this.requireActor(userId);
    const thread = await this.prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new CommError(CommErrorCode.THREAD_NOT_FOUND, 'thread not found', 404);
    const decision = this.authz.canReadThread(actor, thread);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const data: Prisma.ThreadParticipantStateUncheckedCreateInput = {
      threadId,
      userId,
      archivedAt: prefs.archived === undefined ? undefined : prefs.archived ? new Date() : null,
      pinnedAt: prefs.pinned === undefined ? undefined : prefs.pinned ? new Date() : null,
      mutedUntil: prefs.mutedUntil === undefined ? undefined : prefs.mutedUntil,
    };

    await this.prisma.threadParticipantState.upsert({
      where: { threadId_userId: { threadId, userId } },
      create: data,
      update: {
        archivedAt: data.archivedAt,
        pinnedAt: data.pinnedAt,
        mutedUntil: data.mutedUntil,
      },
    });
  }

  /** Chat list. RBAC-scoped: a contact only ever sees its own family's thread. */
  async listThreadsForActor(userId: string): Promise<ThreadDto[]> {
    const actor = await this.requireActor(userId);

    if (actor.kind === 'CONTACT') {
      if (!actor.familyId) return [];
      const t = await this.prisma.thread.findUnique({
        where: { familyId_kind: { familyId: actor.familyId, kind: ThreadKind.FAMILY } },
      });
      return t ? [toThreadDto(t)] : [];
    }

    const probe = this.authz.canReadThread(actor, { familyId: '*' });
    if (!probe.allowed) throw new CommError(probe.code, probe.reason);

    const threads = await this.prisma.thread.findMany({
      orderBy: { lastActivityAt: 'desc' },
      take: 200,
    });
    return threads.map(toThreadDto);
  }
}

export { conversationState };
