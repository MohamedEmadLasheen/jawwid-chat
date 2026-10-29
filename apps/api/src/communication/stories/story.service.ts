import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MediaUrlSigner } from '../../platform/media-url';
import { PrismaService } from '../../platform/prisma.service';
import { invalidCountryMessage, isGeoForeignKeyViolation, listedCountry } from '../../geo/countries';
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
import {
  ActorKind,
  STORY_BACKGROUNDS,
  StaffRole,
  StoryCtaKind,
  StoryMediaKind,
  StoryState,
  SUBSCRIPTION_PLAN_MONTHS,
} from '../contracts/vocab';
// A VALUE import, not `import type`: Nest resolves constructor parameters from
// emitted design metadata, and a type-only import emits `Object` -- which,
// behind @Optional(), injects nothing and makes every reply tap fail silently.
import { ConversationService } from '../conversations/conversation.service';
import {
  CHILDREN_FOUR_OR_MORE,
  StoryAudienceResolver,
  type AudienceClause,
  type ResolvedRecipient,
} from './story-audience.resolver';

/** A call to action as a publisher authors it. */
export interface StoryCtaInput {
  kind: string;
  label?: string | null;
  /** link: an https URL. */
  url?: string | null;
  /** whatsapp: the ACADEMY's number, any common notation; stored as E.164 digits. */
  phone?: string | null;
}

export interface CreateStoryInput {
  /**
   * Legacy. A story carries no caption (owner rule, 2026-10-17); a non-empty
   * title is refused rather than silently dropped, so an old client learns it.
   */
  title?: string | null;
  /** The words of a TEXT story. Refused on a photo, video or voice story. */
  body?: string | null;
  /** The publisher's own label; never shown to a reader. */
  internalName?: string | null;
  background?: string | null;
  mediaObjectKey?: string | null;
  mediaKind?: string | null;
  mediaMime?: string | null;
  mediaDurationMs?: number | null;
  cta?: StoryCtaInput | null;
  audiences: AudienceClause[];
}

/** text | image | video | voice -- what the reader's viewer renders. */
export type StoryKind = 'text' | 'image' | 'video' | 'voice';

/** The call to action as a READER receives it: a label and somewhere to go. */
export interface StoryCtaDto {
  kind: string;
  /** The publisher's wording, or null for the client's default for the kind. */
  label: string | null;
  /**
   * Where the button goes, built by the server: the link itself, or a wa.me
   * link for WhatsApp. Null for message_publisher -- that one is a tap the
   * server answers with a conversation (`POST /stories/:id/cta`).
   */
  url: string | null;
}

/**
 * What a READER is told about a story. Deliberately narrow: no author, no
 * audience, no counts, no internal name -- and no caption. `body` is the words
 * of a TEXT story and nothing else.
 */
export interface StoryFeedItem {
  id: string;
  kind: StoryKind;
  body: string | null;
  background: string | null;
  mediaKind: string | null;
  /** Signed, short-lived, minted per read. Never stored, never a public URL. */
  mediaUrl: string | null;
  mediaDurationMs: number | null;
  cta: StoryCtaDto | null;
  publishedAt: string;
  /** Null: stories do not expire (2026-10-17). Set only on older stories. */
  expiresAt: string | null;
  viewed: boolean;
}

/** What a PUBLISHER is told. Adds the label, the audience and the counts. */
export interface StoryAdminItem {
  id: string;
  kind: StoryKind;
  internalName: string | null;
  /** Legacy title of a pre-2026-10-17 story, for the publisher's list only. */
  title: string | null;
  body: string | null;
  background: string | null;
  mediaKind: string | null;
  mediaUrl: string | null;
  mediaDurationMs: number | null;
  /** The authored call to action, raw: the publisher sees the number it typed. */
  cta: (StoryCtaDto & { phone: string | null }) | null;
  state: string;
  createdAt: string;
  publishedAt: string | null;
  expiresAt: string | null;
  deletedAt: string | null;
  createdBy: string;
  creatorName: string;
  audiences: Array<{ kind: string; refId: string | null; filter: unknown }>;
  recipientCount: number;
  viewCount: number;
  /** Every tap on the call to action. */
  ctaTapCount: number;
  /** Distinct people who tapped it. */
  ctaTapperCount: number;
}

export interface StoryViewer {
  actorId: string;
  displayName: string;
  actorKind: string;
  viewedAt: string;
  /** How many times this person tapped the call to action. */
  ctaTaps: number;
}

/** What a reader's tap on the call to action resolves to. */
export interface StoryCtaTapResult {
  kind: string;
  url: string | null;
  /** message_publisher: the direct conversation with the publisher, opened if new. */
  conversationId: string | null;
}

/** How many people an audience reaches, before anything is published. */
export interface StoryAudienceEstimate {
  recipients: number;
  contacts: number;
  teachers: number;
  families: number;
  /**
   * People the audience matched who are left out because replies to a
   * message-the-publisher story go to the publisher, and the publisher does
   * not supervise their family (PD-8). Zero for the super admin.
   */
  excludedByReplyScope: number;
}

/** The shape of the organization's families, for the targeting controls. Counts only. */
export interface StoryAudienceFacts {
  families: number;
  contacts: number;
  teachers: number;
  countries: Array<{ code: string; families: number }>;
  plans: Array<{ months: number; families: number }>;
  /** Bucket 4 means four or more. */
  children: Array<{ bucket: number; families: number }>;
  unknownCountry: number;
  unknownPlan: number;
  noChildren: number;
}

export interface FamilyAudienceRow {
  id: string;
  displayName: string;
  countryCode: string | null;
  subscriptionPlanMonths: number | null;
  childCount: number;
  segmentSource: string | null;
  segmentUpdatedAt: string | null;
}

