import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE, OBJECT_STORAGE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import type { IdentityService } from '../../platform/identity.service';
import type { ObjectStorage, UploadAuthorization } from '../attachments/object-storage';
import type { Actor } from '../../platform/types';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { StoryMediaKind, StoryState } from '../contracts/vocab';
import { StoryAudienceResolver, type AudienceClause } from './story-audience.resolver';

export interface CreateStoryInput {
  title?: string | null;
  body?: string | null;
  mediaObjectKey?: string | null;
  mediaKind?: string | null;
  mediaMime?: string | null;
  audiences: AudienceClause[];
}

/** What a READER is told about a story. Deliberately narrow. */
export interface StoryFeedItem {
  id: string;
  title: string | null;
  body: string | null;
  mediaKind: string | null;
  /** Signed, short-lived, minted per read. Never stored, never a public URL. */
  mediaUrl: string | null;
  publishedAt: string;
  expiresAt: string;
  viewed: boolean;
}

/** What a PUBLISHER is told. Adds the audience and the counts. */
export interface StoryAdminItem extends Omit<StoryFeedItem, 'viewed' | 'publishedAt' | 'expiresAt'> {
  state: string;
  publishedAt: string | null;
  expiresAt: string | null;
  createdBy: string;
  audiences: Array<{ kind: string; refId: string | null }>;
  recipientCount: number;
  viewCount: number;
}

export interface StoryViewer {
  actorId: string;
  displayName: string;
  actorKind: string;
  viewedAt: string;
}

/**
 * STORIES.
 *
 * A short-lived publication from the academy to a chosen slice of its people.
 *
 * ## Where authorization happens
 *
 * HERE. Every route resolves the caller through IdentityService and asks
 * AuthorizationService, exactly like messaging and calling do. RLS on the story
 * tables is the second layer (docs/security/RLS-STRATEGY.md section 2) and is
 * inert until the API sets an actor context, so nothing in this file may lean on
 * it. Every query below is scoped on its own.
 *
 * ## The three properties that matter
 *
 * PUBLISHING IS RESTRICTED to the family-facing staff roles, decided by
 * `authz.canPublishStory`. Nothing here reads a role name off a request.
 *
 * VISIBILITY IS SERVER-RESOLVED. A reader's feed is a join through their own
 * chat.story_recipient rows. There is no code path that fetches stories and then
 * filters them -- on the server or on a client -- because being a recipient IS
 * the join. A client cannot ask for somebody else's feed: `feed()` takes the
 * authenticated actor id and nothing else.
 *
 * EXPIRY IS AN ACCESS INVARIANT, NOT A JOB. Every read requires
 * `expiresAt > now()`. The sweep that flips state to `expired` is bookkeeping and
 * media retention; if it never ran, no story would outlive its expiry by a
 * single request. That is the difference between expiration and cleanup.
 */
