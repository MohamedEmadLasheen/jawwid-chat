import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type KnowledgeArticle } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { IdentityAwareService } from '../identity-aware.service';
import { Permission } from '../../platform/rbac/permissions';
import { CommError, CommErrorCode } from '../../platform/errors';
import { IDENTITY_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';

export interface KnowledgeInput {
  title: string;
  question: string;
  answer: string;
  category?: string;
  locale?: string;
}

/**
 * Approved knowledge: authoring, approval and retrieval.
 *
 * The retrieval half (`searchApproved`) is the one the assistant depends on,
 * and it is deliberately the smallest thing that works: PostgreSQL full-text
 * search over an approved, locale-filtered set. Phase 7 §38 rules out a vector
 * database until the architecture genuinely needs one, and a curated FAQ of
 * tens to hundreds of entries does not -- word overlap finds "كورس تأسيس" in
 * the article whose question is "هل عندكم كورس تأسيس؟".
 *
 * The seam is here rather than at the call site, so replacing this with
 * embeddings later changes this one method.
 */
@Injectable()
export class KnowledgeService extends IdentityAwareService {
  constructor(
    prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) identity: IdentityService,
    private readonly authz: AuthorizationService,
  ) {
    super(prisma, identity);
  }

  /**
   * The grounding set.
   *
   * Note what it does NOT take: an actor. Grounding is filtered by approval and
   * locale, not by who is asking -- approved knowledge is academy policy, the
   * same for every staff member. The caller has already checked that the actor
   * may use the assistant at all; narrowing again here would imply a
   * per-supervisor view of academy policy that does not exist.
   */
  async searchApproved(query: string, locale: string, limit: number): Promise<KnowledgeArticle[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // plainto_tsquery rather than to_tsquery: it takes the parent's words
    // literally and cannot be made to throw by punctuation, which matters
    // because this string came from a message.
    return this.prisma.$queryRaw<KnowledgeArticle[]>`
      SELECT a.*
      FROM chat.knowledge_article a
      WHERE a.status = 'approved'
        AND a.locale = ${locale}
        AND a.search_vector @@ plainto_tsquery('simple', ${trimmed})
      ORDER BY ts_rank(a.search_vector, plainto_tsquery('simple', ${trimmed})) DESC,
               a.updated_at DESC
      LIMIT ${limit}
    `;
  }

  async list(
    actorId: string,
    filter: { status?: string; locale?: string; category?: string } = {},
  ): Promise<KnowledgeArticle[]> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.KNOWLEDGE_READ);
    // A reader without KNOWLEDGE_MANAGE sees approved articles only, matching
    // the RLS policy. Stated here as well so the API answers the same way when
    // it runs on the owner connection.
    const canSeeDrafts = this.authz.hasPermission(actor, Permission.KNOWLEDGE_MANAGE);

    return this.prisma.knowledgeArticle.findMany({
      where: {
        status: filter.status ?? (canSeeDrafts ? undefined : 'approved'),
        ...(canSeeDrafts ? {} : { status: 'approved' }),
        locale: filter.locale,
        category: filter.category,
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async get(actorId: string, id: string): Promise<KnowledgeArticle> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.KNOWLEDGE_READ);
    const article = await this.prisma.knowledgeArticle.findUnique({ where: { id } });
    if (!article) throw new CommError(CommErrorCode.KNOWLEDGE_NOT_FOUND, 'no such article', 404);
    if (
      article.status !== 'approved' &&
      !this.authz.hasPermission(actor, Permission.KNOWLEDGE_MANAGE)
    ) {
      // Same code as a missing row. A reader who could tell "exists but is a
      // draft" from "does not exist" would learn what the academy is currently
      // drafting, which is not theirs to know.
      throw new CommError(CommErrorCode.KNOWLEDGE_NOT_FOUND, 'no such article', 404);
    }
    return article;
  }

  async create(actorId: string, input: KnowledgeInput, reason: string): Promise<KnowledgeArticle> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.KNOWLEDGE_MANAGE);
    this.requireReason(reason);

    return this.withReason(reason, (tx) =>
      tx.knowledgeArticle.create({
        data: {
          title: input.title.trim(),
          question: input.question.trim(),
          answer: input.answer.trim(),
          category: input.category?.trim() || 'general',
          locale: input.locale ?? 'ar',
          // Always a draft. Publishing is a second, separately authorized act
          // even when one person holds both keys.
          status: 'draft',
          createdBy: actor.actorId,
          updatedBy: actor.actorId,
        },
      }),
    );
  }

  async update(
    actorId: string,
    id: string,
    patch: Partial<KnowledgeInput>,
    reason: string,
  ): Promise<KnowledgeArticle> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.KNOWLEDGE_MANAGE);
    this.requireReason(reason);

    const existing = await this.prisma.knowledgeArticle.findUnique({ where: { id } });
    if (!existing) throw new CommError(CommErrorCode.KNOWLEDGE_NOT_FOUND, 'no such article', 404);
    if (existing.status === 'approved') {
      throw new CommError(
        CommErrorCode.KNOWLEDGE_APPROVED_IS_FROZEN,
        'an approved article is retired or returned to draft before it is edited',
        409,
      );
    }

    return this.withReason(reason, (tx) =>
      tx.knowledgeArticle.update({
        where: { id },
        data: {
          title: patch.title?.trim(),
          question: patch.question?.trim(),
          answer: patch.answer?.trim(),
          category: patch.category?.trim(),
          locale: patch.locale,
          updatedBy: actor.actorId,
        },
      }),
    );
  }

  /** Publish. The act that makes an article quotable to a family. */
  async approve(actorId: string, id: string, reason: string): Promise<KnowledgeArticle> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.KNOWLEDGE_APPROVE);
    this.requireReason(reason);

    const existing = await this.prisma.knowledgeArticle.findUnique({ where: { id } });
    if (!existing) throw new CommError(CommErrorCode.KNOWLEDGE_NOT_FOUND, 'no such article', 404);

    return this.withReason(reason, (tx) =>
      tx.knowledgeArticle.update({
        where: { id },
        data: {
          status: 'approved',
          approvedBy: actor.actorId,
          approvedAt: new Date(),
          updatedBy: actor.actorId,
        },
      }),
    );
  }

  /**
   * Retire, never delete. A deleted article makes every summary and every
   * answer that cited it unresolvable, and the point of citing was to be able
   * to go and read what was said.
   */
  async retire(actorId: string, id: string, reason: string): Promise<KnowledgeArticle> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.KNOWLEDGE_APPROVE);
    this.requireReason(reason);

    const existing = await this.prisma.knowledgeArticle.findUnique({ where: { id } });
    if (!existing) throw new CommError(CommErrorCode.KNOWLEDGE_NOT_FOUND, 'no such article', 404);

    return this.withReason(reason, (tx) =>
      tx.knowledgeArticle.update({
        where: { id },
        data: { status: 'inactive', updatedBy: actor.actorId },
      }),
    );
  }

  async revisions(actorId: string, id: string) {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.KNOWLEDGE_MANAGE);
    return this.prisma.knowledgeRevision.findMany({
      where: { articleId: id },
      orderBy: { version: 'desc' },
    });
  }

  private requireReason(reason: string): void {
    if (!reason?.trim()) {
      throw new CommError(
        CommErrorCode.KNOWLEDGE_REASON_REQUIRED,
        'a knowledge change requires a reason',
        400,
      );
    }
  }

  /**
   * Runs a write with the reason visible to chat.knowledge_write_revision.
   *
   * `set_config(..., true)` is transaction-local, so the setting cannot leak
   * into the next statement on a pooled connection and label an unrelated
   * change with somebody else's reason.
   */
  private async withReason<T>(
    reason: string,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('chat.knowledge_change_reason', ${reason.trim()}, true)`;
      return write(tx);
    });
  }
}