export interface StoryAnalytics {
  storyId: string;
  state: string;
  publishedAt: string | null;
  reach: { total: number; contacts: number; teachers: number; families: number };
  views: { total: number; contacts: number; teachers: number };
  cta: { kind: string | null; taps: number; tappers: number };
  /** views / reach, tappers / views, tappers / reach. Null when the base is zero. */
  rates: { view: number | null; tapOfViews: number | null; tapOfReach: number | null };
  firstViewAt: string | null;
  lastViewAt: string | null;
  /** One row per day since publication (at most 90), in the requested time zone. */
  daily: Array<{ date: string; views: number; taps: number }>;
  /** Families' countries; `code` null = not set. Contacts only. */
  byCountry: Array<{ code: string | null; reach: number; views: number; tappers: number }>;
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
    // RT-037: story media links go through the access-checked media route.
    @Optional() private readonly mediaUrls: MediaUrlSigner = new MediaUrlSigner(),
    // The message-the-publisher call to action opens a direct conversation
    // through the one path that may create one. Optional only so a harness
    // that never taps it need not build the conversation stack.
    @Optional() private readonly conversations?: ConversationService,
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
    const max = params.mimeType.startsWith('video/')
      ? MAX_VIDEO_BYTES
      : params.mimeType.startsWith('audio/')
        ? MAX_AUDIO_BYTES
        : MAX_IMAGE_BYTES;
    if (!Number.isFinite(params.byteSize) || params.byteSize <= 0 || params.byteSize > max) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TOO_LARGE,
        `story media must be between 1 and ${max} bytes`,
        400,
      );
    }

    const grant = await this.storage.authorizeUpload({
      prefix: 'stories',
      mimeType: params.mimeType,
      byteSize: params.byteSize,
    });
    // PD-41 (review of #216): the key is this publisher's, recorded, so create()
    // can refuse any media key Stories did not issue to them.
    await this.prisma.storyMediaGrant.create({
      data: { objectKey: grant.objectKey, organizationId: actor.organizationId as string, issuedTo: actor.actorId, mimeType: params.mimeType, byteSize: params.byteSize },
    });
    return grant;
  }

  /**
   * PD-41: media the certificate workflow copied, server side, into `stories/`
   * for this staff member -- recorded as a grant like an upload, so create()
   * treats it the same way. Never reachable from a route.
   */
  async grantCertificateMedia(actorId: string, objectKey: string, mimeType: string, byteSize: number): Promise<void> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);
    if (!/^stories\/[^/]+$/.test(objectKey)) throw new CommError(CommErrorCode.STORY_MEDIA_NOT_GRANTED, 'story media lives under stories/');
    await this.prisma.storyMediaGrant.create({
      data: { objectKey, organizationId: actor.organizationId as string, issuedTo: actor.actorId, mimeType, byteSize, source: 'certificate' },
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

    if ((input.title ?? '').trim().length > 0) {
      throw new CommError(
        CommErrorCode.STORY_CAPTION_NOT_ALLOWED,
        'a story has no title; name it for yourself with internalName',
        400,
      );
    }

    const body = (input.body ?? '').trim();
    const hasMedia = Boolean(input.mediaObjectKey);

    if (body.length === 0 && !hasMedia) {
      throw new CommError(
        CommErrorCode.STORY_EMPTY,
        'a story needs a body or a piece of media',
        400,
      );
    }
    // Rule 2: no caption under a story. Words ARE a text story; a photo, video
    // or voice story carries none.
    if (hasMedia && body.length > 0) {
      throw new CommError(
        CommErrorCode.STORY_CAPTION_NOT_ALLOWED,
        'a photo, video or voice story carries no caption',
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
        'story media must declare a kind of "image", "video" or "audio"',
        400,
      );
    }
    if (hasMedia && input.mediaMime && !input.mediaMime.startsWith(`${input.mediaKind === 'audio' ? 'audio' : input.mediaKind}/`)) {
      throw new CommError(
        CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        `a ${input.mediaKind} story cannot carry ${input.mediaMime}`,
        400,
      );
    }

    const kind = storyKindOf(hasMedia ? (input.mediaKind ?? null) : null);
    const background = this.validBackground(kind, input.background);
    const mediaDurationMs = this.validDuration(kind, input.mediaDurationMs);
    const cta = normalizeCta(input.cta);
    const internalName = (input.internalName ?? '').trim();
    if (internalName.length > 120) {
      throw new CommError(CommErrorCode.STORY_TOO_LONG, 'a story name may be at most 120 characters', 400);
    }

    // Resolved here purely to VALIDATE the clauses against the author's scope.
    // The result is discarded; publish() resolves again for real.
    await this.audience.resolve(actor, input.audiences);

    // The media key is a NAME, not a capability (design R7): only a `stories/`
    // key Stories itself issued to this publisher, not yet used by a story.
    const mediaKey = hasMedia ? (input.mediaObjectKey as string) : null;
    if (mediaKey) {
      const grant = await this.prisma.storyMediaGrant.findUnique({ where: { objectKey: mediaKey } });
      if (!grant || grant.issuedTo !== actor.actorId || grant.organizationId !== actor.organizationId || grant.storyId !== null) {
        throw new CommError(CommErrorCode.STORY_MEDIA_NOT_GRANTED, 'story media is uploaded through POST /stories/media, by you, once');
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const story = await tx.story.create({
        data: {
          ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
          title: null,
          body: body || null,
          internalName: internalName || null,
          background,
          mediaObjectKey: input.mediaObjectKey ?? null,
          mediaKind: hasMedia ? input.mediaKind : null,
          mediaMime: hasMedia ? (input.mediaMime ?? null) : null,
          mediaDurationMs,
          ctaKind: cta?.kind ?? null,
          ctaLabel: cta?.label ?? null,
          ctaUrl: cta?.url ?? null,
          ctaPhone: cta?.phone ?? null,
          state: StoryState.DRAFT,
          createdBy: actor.actorId,
        },
      });
      if (mediaKey) {
        // Claimed under the transaction: two drafts cannot share one grant.
        const claimed = await tx.storyMediaGrant.updateMany({
          where: { objectKey: mediaKey, issuedTo: actor.actorId, storyId: null },
          data: { storyId: story.id },
        });
        if (claimed.count !== 1) throw new CommError(CommErrorCode.STORY_MEDIA_NOT_GRANTED, 'this story media was already used');
      }

      await tx.storyAudience.createMany({
        data: input.audiences.map((a) => ({
          storyId: story.id,
          kind: a.kind,
          refId: a.refId ?? null,
          ...(a.filter !== undefined && a.filter !== null
            ? { filter: a.filter as Prisma.InputJsonValue }
            : {}),
        })),
        skipDuplicates: true,
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'story.created',
        entity: 'story',
        entityId: story.id,
        after: { audiences: input.audiences, kind, cta: cta?.kind ?? null },
        reason: 'story drafted',
      });

      return story;
    });

    return this.adminItem(created.id, actor);
  }

  /**
   * How many people an audience would reach if published now, by this author,
   * with this call to action. The same resolution `publish` runs, so the number
   * a publisher confirms is the number that goes out (give or take whoever
   * joins or leaves in between).
   *
   * Counts only: the estimate names nobody.
   */
  async estimate(
    actorId: string,
    input: { audiences: AudienceClause[]; ctaKind?: string | null },
  ): Promise<StoryAudienceEstimate> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);
    const resolved = await this.audience.resolve(actor, input.audiences ?? []);
    const { kept, excluded } = await this.applyReplyScope(actor, resolved.recipients, input.ctaKind ?? null);
    const families = new Set(kept.map((r) => r.familyId).filter(Boolean));
    return {
      recipients: kept.length,
      contacts: kept.filter((r) => r.actorKind === ActorKind.CONTACT).length,
      teachers: kept.filter((r) => r.actorKind === ActorKind.TEACHER).length,
      families: families.size,
      excludedByReplyScope: excluded,
    };
  }

  /**
   * Publish: resolve the audience to people, write the recipient rows, go live.
   *
   * The resolution and the state change are ONE transaction. A story that went
   * `published` without its recipients would be visible to nobody and
   * unfixable by retrying, because the retry would find it already published.
   *
   * A story published now has NO expiry (owner rule, 2026-10-17): it is
   * readable until a publisher deletes it.
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
    // Only the author, a manager or the super admin publishes somebody else's
    // draft: an admin must not push another admin's unfinished story to their
    // families.
    if (story.createdBy !== actor.actorId && !mayActOnOthersStories(actor)) {
      throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    }

    // Resolved AGAIN, under the publisher's live scope at this instant. A draft
    // authored last week by somebody who has since lost a family does not
    // publish to that family.
    const resolved = await this.audience.resolve(
      actor,
      story.audiences.map((a) => ({ kind: a.kind, refId: a.refId, filter: a.filter })),
    );
    const { kept: recipients } = await this.applyReplyScope(actor, resolved.recipients, story.ctaKind);
    if (recipients.length === 0) {
      throw new CommError(
        CommErrorCode.STORY_AUDIENCE_EMPTY,
        'this audience resolves to nobody you may address',
        400,
      );
    }
    const familyCount = new Set(recipients.map((r) => r.familyId).filter(Boolean)).size;

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.storyRecipient.createMany({
        data: recipients.map((r) => ({
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
          expiresAt: null,
        },
      });

      await this.outbox.enqueue(tx, CommEvent.STORY_PUBLISHED, {
        storyId,
        publishedAt: now.toISOString(),
        expiresAt: null,
        hasMedia: story.mediaObjectKey !== null,
        recipientCount: recipients.length,
      });

      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'story.published',
        entity: 'story',
        entityId: storyId,
        after: {
          recipientCount: recipients.length,
          familyCount,
          expiresAt: null,
        },
        reason: 'story published to a resolved audience',
      });
    });

    return this.adminItem(storyId, actor);
  }

  /**
   * The message-the-publisher rule.
   *
   * A reader who taps "message" gets a direct conversation with the publisher,
   * and PD-8 decides who may have one: a parent reaches the staff in charge of
   * their family, never an open directory. So a story whose call to action
   * invites a reply goes only to the people that reply could actually reach --
   * teachers (teacher <-> staff is always open), and the contacts of families
   * the publisher reaches. For the super admin that is every family. Narrowing
   * the audience is the honest choice: a button that fails for half the
   * audience would be worse, and widening PD-8 for a story is not this
   * feature's call. `estimate` reports how many were left out.
   */
  private async applyReplyScope(
    actor: Actor,
    recipients: ResolvedRecipient[],
    ctaKind: string | null,
  ): Promise<{ kept: ResolvedRecipient[]; excluded: number }> {
    if (ctaKind !== StoryCtaKind.MESSAGE_PUBLISHER) return { kept: recipients, excluded: 0 };
    const familyIds = [...new Set(recipients.map((r) => r.familyId).filter((f): f is string => Boolean(f)))];
    const reached = await this.authz.reachesFamilyMany(
      familyIds.map((familyId) => ({ staffId: actor.actorId, familyId })),
      new Date(),
    );
    const kept = recipients.filter(
      (r) =>
        r.actorKind !== ActorKind.CONTACT ||
        (r.familyId !== null && r.familyId !== undefined && reached.has(`${actor.actorId}:${r.familyId}`)),
    );
    return { kept, excluded: recipients.length - kept.length };
  }

  private validBackground(kind: StoryKind, raw: string | null | undefined): string | null {
    if (kind !== 'text' && kind !== 'voice') {
      if (raw) {
        throw new CommError(
          CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
          'only a text or voice story has a background',
          400,
        );
      }
      return null;
    }
    if (!raw) return STORY_BACKGROUNDS[0];
    if (!(STORY_BACKGROUNDS as readonly string[]).includes(raw)) {
      throw new CommError(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED, `unknown background "${raw}"`, 400);
    }
    return raw;
  }

  private validDuration(kind: StoryKind, raw: number | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    if (kind !== 'video' && kind !== 'voice') return null;
    if (!Number.isInteger(raw) || raw < 1 || raw > 3_600_000) {
      throw new CommError(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED, 'mediaDurationMs is out of range', 400);
    }
    return raw;
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
        // NULL means "until deleted" (2026-10-17); a set expiry still ends access.
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        deletedAt: null,
        recipients: { some: { actorId: actor.actorId } },
        ...this.orgScope(actor),
      },
      orderBy: { publishedAt: 'desc' },
      take: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 50,
      include: { views: { where: { actorId: actor.actorId }, select: { actorId: true } } },
    });

    return Promise.all(
      stories.map(async (s) => {
        const kind = storyKindOf(s.mediaKind);
        return {
          id: s.id,
          kind,
          // Rule 2: words are a text story's content and nothing else's. An
          // older story that had both a picture and a caption loses the caption
          // here, so no reader is shown one.
          body: kind === 'text' ? s.body : null,
          background: s.background,
          mediaKind: s.mediaKind,
          mediaUrl: await this.signMedia(s, actor.actorId),
          mediaDurationMs: s.mediaDurationMs,
          cta: readerCta(s),
          publishedAt: s.publishedAt!.toISOString(),
          expiresAt: s.expiresAt?.toISOString() ?? null,
          viewed: s.views.length > 0,
        };
      }),
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
      take: 200,
      include: ADMIN_INCLUDE,
    });

    const tappers = await this.tappersByStory(stories.map((s) => s.id));
    return Promise.all(stories.map((s) => this.toAdminItem(s, actor.actorId, tappers.get(s.id) ?? 0)));
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

    await this.readableToRecipient(storyId, actor);

    await this.prisma.storyView.createMany({
      data: [{ storyId, actorId: actor.actorId }],
      skipDuplicates: true,
    });
    return { ok: true };
  }

  /**
   * The reader-path lookup every reader action shares: the story, found
   * THROUGH the caller's own recipient row, and still readable.
   *
   * The recipient join is part of the lookup, not a check after it. A
   * non-recipient gets "not found" and learns nothing about whether the id
   * exists.
   */
  private async readableToRecipient(storyId: string, actor: Actor) {
    if (!isUuid(storyId)) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    const story = await this.prisma.story.findFirst({
      where: {
        id: storyId,
        recipients: { some: { actorId: actor.actorId } },
      },
      select: {
        id: true, state: true, expiresAt: true, deletedAt: true, organizationId: true,
        publishedBy: true, ctaKind: true, ctaUrl: true, ctaPhone: true, ctaLabel: true,
      },
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
    // have run yet, and that must not buy anybody an extra view. NULL means the
    // story does not expire.
    if (story.expiresAt && story.expiresAt <= new Date()) {
      throw new CommError(CommErrorCode.STORY_EXPIRED, 'this story has expired', 410);
    }
    return story;
  }

  /**
   * A reader tapped the story's call to action.
   *
   * Answered with where the button goes, or, for message-the-publisher, the
   * direct conversation with the publisher, opened through the one path that
   * may create one (`getOrCreateDirect`, which re-applies BR-1 and PD-8
   * itself). The audience was already narrowed to people that path admits at
   * publish time; a publisher who has since left or lost the family is refused
   * there, and the refusal is passed through rather than papered over.
   *
   * WHEN A TAP COUNTS. A link or WhatsApp tap is recorded before answering --
   * whether the phone then opened the app is not knowable here, and the intent
   * is what the publisher asked to measure. A reply tap is recorded only once
   * the conversation exists, so a refused reply is not counted as engagement.
   */
  async tapCta(storyId: string, actorId: string): Promise<StoryCtaTapResult> {
    const actor = await this.requireActor(actorId);
    const decision = this.authz.canReadStories(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const story = await this.readableToRecipient(storyId, actor);
    if (!story.ctaKind) {
      throw new CommError(CommErrorCode.STORY_NO_CTA, 'this story has no button to tap', 409);
    }

    if (story.ctaKind === StoryCtaKind.MESSAGE_PUBLISHER) {
      if (!this.conversations || !story.publishedBy) {
        throw new CommError(CommErrorCode.STORY_NO_CTA, 'replies are not available for this story', 409);
      }
      const conversation = await this.conversations.getOrCreateDirect(actor.actorId, story.publishedBy);
      await this.prisma.storyCtaClick.create({ data: { storyId, actorId: actor.actorId } });
      return { kind: story.ctaKind, url: null, conversationId: conversation.id };
    }
    await this.prisma.storyCtaClick.create({ data: { storyId, actorId: actor.actorId } });
    return { kind: story.ctaKind, url: ctaUrlOf(story), conversationId: null };
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
    const taps = await this.prisma.storyCtaClick.groupBy({
      by: ['actorId'],
      where: { storyId, actorId: { in: views.map((v) => v.actorId) } },
      _count: { _all: true },
    });
    const tapsBy = new Map(taps.map((t) => [t.actorId, t._count._all]));

    const out: StoryViewer[] = [];
    for (const v of views) {
      const viewer = await this.identity.resolveActor(v.actorId);
      out.push({
        actorId: v.actorId,
        displayName: viewer?.displayName ?? 'Unknown',
        actorKind: viewer?.kind ?? 'unknown',
        viewedAt: v.viewedAt.toISOString(),
        ctaTaps: tapsBy.get(v.actorId) ?? 0,
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------

  /**
   * One story's performance: reach, views, taps, their rates, a daily series
   * and a country breakdown.
   *
   * Every number is a query over the rows that record the event --
   * story_recipient, story_view, story_cta_click -- so none can drift from
   * what happened. Publisher-only and organization-scoped, exactly like the
   * viewer list; it names nobody.
   *
   * `timeZone` decides where a day starts for the daily series. It is an IANA
   * name, validated before it reaches SQL; an unknown one is refused.
   */
  async analytics(storyId: string, actorId: string, timeZone = 'UTC'): Promise<StoryAnalytics> {
    const actor = await this.requireActor(actorId);
    const decision = this.authz.canReadStoryViewers(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    if (!isUuid(storyId)) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    const tz = validTimeZone(timeZone);

    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...this.orgScope(actor) },
      select: { id: true, state: true, publishedAt: true, ctaKind: true },
    });
    if (!story) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);

    const [reachRows, viewRows, tapRows] = await Promise.all([
      this.prisma.storyRecipient.groupBy({ by: ['actorKind'], where: { storyId }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ actor_kind: string; n: bigint; first: Date | null; last: Date | null }>>`
        select r.actor_kind, count(*)::bigint as n, min(v.viewed_at) as first, max(v.viewed_at) as last
          from chat.story_view v
          join chat.story_recipient r on r.story_id = v.story_id and r.actor_id = v.actor_id
         where v.story_id = ${storyId}::uuid
         group by r.actor_kind`,
      this.prisma.$queryRaw<Array<{ taps: bigint; tappers: bigint }>>`
        select count(*)::bigint as taps, count(distinct actor_id)::bigint as tappers
          from chat.story_cta_click where story_id = ${storyId}::uuid`,
    ]);

    const reachOf = (k: string) => reachRows.find((r) => r.actorKind === k)?._count._all ?? 0;
    const viewsOf = (k: string) => Number(viewRows.find((r) => r.actor_kind === k)?.n ?? 0);
    const reachTotal = reachRows.reduce((n, r) => n + r._count._all, 0);
    const viewTotal = viewRows.reduce((n, r) => n + Number(r.n), 0);
    const taps = Number(tapRows[0]?.taps ?? 0);
    const tappers = Number(tapRows[0]?.tappers ?? 0);
    const firsts = viewRows.map((r) => r.first).filter((d): d is Date => d !== null);
    const lasts = viewRows.map((r) => r.last).filter((d): d is Date => d !== null);

    const [familyRows, daily, byCountry] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        select count(distinct c.family_id)::bigint as n
          from chat.story_recipient r join chat.contact c on c.id = r.actor_id
         where r.story_id = ${storyId}::uuid and r.actor_kind = 'contact'`,
      story.publishedAt ? this.dailySeries(storyId, story.publishedAt, tz) : Promise.resolve([]),
      this.prisma.$queryRaw<Array<{ code: string | null; reach: bigint; views: bigint; tappers: bigint }>>`
        -- One row per recipient: a tap is many rows per person, so it is asked
        -- with exists, never joined -- a join would count a double-tapper twice.
        select f.country_code as code,
               count(*)::bigint as reach,
               count(*) filter (where exists (
                 select 1 from chat.story_view v
                  where v.story_id = r.story_id and v.actor_id = r.actor_id))::bigint as views,
               count(*) filter (where exists (
                 select 1 from chat.story_cta_click k
                  where k.story_id = r.story_id and k.actor_id = r.actor_id))::bigint as tappers
          from chat.story_recipient r
          join chat.contact c on c.id = r.actor_id
          join chat.family f on f.id = c.family_id
         where r.story_id = ${storyId}::uuid and r.actor_kind = 'contact'
         group by f.country_code
         order by count(*) desc`,
    ]);

    const rate = (n: number, d: number) => (d > 0 ? Math.min(1, n / d) : null);
    return {
      storyId,
      state: story.state,
      publishedAt: story.publishedAt?.toISOString() ?? null,
      reach: {
        total: reachTotal,
        contacts: reachOf(ActorKind.CONTACT),
        teachers: reachOf(ActorKind.TEACHER),
        families: Number(familyRows[0]?.n ?? 0),
      },
      views: { total: viewTotal, contacts: viewsOf(ActorKind.CONTACT), teachers: viewsOf(ActorKind.TEACHER) },
      cta: { kind: story.ctaKind, taps, tappers },
      rates: {
        view: rate(viewTotal, reachTotal),
        tapOfViews: rate(tappers, viewTotal),
        tapOfReach: rate(tappers, reachTotal),
      },
      firstViewAt: firsts.length ? new Date(Math.min(...firsts.map((d) => d.getTime()))).toISOString() : null,
      lastViewAt: lasts.length ? new Date(Math.max(...lasts.map((d) => d.getTime()))).toISOString() : null,
      daily,
      byCountry: byCountry.map((r) => ({
        code: r.code,
        reach: Number(r.reach),
        views: Number(r.views),
        tappers: Number(r.tappers),
      })),
    };
  }

  /** Views and taps per local day, from the publication day to today (at most 90 days). */
  private async dailySeries(
    storyId: string,
    publishedAt: Date,
    tz: string,
  ): Promise<Array<{ date: string; views: number; taps: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ day: string; views: bigint; taps: bigint }>>`
      with days as (
        select generate_series(
                 greatest((${publishedAt}::timestamptz at time zone ${tz})::date,
                          (now() at time zone ${tz})::date - 89),
                 (now() at time zone ${tz})::date,
                 interval '1 day')::date as day
      )
      select to_char(d.day, 'YYYY-MM-DD') as day,
             (select count(*) from chat.story_view v
               where v.story_id = ${storyId}::uuid
                 and (v.viewed_at at time zone ${tz})::date = d.day)::bigint as views,
             (select count(*) from chat.story_cta_click k
               where k.story_id = ${storyId}::uuid
                 and (k.clicked_at at time zone ${tz})::date = d.day)::bigint as taps
        from days d
       order by d.day`;
    return rows.map((r) => ({ date: r.day, views: Number(r.views), taps: Number(r.taps) }));
  }

  // -------------------------------------------------------------------------
  // Targeting data
  // -------------------------------------------------------------------------

  /**
   * The shape of the organization's audience, for the targeting controls:
   * how many families are in each country, on each plan, with each number of
   * children -- and how many have no country or plan recorded, so a publisher
   * sees a segment's blind spot before relying on it. Counts only; any
   * publisher may read them.
   */
  async audienceFacts(actorId: string): Promise<StoryAudienceFacts> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);
    const org = actor.organizationId!;

    const [families, contacts, teachers] = await Promise.all([
      this.prisma.family.findMany({
        where: { organizationId: org },
        select: { countryCode: true, subscriptionPlanMonths: true, _count: { select: { learners: true } } },
      }),
      this.prisma.contact.count({ where: { organizationId: org, isActive: true, canMessage: true } }),
      this.prisma.teacher.count({ where: { organizationId: org, isActive: true, leftAt: null } }),
    ]);

    const countries = new Map<string, number>();
    const plans = new Map<number, number>();
    const children = new Map<number, number>();
    let unknownCountry = 0;
    let unknownPlan = 0;
    let noChildren = 0;
    for (const f of families) {
      if (f.countryCode) countries.set(f.countryCode, (countries.get(f.countryCode) ?? 0) + 1);
      else unknownCountry += 1;
      if (f.subscriptionPlanMonths) plans.set(f.subscriptionPlanMonths, (plans.get(f.subscriptionPlanMonths) ?? 0) + 1);
      else unknownPlan += 1;
      const n = f._count.learners;
      if (n === 0) noChildren += 1;
      else {
        const bucket = Math.min(n, CHILDREN_FOUR_OR_MORE);
        children.set(bucket, (children.get(bucket) ?? 0) + 1);
      }
    }
    return {
      families: families.length,
      contacts,
      teachers,
      countries: [...countries.entries()]
        .map(([code, n]) => ({ code, families: n }))
        .sort((a, b) => b.families - a.families || a.code.localeCompare(b.code)),
      plans: SUBSCRIPTION_PLAN_MONTHS.map((months) => ({ months, families: plans.get(months) ?? 0 })),
      children: [1, 2, 3, CHILDREN_FOUR_OR_MORE].map((bucket) => ({ bucket, families: children.get(bucket) ?? 0 })),
      unknownCountry,
      unknownPlan,
      noChildren,
    };
  }

  /**
   * The families and their targeting attributes, for the super admin and
   * managers to fill in until Jawwid Core supplies them. Bounded; filtered by
   * name and by "missing data".
   */
  async familyAudienceData(
    actorId: string,
    params: { search?: string; missing?: boolean },
  ): Promise<{ families: FamilyAudienceRow[]; truncated: boolean }> {
    const actor = await this.requireActor(actorId);
    this.requireAudienceDataManager(actor);
    const search = (params.search ?? '').trim().slice(0, 100);
    const rows = await this.prisma.family.findMany({
      where: {
        organizationId: actor.organizationId!,
        ...(search ? { displayName: { contains: search, mode: 'insensitive' as const } } : {}),
        ...(params.missing ? { OR: [{ countryCode: null }, { subscriptionPlanMonths: null }] } : {}),
      },
      orderBy: { displayName: 'asc' },
      take: FAMILY_DATA_LIMIT + 1,
      select: {
        id: true, displayName: true, countryCode: true, subscriptionPlanMonths: true,
        segmentSource: true, segmentUpdatedAt: true, _count: { select: { learners: true } },
      },
    });
    return {
      truncated: rows.length > FAMILY_DATA_LIMIT,
      families: rows.slice(0, FAMILY_DATA_LIMIT).map((f) => ({
        id: f.id,
        displayName: f.displayName,
        countryCode: f.countryCode,
        subscriptionPlanMonths: f.subscriptionPlanMonths,
        childCount: f._count.learners,
        segmentSource: f.segmentSource,
        segmentUpdatedAt: f.segmentUpdatedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Set one family's country and plan. Audited; `null` clears a value. */
  async setFamilyAudienceData(
    actorId: string,
    familyId: string,
    input: { countryCode?: unknown; subscriptionPlanMonths?: unknown },
  ): Promise<FamilyAudienceRow> {
    const actor = await this.requireActor(actorId);
    this.requireAudienceDataManager(actor);
    const notFound = () => new CommError(CommErrorCode.STORY_FAMILY_NOT_FOUND, 'family not found', 404);
    if (!isUuid(familyId)) throw notFound();

    const data: { countryCode?: string | null; subscriptionPlanMonths?: number | null } = {};
    if (input.countryCode !== undefined) {
      // PD-45: one of the list (chat.geo_country), never just two letters.
      const c = input.countryCode === null ? null : listedCountry(input.countryCode);
      if (c === null && input.countryCode !== null) {
        throw new CommError(CommErrorCode.STORY_AUDIENCE_INVALID, invalidCountryMessage('countryCode'), 400);
      }
      data.countryCode = c;
    }
    if (input.subscriptionPlanMonths !== undefined) {
      const m = input.subscriptionPlanMonths;
      if (m !== null && !(SUBSCRIPTION_PLAN_MONTHS as readonly unknown[]).includes(m)) {
        throw new CommError(CommErrorCode.STORY_AUDIENCE_INVALID, 'subscriptionPlanMonths must be 1, 3, 6 or 12', 400);
      }
      data.subscriptionPlanMonths = m as number | null;
    }

    const before = await this.prisma.family.findFirst({
      where: { id: familyId, organizationId: actor.organizationId! },
      select: { id: true, countryCode: true, subscriptionPlanMonths: true },
    });
    if (!before) throw notFound();

    await this.prisma.$transaction(async (tx) => {
      await tx.family.update({
        where: { id: familyId },
        data: { ...data, segmentSource: 'admin', segmentUpdatedAt: new Date() },
      }).catch((e: unknown) => {
        // PD-45 safety net: the database's own list refused it.
        throw isGeoForeignKeyViolation(e) ? new CommError(CommErrorCode.STORY_AUDIENCE_INVALID, invalidCountryMessage('countryCode'), 400) : e;
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'family.audience_data_set',
        entity: 'family',
        entityId: familyId,
        before: { countryCode: before.countryCode, subscriptionPlanMonths: before.subscriptionPlanMonths },
        after: data,
        reason: 'story targeting data set by an admin',
      });
    });

    const [row] = (await this.familyAudienceRows(actor.organizationId!, [familyId]));
    return row!;
  }

  private async familyAudienceRows(org: string, ids: string[]): Promise<FamilyAudienceRow[]> {
    const rows = await this.prisma.family.findMany({
      where: { organizationId: org, id: { in: ids } },
      select: {
        id: true, displayName: true, countryCode: true, subscriptionPlanMonths: true,
        segmentSource: true, segmentUpdatedAt: true, _count: { select: { learners: true } },
      },
    });
    return rows.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      countryCode: f.countryCode,
      subscriptionPlanMonths: f.subscriptionPlanMonths,
      childCount: f._count.learners,
      segmentSource: f.segmentSource,
      segmentUpdatedAt: f.segmentUpdatedAt?.toISOString() ?? null,
    }));
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

    // Same rule as publishing: your own, or a manager's or the super admin's.
    if (story.createdBy !== actor.actorId && !mayActOnOthersStories(actor)) {
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

  /**
   * PD-41: a certificate's Story taken down because the family withdrew consent
   * -- inside the certificate's own transaction, by whoever answers for the
   * certificate now (a PD-33 backup included), so the withdrawal and the
   * removal commit together or not at all. The author rule of remove() does not
   * apply: the certificate workflow decided this act, and the trail says so.
   */
  async retireForCertificate(tx: Prisma.TransactionClient, storyId: string, staffId: string, reason: string): Promise<void> {
    const story = await tx.story.findUnique({ where: { id: storyId }, select: { id: true, state: true } });
    if (!story || story.state === StoryState.DELETED) return;
    const now = new Date();
    await tx.story.update({ where: { id: storyId }, data: { state: StoryState.DELETED, deletedAt: now, deletedBy: staffId, deletedReason: reason } });
    await this.outbox.enqueue(tx, CommEvent.STORY_RETIRED, { storyId, reason: 'deleted', at: now.toISOString() });
    await this.audit.audit(tx, {
      actorId: staffId,
      action: 'story.deleted',
      entity: 'story',
      entityId: storyId,
      before: { state: story.state },
      after: { state: StoryState.DELETED, by: 'certificate_consent_withdrawn' },
      reason,
    });
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

  private requireAudienceDataManager(actor: Actor): void {
    const decision = this.authz.canManageStoryAudienceData(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason, 403);
  }

  /** Distinct tappers per story, for the publisher list. */
  private async tappersByStory(storyIds: string[]): Promise<Map<string, number>> {
    if (storyIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ story_id: string; n: bigint }>>`
      select story_id, count(distinct actor_id)::bigint as n
        from chat.story_cta_click
       where story_id = any(${storyIds}::uuid[])
       group by story_id`;
    return new Map(rows.map((r) => [r.story_id, Number(r.n)]));
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
   * THE GATE IS HERE, not at the call sites. `feed()` already excludes expired and
   * deleted stories, but `list()` deliberately returns them -- it is the
   * publisher's reporting surface -- and the first version of this method signed
   * whatever key it was handed. So a publisher could mint a FRESH media URL for a
   * story whose access had ended, for as long as the bytes survived retention.
   * Nobody's feed showed it, which is exactly why it would not have been noticed.
   *
   * A story hands out media only while it is READABLE:
   *   * a draft   -- yes; the author has to see what they attached
   *   * published -- yes, while `expires_at` is still in the future
   *   * expired   -- no
   *   * deleted   -- no
   *   * purged    -- no, and `null` rather than a URL that would 404
   *
   * What this cannot do is revoke a URL already minted: a signature is
   * self-validating, so one issued a second before expiry stays usable until it
   * lapses. That is why STORAGE_SIGNED_URL_TTL_SECONDS is capped at an hour and
   * defaults to five minutes -- the window is bounded by the TTL, not unbounded by
   * the story's lifetime.
   */
  private mediaReadable(story: {
    mediaObjectKey: string | null;
    mediaPurgedAt: Date | null;
    state: string;
    expiresAt: Date | null;
    deletedAt: Date | null;
  }): boolean {
    if (!story.mediaObjectKey || story.mediaPurgedAt) return false;
    if (story.deletedAt || story.state === StoryState.DELETED) return false;
    if (story.state === StoryState.EXPIRED) return false;
    // Checked against the clock, not the state column: the sweep may not have
    // relabelled it yet, and that must not buy an extra URL. A NULL expiry is a
    // story that does not expire (2026-10-17).
    if (story.state === StoryState.PUBLISHED && story.expiresAt && story.expiresAt <= new Date()) {
      return false;
    }
    return true;
  }

  /**
   * RT-037: the link now points at the access-checked media route, bound to
   * the reader, instead of a presigned storage URL -- so the readability gate
   * above, the audience and the reader's liveness are all re-checked on every
   * request (`authorizeMediaRead`), and an issued link stops working the moment
   * any of them stops holding.
   */
  private async signMedia(
    story: {
      id: string;
      mediaObjectKey: string | null;
      mediaPurgedAt: Date | null;
      state: string;
      expiresAt: Date | null;
      deletedAt: Date | null;
    },
    viewerId: string,
  ): Promise<string | null> {
    if (!this.mediaReadable(story)) return null;
    const ttl = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);
    return this.mediaUrls.url('stories', story.id, 'o', viewerId, ttl);
  }

  /**
   * RT-037 -- the access-time decision behind a story media link. The same two
   * ways a story's media is shown, re-decided now: a PUBLISHER of the story's
   * organization (drafts included, as the publisher's list shows them), or a
   * READER who is one of its recipients while it is published and unexpired.
   * Every refusal reads as absent.
   */
  async authorizeMediaRead(storyId: string, actorId: string): Promise<{ objectKey: string }> {
    const absent = () => new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storyId)) throw absent();
    const actor = await this.requireActor(actorId);
    if (!actor.isActive) throw absent();
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, ...this.orgScope(actor) },
      select: { id: true, mediaObjectKey: true, mediaPurgedAt: true, state: true, expiresAt: true, deletedAt: true },
    });
    if (!story || !this.mediaReadable(story) || !story.mediaObjectKey) throw absent();
    if (this.authz.canPublishStory(actor).allowed) return { objectKey: story.mediaObjectKey };
    if (!this.authz.canReadStories(actor).allowed || story.state !== StoryState.PUBLISHED) throw absent();
    const recipient = await this.prisma.storyRecipient.findFirst({
      where: { storyId, actorId: actor.actorId },
      select: { storyId: true },
    });
    if (!recipient) throw absent();
    return { objectKey: story.mediaObjectKey };
  }

  private async adminItem(storyId: string, actor: Actor): Promise<StoryAdminItem> {
    const s = await this.prisma.story.findFirst({
      where: { id: storyId, ...this.orgScope(actor) },
      include: ADMIN_INCLUDE,
    });
    if (!s) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    const tappers = await this.tappersByStory([s.id]);
    return this.toAdminItem(s, actor.actorId, tappers.get(s.id) ?? 0);
  }

  /** One story as its publisher sees it. Organization-scoped like the list. */
  async get(storyId: string, actorId: string): Promise<StoryAdminItem> {
    const actor = await this.requireActor(actorId);
    this.requirePublisher(actor);
    if (!isUuid(storyId)) throw new CommError(CommErrorCode.STORY_NOT_FOUND, 'story not found', 404);
    return this.adminItem(storyId, actor);
  }

  private async toAdminItem(
    s: Prisma.StoryGetPayload<{ include: typeof ADMIN_INCLUDE }>,
    viewerId: string,
    tappers: number,
  ): Promise<StoryAdminItem> {
    return {
      id: s.id,
      kind: storyKindOf(s.mediaKind),
      internalName: s.internalName,
      title: s.title,
      body: s.body,
      background: s.background,
      mediaKind: s.mediaKind,
      mediaUrl: await this.signMedia(s, viewerId),
      mediaDurationMs: s.mediaDurationMs,
      cta: s.ctaKind
        ? { kind: s.ctaKind, label: s.ctaLabel, url: ctaUrlOf(s), phone: s.ctaPhone }
        : null,
      state: s.state,
      createdAt: s.createdAt.toISOString(),
      publishedAt: s.publishedAt?.toISOString() ?? null,
      expiresAt: s.expiresAt?.toISOString() ?? null,
      deletedAt: s.deletedAt?.toISOString() ?? null,
      createdBy: s.createdBy,
      creatorName: s.creator.name,
      audiences: s.audiences.map((a) => ({ kind: a.kind, refId: a.refId, filter: a.filter ?? null })),
      recipientCount: s._count.recipients,
      viewCount: s._count.views,
      ctaTapCount: s._count.ctaClicks,
      ctaTapperCount: tappers,
    };
  }
}

const ADMIN_INCLUDE = {
  audiences: true,
  creator: { select: { name: true } },
  _count: { select: { recipients: true, views: true, ctaClicks: true } },
} as const satisfies Prisma.StoryInclude;

/** The family-data table shows at most this many rows; search narrows it. */
const FAMILY_DATA_LIMIT = 500;

/**
 * Story media types, matching the attachment policy's shape. Narrower than the
 * attachment list on purpose: a story is an image or a short video, never a PDF.
 */
const STORY_MEDIA_TYPES =
  /^(image\/(jpeg|png|webp|heic)|video\/(mp4|quicktime|webm)|audio\/(mp4|mpeg|aac|wav))$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/**
 * Voice. The list is narrower than a chat voice note's on purpose: it is what
 * BOTH mobile platforms play. webm and ogg are refused because iOS cannot
 * decode them, and a story that is silent on half the audience is a defect.
 */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function isStoryMediaKind(kind: string | null | undefined): boolean {
  return kind === StoryMediaKind.IMAGE || kind === StoryMediaKind.VIDEO || kind === StoryMediaKind.AUDIO;
}

function storyKindOf(mediaKind: string | null): StoryKind {
  if (mediaKind === StoryMediaKind.IMAGE) return 'image';
  if (mediaKind === StoryMediaKind.VIDEO) return 'video';
  if (mediaKind === StoryMediaKind.AUDIO) return 'voice';
  return 'text';
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Publishing or deleting a story somebody else drafted. */
function mayActOnOthersStories(actor: Actor): boolean {
  return actor.staffRole === StaffRole.MANAGER || actor.staffRole === StaffRole.SUPER_ADMIN;
}

/**
 * Validate and normalize a call to action. A WhatsApp number is accepted in
 * the notations people type (`+971 50 123 4567`, `00971...`, with dashes or
 * brackets) and stored as bare E.164 digits; a link must be https.
 */
function normalizeCta(input: StoryCtaInput | null | undefined): {
  kind: string; label: string | null; url: string | null; phone: string | null;
} | null {
  if (!input || !input.kind) return null;
  const bad = (why: string) => new CommError(CommErrorCode.STORY_CTA_INVALID, why, 400);
  const label = (input.label ?? '').trim() || null;
  if (label && label.length > 40) throw bad('a button label may be at most 40 characters');

  switch (input.kind) {
    case StoryCtaKind.LINK: {
      const raw = (input.url ?? '').trim();
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw bad('the link is not a valid URL');
      }
      if (url.protocol !== 'https:' || raw.length > 2000 || /\s/.test(raw)) {
        throw bad('the link must be an https:// address');
      }
      return { kind: input.kind, label, url: url.toString(), phone: null };
    }
    case StoryCtaKind.WHATSAPP: {
      const digits = (input.phone ?? '').trim().replace(/[\s\-().]/g, '').replace(/^(\+|00)/, '');
      if (!/^[1-9][0-9]{6,14}$/.test(digits)) {
        throw bad('the WhatsApp number must be an international number, e.g. +971501234567');
      }
      return { kind: input.kind, label, url: null, phone: digits };
    }
    case StoryCtaKind.MESSAGE_PUBLISHER:
      return { kind: input.kind, label, url: null, phone: null };
    default:
      throw bad(`unknown call to action "${input.kind}"`);
  }
}

/** Where a call to action goes: the link, or the wa.me address. */
function ctaUrlOf(s: { ctaKind: string | null; ctaUrl: string | null; ctaPhone: string | null }): string | null {
  if (s.ctaKind === StoryCtaKind.LINK) return s.ctaUrl;
  if (s.ctaKind === StoryCtaKind.WHATSAPP && s.ctaPhone) return `https://wa.me/${s.ctaPhone}`;
  return null;
}

function readerCta(s: {
  ctaKind: string | null; ctaLabel: string | null; ctaUrl: string | null; ctaPhone: string | null;
}): StoryCtaDto | null {
  if (!s.ctaKind) return null;
  return { kind: s.ctaKind, label: s.ctaLabel, url: ctaUrlOf(s) };
}

/** An IANA time zone, proven by the runtime before it reaches SQL. */
function validTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    throw new CommError(CommErrorCode.STORY_AUDIENCE_INVALID, `unknown time zone "${tz}"`, 400);
  }
}