@Injectable()
export class StoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audience: StoryAudienceResolver,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------

  /**
   * Authorize a story media upload.
   *
   * Reuses the existing object-storage seam unchanged: same interface, same
   * private bucket, same signed short-lived URLs bound to the MIME type and byte
   * size they were issued for. The only thing that differs from an attachment is
   * the key prefix. There is no second upload pipeline.
   *
   * The returned objectKey is a NAME, not a capability. Holding it lets nobody
   * read anything: reads are minted per request by `signMedia`, and only for a
   * story the caller was already permitted to see.
   */
  async authorizeMediaUpload(
    actorId: string,
    params: { mimeType: string; byteSize: number },
  ): Promise<UploadAuthorization> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);

    if (!STORY_MEDIA_TYPES.test(params.mimeType)) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        `mime type ${params.mimeType} is not allowed for story media`,
        400,
      );
    }
    const max = params.mimeType.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!Number.isFinite(params.byteSize) || params.byteSize <= 0 || params.byteSize > max) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TOO_LARGE,
        `story media must be between 1 and ${max} bytes`,
        400,
      );
    }

    return this.storage.authorizeUpload({
      prefix: 'stories',
      mimeType: params.mimeType,
      byteSize: params.byteSize,
    });
  }

  // -------------------------------------------------------------------------
  // Compose and publish
  // -------------------------------------------------------------------------

  /**
   * Create a story as a DRAFT, with its audience validated but not materialised.
   *
   * Validating now and resolving at publish is deliberate. Validation is what
   * tells the author "you cannot address that group" while they are still
   * composing; resolution is a snapshot of who exists, and taking it at creation
   * would mean a story drafted on Monday and published on Thursday goes to
   * Monday's families.
   */
  async create(actorId: string, input: CreateStoryInput): Promise<StoryAdminItem> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);

    const body = (input.body ?? '').trim();
    const hasMedia = Boolean(input.mediaObjectKey);

    if (body.length === 0 && !hasMedia) {
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
    if (hasMedia && !isStoryMediaKind(input.mediaKind)) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        'story media must declare a kind of "image" or "video"',
        400,
      );
    }

    // Resolved here purely to VALIDATE the clauses against the author's scope.
    // The result is discarded; publish() resolves again for real.
    await this.audience.resolve(actor, input.audiences);

    const created = await this.prisma.$transaction(async (tx) => {
      const story = await tx.story.create({
        data: {
          ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
          title: input.title?.trim() || null,
          body: body || null,
          mediaObjectKey: input.mediaObjectKey ?? null,
          mediaKind: hasMedia ? input.mediaKind : null,
          mediaMime: hasMedia ? (input.mediaMime ?? null) : null,
          state: StoryState.DRAFT,
          createdBy: actor.actorId,
        },
      });

      await tx.storyAudience.createMany({
        data: input.audiences.map((a) => ({
          storyId: story.id,
          kind: a.kind,
          refId: a.refId ?? null,
        })),
        skipDuplicates: true,
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'story.created',
        entity: 'story',
        entityId: story.id,
        after: { audiences: input.audiences, hasMedia },
        reason: 'story drafted',
      });

      return story;
    });

    return this.adminItem(created.id, actor);
  }

  /**
   * Publish: resolve the audience to people, write the recipient rows, go live.
   *
   * The resolution and the state change are ONE transaction. A story that went
   * `published` without its recipients would be visible to nobody and
   * unfixable by retrying, because the retry would find it already published.
   */
  async publish(storyId: string, actorId: string): Promise<StoryAdminItem> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);

    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...this.orgScope(actor) },
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
    if (story.state === StoryState.EXPIRED) {
      throw new CommError(CommErrorCode.STORY_EXPIRED, 'this story has expired', 410);
    }
    // Only the author, or a manager, publishes somebody else's draft: an admin
    // must not push another admin's unfinished story to their families.
    if (story.createdBy !== actor.actorId && actor.staffRole !== 'manager') {
      throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    }

    // Resolved AGAIN, under the publisher's live scope at this instant. A draft
    // authored last week by somebody who has since lost a family does not
    // publish to that family.
    const resolved = await this.audience.resolve(
      actor,
      story.audiences.map((a) => ({ kind: a.kind, refId: a.refId })),
    );
    if (resolved.recipients.length === 0) {
      throw new CommError(
        CommErrorCode.STORY_AUDIENCE_EMPTY,
        'this audience resolves to nobody you may address',
        400,
      );
    }

    const lifetimeHours = Number(await this.config.get('story.default_lifetime_hours'));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + lifetimeHours * 3_600_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.storyRecipient.createMany({
        data: resolved.recipients.map((r) => ({
          storyId,
          actorId: r.actorId,
          actorKind: r.actorKind,
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
        publishedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        hasMedia: story.mediaObjectKey !== null,
        recipientCount: resolved.recipients.length,
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'story.published',
        entity: 'story',
        entityId: storyId,
        after: {
          recipientCount: resolved.recipients.length,
          familyCount: resolved.familyCount,
          expiresAt: expiresAt.toISOString(),
        },
        reason: 'story published to a resolved audience',
      });
    });

    return this.adminItem(storyId, actor);
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * The reader's feed.
   *
   * ONE query, joined through the reader's OWN recipient rows. Note what is
   * absent: no "fetch all and filter", no audience evaluation per story, and no
   * branch that could return a story the reader is not a recipient of -- because
   * being a recipient is the join. `expiresAt > now` and `deletedAt = null` are
   * in the same WHERE, so an expired or deleted story is not merely hidden from
   * the UI, it is not returned.
   */
  async feed(actorId: string): Promise<StoryFeedItem[]> {
    const actor = await this.requireActor(actorId);
    const decision = this.authz.canReadStories(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const pageSize = Number(await this.config.get('story.feed_page_size'));
    const now = new Date();

    const stories = await this.prisma.story.findMany({
      where: {
        state: StoryState.PUBLISHED,
        expiresAt: { gt: now },
        deletedAt: null,
        recipients: { some: { actorId: actor.actorId } },
        ...this.orgScope(actor),
      },
      orderBy: { publishedAt: 'desc' },
      take: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 50,
      include: { views: { where: { actorId: actor.actorId }, select: { actorId: true } } },
    });

    return Promise.all(
      stories.map(async (s) => ({
        id: s.id,
        title: s.title,
        body: s.body,
        mediaKind: s.mediaKind,
        mediaUrl: await this.signMedia(s),
        publishedAt: s.publishedAt!.toISOString(),
        expiresAt: s.expiresAt!.toISOString(),
        viewed: s.views.length > 0,
      })),
    );
  }

  /** The publisher's list: their organization's stories with delivery counts. */
  async list(actorId: string, includeDrafts = true): Promise<StoryAdminItem[]> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);

    const stories = await this.prisma.story.findMany({
      where: {
        state: includeDrafts
          ? { not: StoryState.DELETED }
          : { in: [StoryState.PUBLISHED, StoryState.EXPIRED] },
        ...this.orgScope(actor),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { audiences: true, _count: { select: { recipients: true, views: true } } },
    });

    return Promise.all(stories.map((s) => this.toAdminItem(s)));
  }

  /**
   * Record that somebody watched a story.
   *
   * Audience membership is re-checked HERE and again by a database trigger,
   * because without it this route is an existence oracle: post story ids until
   * one succeeds and you have enumerated the academy's publications. Every
   * refusal returns the same STORY_NOT_FOUND for the same reason.
   *
   * Idempotent by the composite primary key: watching twice is watching.
   */
  async markViewed(storyId: string, actorId: string): Promise<{ ok: true }> {
    const actor = await this.requireActor(actorId);
    const decision = this.authz.canReadStories(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const story = await this.prisma.story.findFirst({
      where: {
        id: storyId,
        // The recipient join is part of the lookup, not a check after it. A
        // non-recipient gets "not found" and learns nothing about whether the
        // id exists.
        recipients: { some: { actorId: actor.actorId } },
      },
      select: { id: true, state: true, expiresAt: true, deletedAt: true },
    });
    if (!story) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);

    if (story.deletedAt) {
      throw new CommError(CommErrorCode.STORY_DELETED, 'this story was removed', 410);
    }
    if (story.state !== StoryState.PUBLISHED) {
      if (story.state === StoryState.EXPIRED) {
        throw new CommError(CommErrorCode.STORY_EXPIRED, 'this story has expired', 410);
      }
      throw new CommError(CommErrorCode.STORY_NOT_PUBLISHED, 'story is not published', 409);
    }
    // Checked against the clock, not against the state column: the sweep may not
    // have run yet, and that must not buy anybody an extra view.
    if (!story.expiresAt || story.expiresAt <= new Date()) {
      throw new CommError(CommErrorCode.STORY_EXPIRED, 'this story has expired', 410);
    }

    await this.prisma.storyView.createMany({
      data: [{ storyId, actorId: actor.actorId }],
      skipDuplicates: true,
    });
    return { ok: true };
  }

  /**
   * Who viewed a story.
   *
   * Publisher-only, and scoped to their own organization. Names are resolved
   * through IdentityService so the response carries a display name and an opaque
   * id -- never a phone number or an email, which the Actor contract does not
   * carry at all.
   */
  async viewers(storyId: string, actorId: string): Promise<StoryViewer[]> {
    const actor = await this.requireActor(actorId);
    const decision = this.authz.canReadStoryViewers(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    // Scoped lookup first: a publisher in another academy gets "not found"
    // rather than an empty list, which would confirm the id exists.
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...this.orgScope(actor) },
      select: { id: true },
    });
    if (!story) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);

    const views = await this.prisma.storyView.findMany({
      where: { storyId },
      orderBy: { viewedAt: 'desc' },
      take: 500,
    });

    const out: StoryViewer[] = [];
    for (const v of views) {
      const viewer = await this.identity.resolveActor(v.actorId);
      out.push({
        actorId: v.actorId,
        displayName: viewer?.displayName ?? 'Unknown',
        actorKind: viewer?.kind ?? 'unknown',
        viewedAt: v.viewedAt.toISOString(),
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  /**
   * Remove a story.
   *
   * A soft delete, which is this schema's convention everywhere: the row is the
   * audit trail of what the academy published and is never destroyed. What ends
   * immediately is ACCESS -- `deletedAt` is in the feed's WHERE and in the RLS
   * read policy, so the story leaves every reader's feed on the next request. The
   * media bytes are purged by the retention sweep, on the same window an expiry
   * uses, so an operator who removes the wrong story has a bounded interval in
   * which the content can still be recovered.
   *
   * Idempotent: deleting an already-deleted story returns the same answer rather
   * than a conflict, because the caller's intent is already satisfied.
   */
  async remove(
    storyId: string,
    actorId: string,
    reason: string,
  ): Promise<{ ok: true; alreadyDeleted: boolean }> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);

    const trimmed = (reason ?? '').trim();
    if (trimmed.length === 0) {
      throw new CommError(
        CommErrorCode.STORY_DELETE_REASON_REQUIRED,
        'deleting a story requires a reason',
        400,
      );
    }

    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...this.orgScope(actor) },
      select: { id: true, state: true, createdBy: true },
    });
    if (!story) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);

    // Same rule as publishing: your own, or a manager's prerogative.
    if (story.createdBy !== actor.actorId && actor.staffRole !== 'manager') {
      throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    }
    if (story.state === StoryState.DELETED) return { ok: true, alreadyDeleted: true };

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.story.update({
        where: { id: storyId },
        data: {
          state: StoryState.DELETED,
          deletedAt: now,
          deletedBy: actor.actorId,
          deletedReason: trimmed,
        },
      });

      await this.outbox.enqueue(tx, CommEvent.STORY_RETIRED, {
        storyId,
        reason: 'deleted',
        at: now.toISOString(),
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'story.deleted',
        entity: 'story',
        entityId: storyId,
        before: { state: story.state },
        after: { state: StoryState.DELETED },
        reason: trimmed,
      });
    });

    return { ok: true, alreadyDeleted: false };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requireActor(actorId: string): Promise<Actor> {
    const actor = await this.identity.resolveActor(actorId);
    if (!actor) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor', 401);
    return actor;
  }

  private requirePublisher(actor: Actor): void {
    const decision = this.authz.canPublishStory(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
  }

  /**
   * Tenant filter for every story query.
   *
   * Applied in the service because RLS is inert today: the restrictive
   * organization policy on chat.story is the second layer, not the first.
   * SYSTEM_ACTOR belongs to no organization, hence the conditional.
   */
  private orgScope(actor: Actor): { organizationId?: string } {
    return actor.organizationId ? { organizationId: actor.organizationId } : {};
  }

  /**
   * A signed read URL, minted per request, or null.
   *
   * Returns null once the bytes have been purged, so a client is told "no media"
   * instead of being handed a URL that will 404. Never called for a story the
   * caller was not already authorized to see.
   */
  private async signMedia(story: {
    mediaObjectKey: string | null;
    mediaPurgedAt: Date | null;
  }): Promise<string | null> {
    if (!story.mediaObjectKey || story.mediaPurgedAt) return null;
    const ttl = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);
    return this.storage.signedReadUrl(story.mediaObjectKey, ttl);
  }

  private async adminItem(storyId: string, actor: Actor): Promise<StoryAdminItem> {
    const s = await this.prisma.story.findFirst({
      where: { id: storyId, ...this.orgScope(actor) },
      include: { audiences: true, _count: { select: { recipients: true, views: true } } },
    });
    if (!s) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    return this.toAdminItem(s);
  }

  private async toAdminItem(s: {
    id: string;
    title: string | null;
    body: string | null;
    mediaKind: string | null;
    mediaObjectKey: string | null;
    mediaPurgedAt: Date | null;
    state: string;
    publishedAt: Date | null;
    expiresAt: Date | null;
    createdBy: string;
    audiences: Array<{ kind: string; refId: string | null }>;
    _count: { recipients: number; views: number };
  }): Promise<StoryAdminItem> {
    return {
      id: s.id,
      title: s.title,
      body: s.body,
      mediaKind: s.mediaKind,
      mediaUrl: await this.signMedia(s),
      state: s.state,
      publishedAt: s.publishedAt?.toISOString() ?? null,
      expiresAt: s.expiresAt?.toISOString() ?? null,
      createdBy: s.createdBy,
      audiences: s.audiences.map((a) => ({ kind: a.kind, refId: a.refId })),
      recipientCount: s._count.recipients,
      viewCount: s._count.views,
    };
  }
}

/**
 * Story media types, matching the attachment policy's shape. Narrower than the
 * attachment list on purpose: a story is an image or a short video, never a PDF.
 */
const STORY_MEDIA_TYPES = /^(image\/(jpeg|png|webp|heic)|video\/(mp4|quicktime|webm))$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function isStoryMediaKind(kind: string | null | undefined): boolean {
  return kind === StoryMediaKind.IMAGE || kind === StoryMediaKind.VIDEO;
}
