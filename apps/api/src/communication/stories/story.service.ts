import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { Permission } from '../../platform/rbac/permissions';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { ObjectStorage, UploadAuthorization } from '../attachments/object-storage';
import { Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { StoryState } from '../contracts/vocab';
import { AudienceResolverService, type AudienceClause } from '../audience/audience-resolver.service';

export interface CreateStoryInput {
  title?: string | null;
  body?: string | null;
  mediaObjectKey?: string | null;
  mediaKind?: string | null;
  mediaMime?: string | null;
  audiences: AudienceClause[];
  /** Hours the story stays live. Falls back to story.default_lifetime_hours. */
  lifetimeHours?: number;
}

export interface StoryView {
  id: string;
  title: string | null;
  body: string | null;
  mediaKind: string | null;
  /** Signed, short-lived, minted per read. Never stored. */
  mediaUrl: string | null;
  state: string;
  publishedAt: string | null;
  expiresAt: string | null;
  createdBy: string;
  /** Present only for a publisher. A reader is not shown the audience. */
  audiences?: Array<{ kind: string; refId: string | null }>;
  recipientCount?: number;
  viewCount?: number;
  viewed?: boolean;
}

/**
 * STORIES.
 *
 * A short-lived publication from the academy to a chosen slice of its people.
 *
 * ## The two properties that matter
 *
 * PUBLISHING IS RESTRICTED. `stories.publish` is held by admin, manager and
 * super_admin. A teacher and a parent hold `stories.read` and nothing more, and
 * the check is `authz.can(...)` against the actor's EFFECTIVE permissions --
 * resolved from the account, with its ALLOW/DENY overrides applied. Nothing
 * here reads a role name, and nothing reads a role the client sent.
 *
 * VISIBILITY IS SERVER-RESOLVED. The audience is turned into people ONCE, by
 * the shared AudienceResolverService, into chat.story_recipient. A reader's
 * feed is then an indexed join against their own recipient rows. There is no
 * code path anywhere that fetches stories and filters them, on the server or on
 * the client, because there is no query that returns a story the reader is not
 * a recipient of -- the RLS policy on chat.story says the same thing again
 * underneath.
 *
 * Holding `stories.publish` is NECESSARY and not SUFFICIENT for any particular
 * audience: the resolver independently refuses every clause outside the
 * author's live scope. An admin therefore publishes to their own families, and
 * a manager publishes to the academy, using the same code and the same request.
 */
@Injectable()
export class StoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audience: AudienceResolverService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Authorize a media upload for a story.
   *
   * Reuses the Phase 2 object-storage seam unchanged -- same interface, same
   * private bucket, same signed short-lived URLs. Phase 5 builds no second
   * upload pipeline; the only thing that differs is the key prefix.
   */
  async authorizeMediaUpload(
    actorId: string,
    params: { mimeType: string; byteSize: number },
  ): Promise<UploadAuthorization> {
    const actor = await this.conversations.requireActor(actorId);
    this.requirePublisher(actor);

    if (!/^(image\/(jpeg|png|webp|heic)|video\/(mp4|quicktime|webm))$/.test(params.mimeType)) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        `mime type ${params.mimeType} is not allowed for a story`,
        400,
      );
    }
    const max = params.mimeType.startsWith('video/') ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
    if (params.byteSize <= 0 || params.byteSize > max) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TOO_LARGE,
        `story media exceeds the ${max} byte limit`,
        400,
      );
    }

    return this.storage.authorizeUpload({
      prefix: 'stories',
      mimeType: params.mimeType,
      byteSize: params.byteSize,
    });
  }

  /**
   * Create a story as a DRAFT, with its audience validated but not yet
   * materialised.
   *
   * Validating now and resolving at publish is deliberate. Validation is what
   * tells the author "you cannot address that label" while they are still
   * composing; resolution is a snapshot of who exists, and taking it at
   * creation would mean a story drafted on Monday and published on Thursday
   * goes to Monday's families.
   */
  async create(actorId: string, input: CreateStoryInput): Promise<StoryView> {
    const actor = await this.conversations.requireActor(actorId);
    this.requirePublisher(actor);

    const body = (input.body ?? '').trim();
    if (body.length === 0 && !input.mediaObjectKey) {
      throw new CommError(
        CommErrorCode.STORY_EMPTY,
        'a story needs a body or a piece of media',
        400,
      );
    }
    const maxLength = Number(await this.config.get('story.max_body_length'));
    if (body.length > maxLength) {
      throw new CommError(
        CommErrorCode.STORY_TOO_LONG,
        `a story body may be at most ${maxLength} characters`,
        400,
      );
    }

    // Resolved here purely to VALIDATE the clauses against the author's scope.
    // The result is discarded; publish() resolves again for real.
    await this.audience.resolve(actor, input.audiences);

    const story = await this.prisma.$transaction(async (tx) => {
      const created = await tx.story.create({
        data: {
          title: input.title?.trim() || null,
          body: body || null,
          mediaObjectKey: input.mediaObjectKey ?? null,
          mediaKind: input.mediaKind ?? null,
          mediaMime: input.mediaMime ?? null,
          state: StoryState.DRAFT,
          createdBy: actor.actorId,
        },
      });

      await tx.storyAudience.createMany({
        data: input.audiences.map((a) => ({
          storyId: created.id,
          kind: a.kind,
          refId: a.refId ?? null,
        })),
        skipDuplicates: true,
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'story.created',
        entity: 'story',
        entityId: created.id,
        after: { audiences: input.audiences },
        reason: 'story drafted',
      });

      return created;
    });

    return this.publisherView(story.id, actor);
  }

  /**
   * Publish: resolve the audience to people, write the recipient rows, and go
   * live.
   *
   * The resolution and the state change are ONE transaction. A story that went
   * `published` without its recipients would be visible to nobody and
   * unfixable by retrying, because the second attempt would find it already
   * published.
   */
  async publish(storyId: string, actorId: string): Promise<StoryView> {
    const actor = await this.conversations.requireActor(actorId);
    this.requirePublisher(actor);

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: { audiences: true },
    });
    if (!story || story.state === StoryState.DELETED) {
      throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    }
    if (story.state === StoryState.PUBLISHED) {
      throw new CommError(
        CommErrorCode.STORY_ALREADY_PUBLISHED,
        'this story is already published',
        409,
      );
    }
    // Only the author or an organization-wide role publishes somebody else's
    // draft; an admin cannot push another admin's unfinished story to their
    // families. Scope does the rest.
    if (story.createdBy !== actor.actorId && !this.isOrganizationWide(actor)) {
      throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    }

    const clauses = story.audiences.map((a) => ({ kind: a.kind, refId: a.refId }));
    // Resolved AGAIN, under the publisher's live scope at this instant. A draft
    // authored last week by somebody who has since lost a family does not
    // publish to that family.
    const resolved = await this.audience.resolve(actor, clauses);
    if (resolved.recipients.length === 0) {
      throw new CommError(
        CommErrorCode.AUDIENCE_EMPTY,
        'this audience resolves to nobody you may address',
        400,
      );
    }

    const lifetimeHours = Number(await this.config.get('story.default_lifetime_hours'));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + lifetimeHours * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.storyRecipient.createMany({
        data: resolved.recipients.map((r) => ({
          storyId,
          actorId: r.actorId,
          matchedKind: r.matchedKind,
        })),
        // The composite primary key already makes a duplicate impossible; this
        // makes a re-run converge instead of throwing.
        skipDuplicates: true,
      });

      await tx.story.update({
        where: { id: storyId },
        data: {
          state: StoryState.PUBLISHED,
          publishedAt: now,
          publishedBy: actor.actorId,
          expiresAt,
        },
      });

      await this.outbox.enqueue(tx, CommEvent.STORY_PUBLISHED, {
        storyId,
        title: story.title,
        hasMedia: story.mediaObjectKey !== null,
        publishedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'story.published',
        entity: 'story',
        entityId: storyId,
        after: {
          recipientCount: resolved.recipients.length,
          familyCount: resolved.familyIds.length,
          expiresAt: expiresAt.toISOString(),
        },
        reason: 'story published to a resolved audience',
      });
    });

    return this.publisherView(storyId, actor);
  }

  /**
   * The reader's feed.
   *
   * ONE query, joined through the reader's own recipient rows. Note what is
   * absent: no "fetch all and filter", no audience evaluation per story, and no
   * branch that could accidentally return a story the reader is not a recipient
   * of, because being a recipient is the join.
   */
  async feed(actorId: string): Promise<StoryView[]> {
    const actor = await this.conversations.requireActor(actorId);
    const decision = this.authz.can(actor, Permission.STORIES_READ);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const pageSize = Number(await this.config.get('story.feed_page_size'));
    const now = new Date();

    const stories = await this.prisma.story.findMany({
      where: {
        state: StoryState.PUBLISHED,
        expiresAt: { gt: now },
        recipients: { some: { actorId: actor.actorId } },
      },
      orderBy: { publishedAt: 'desc' },
      take: Number.isFinite(pageSize) ? pageSize : 50,
      include: { views: { where: { actorId: actor.actorId }, select: { actorId: true } } },
    });

    const out: StoryView[] = [];
    for (const s of stories) {
      out.push({
        id: s.id,
        title: s.title,
        body: s.body,
        mediaKind: s.mediaKind,
        mediaUrl: await this.signMedia(s.mediaObjectKey),
        state: s.state,
        publishedAt: s.publishedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt?.toISOString() ?? null,
        createdBy: s.createdBy,
        viewed: s.views.length > 0,
      });
    }
    return out;
  }

  /**
   * Record that somebody watched a story.
   *
   * Membership of the audience is re-checked HERE and again by a database
   * trigger, because without it this route is an existence oracle: post story
   * ids until one succeeds and you have enumerated the academy's publications.
   */
  async markViewed(storyId: string, actorId: string): Promise<{ ok: true }> {
    const actor = await this.conversations.requireActor(actorId);
    const decision = this.authz.can(actor, Permission.STORIES_READ);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const recipient = await this.prisma.storyRecipient.findUnique({
      where: { storyId_actorId: { storyId, actorId: actor.actorId } },
    });
    if (!recipient) {
      throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    }

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { state: true, expiresAt: true },
    });
    if (!story || story.state !== StoryState.PUBLISHED) {
      throw new CommError(CommErrorCode.STORY_NOT_PUBLISHED, 'story is not published', 409);
    }
    if (story.expiresAt && story.expiresAt <= new Date()) {
      throw new CommError(CommErrorCode.STORY_EXPIRED, 'this story has expired', 410);
    }

    // Idempotent by the composite primary key: watching twice is watching.
    await this.prisma.storyView.createMany({
      data: [{ storyId, actorId: actor.actorId }],
      skipDuplicates: true,
    });
    return { ok: true };
  }

  /** The publisher's list: their organization's stories with delivery counts. */
  async list(actorId: string, includeDrafts = true): Promise<StoryView[]> {
    const actor = await this.conversations.requireActor(actorId);
    this.requirePublisher(actor);

    const stories = await this.prisma.story.findMany({
      where: {
        state: includeDrafts
          ? { not: StoryState.DELETED }
          : { in: [StoryState.PUBLISHED, StoryState.EXPIRED] },
        ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        audiences: true,
        _count: { select: { recipients: true, views: true } },
      },
    });

    const out: StoryView[] = [];
    for (const s of stories) {
      out.push({
        id: s.id,
        title: s.title,
        body: s.body,
        mediaKind: s.mediaKind,
        mediaUrl: await this.signMedia(s.mediaObjectKey),
        state: s.state,
        publishedAt: s.publishedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt?.toISOString() ?? null,
        createdBy: s.createdBy,
        audiences: s.audiences.map((a) => ({ kind: a.kind, refId: a.refId })),
        recipientCount: s._count.recipients,
        viewCount: s._count.views,
      });
    }
    return out;
  }

  /**
   * Retire stories past their expiry.
   *
   * A single conditional UPDATE, so concurrent sweeps converge rather than
   * fight, and running it twice is running it once.
   */
  async expireDue(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.story.updateMany({
      where: { state: StoryState.PUBLISHED, expiresAt: { not: null, lte: now } },
      data: { state: StoryState.EXPIRED },
    });
    return result.count;
  }

  private async publisherView(storyId: string, actor: Actor): Promise<StoryView> {
    const s = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: { audiences: true, _count: { select: { recipients: true, views: true } } },
    });
    if (!s) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    return {
      id: s.id,
      title: s.title,
      body: s.body,
      mediaKind: s.mediaKind,
      mediaUrl: await this.signMedia(s.mediaObjectKey),
      state: s.state,
      publishedAt: s.publishedAt?.toISOString() ?? null,
      expiresAt: s.expiresAt?.toISOString() ?? null,
      createdBy: s.createdBy,
      audiences: s.audiences.map((a) => ({ kind: a.kind, refId: a.refId })),
      recipientCount: s._count.recipients,
      viewCount: s._count.views,
    };
  }

  private async signMedia(objectKey: string | null): Promise<string | null> {
    if (!objectKey) return null;
    const ttl = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);
    return this.storage.signedReadUrl(objectKey, ttl);
  }

  private requirePublisher(actor: Actor): void {
    const decision = this.authz.can(actor, Permission.STORIES_PUBLISH);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
  }

  private isOrganizationWide(actor: Actor): boolean {
    return actor.staffRole === 'manager' || actor.staffRole === 'super_admin';
  }
}
