import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { IDENTITY_SERVICE } from '../platform/tokens';
import { actorRefKey, type IdentityService } from '../platform/identity.service';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';

/**
 * The Admin Portal's read-only inspection surface (super admin bootstrap).
 *
 * ## The two rules every method keeps
 *
 * 1. THE VERDICT COMES FIRST. Every public method calls `requireInspector`
 *    before its first query, so there is no method that reads and then decides.
 *    The verdict is AuthorizationService's -- this file compares no role names.
 *
 * 2. EVERY QUERY IS FILTERED ON THE INSPECTOR'S ORGANIZATION. Not on a request
 *    field: the organization is the one IdentityService read off the principal
 *    row. RLS is inert on this schema today (RLS-STRATEGY §7), so this filter is
 *    the tenant boundary, not a second layer behind one.
 *
 * ## What no response carries
 *
 * An account's `subject` (the login identifier, an email or phone for a
 * contact), a password hash, a token hash, a session or device row. The DTOs
 * below name every field they return, so a column added to a table cannot leak
 * through here by accident -- the same discipline as auth.dto.ts.
 *
 * ## What no method does
 *
 * Write. There is no mutation behind `/admin` in this milestone; acting on a
 * family is still decided by canSend / canPublishStory / canApprove.
 */

export const ADMIN_LIST_LIMIT = 200;
export const ADMIN_MESSAGE_LIMIT = 100;

export interface AdminOverviewDto {
  readonly organization: { readonly id: string; readonly slug: string; readonly displayName: string };
  readonly accounts: Readonly<Record<string, { readonly active: number; readonly inactive: number }>>;
  readonly staffByRole: Readonly<Record<string, number>>;
  readonly teachers: number;
  readonly families: number;
  readonly contacts: number;
  readonly conversationsByType: Readonly<Record<string, number>>;
  readonly messages: number;
  readonly storiesByState: Readonly<Record<string, number>>;
  readonly generatedAt: string;
}

export interface AdminUserDto {
  readonly principalKind: 'staff' | 'teacher' | 'contact';
  readonly id: string;
  readonly displayName: string;
  /** chat.staff.role for staff; null otherwise. */
  readonly staffRole: string | null;
  /** The contact's family; null otherwise. */
  readonly familyId: string | null;
  readonly isActive: boolean;
  readonly hasLogin: boolean;
  readonly accountStatus: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface AdminConversationDto {
  readonly id: string;
  readonly type: string;
  readonly state: string;
  readonly title: string | null;
  readonly familyId: string | null;
  readonly familyName: string | null;
  readonly liveMembers: number;
  readonly lastActivityAt: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface AdminMessageDto {
  readonly id: string;
  readonly seq: string | null;
  readonly authorKind: string;
  /** Null when the author does not resolve; never a fabricated name. */
  readonly authorName: string | null;
  readonly type: string;
  readonly visibility: string;
  readonly moderation: string;
  /** Null for a deleted message: inspection does not resurrect a deletion. */
  readonly body: string | null;
  readonly deleted: boolean;
  readonly attachments: number;
  readonly createdAt: string;
}

export interface AdminStoryDto {
  readonly id: string;
  readonly title: string | null;
  readonly state: string;
  readonly creatorName: string;
  readonly recipients: number;
  readonly views: number;
  readonly createdAt: string;
  readonly publishedAt: string | null;
  readonly expiresAt: string | null;
  readonly deletedAt: string | null;
}

@Injectable()
export class AdminInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  async overview(actor: Actor): Promise<AdminOverviewDto> {
    const organizationId = this.requireInspector(actor);
    const where = { organizationId };

    const [organization, accounts, staff, teachers, families, contacts, conversations, messages, stories] =
      await Promise.all([
        this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        this.prisma.account.groupBy({ by: ['kind', 'isActive'], where, _count: { _all: true } }),
        this.prisma.staff.groupBy({ by: ['role'], where, _count: { _all: true } }),
        this.prisma.teacher.count({ where }),
        this.prisma.family.count({ where }),
        this.prisma.contact.count({ where }),
        this.prisma.conversation.groupBy({ by: ['type'], where, _count: { _all: true } }),
        this.prisma.message.count({ where }),
        this.prisma.story.groupBy({ by: ['state'], where, _count: { _all: true } }),
      ]);

    const accountCounts: Record<string, { active: number; inactive: number }> = {};
    for (const row of accounts) {
      const bucket = (accountCounts[row.kind] ??= { active: 0, inactive: 0 });
      if (row.isActive) bucket.active += row._count._all;
      else bucket.inactive += row._count._all;
    }

    return {
      organization: {
        id: organization.id,
        slug: organization.slug,
        displayName: organization.displayName,
      },
      accounts: accountCounts,
      staffByRole: Object.fromEntries(staff.map((r) => [r.role, r._count._all])),
      teachers,
      families,
      contacts,
      conversationsByType: Object.fromEntries(conversations.map((r) => [r.type, r._count._all])),
      messages,
      storiesByState: Object.fromEntries(stories.map((r) => [r.state, r._count._all])),
      generatedAt: new Date().toISOString(),
    };
  }

  async users(actor: Actor): Promise<{ users: AdminUserDto[]; truncated: boolean }> {
    const organizationId = this.requireInspector(actor);
    const where = { organizationId };
    const take = ADMIN_LIST_LIMIT + 1;
    const account = { select: { status: true, lastLoginAt: true } } as const;

    const [staff, teachers, contacts] = await Promise.all([
      this.prisma.staff.findMany({ where, take, orderBy: { createdAt: 'asc' }, include: { account } }),
      this.prisma.teacher.findMany({ where, take, orderBy: { createdAt: 'asc' }, include: { account } }),
      this.prisma.contact.findMany({ where, take, orderBy: { createdAt: 'asc' }, include: { account } }),
    ]);
    const truncated = [staff, teachers, contacts].some((rows) => rows.length > ADMIN_LIST_LIMIT);

    const users: AdminUserDto[] = [
      ...staff.slice(0, ADMIN_LIST_LIMIT).map((s) =>
        toUser('staff', s, { staffRole: s.role, familyId: null, isActive: s.isActive && s.leftAt === null }),
      ),
      ...teachers.slice(0, ADMIN_LIST_LIMIT).map((t) =>
        toUser('teacher', t, { staffRole: null, familyId: null, isActive: t.isActive && t.leftAt === null }),
      ),
      ...contacts.slice(0, ADMIN_LIST_LIMIT).map((c) =>
        toUser('contact', c, { staffRole: null, familyId: c.familyId, isActive: c.isActive }),
      ),
    ];
    return { users, truncated };
  }

  async conversations(actor: Actor): Promise<{ conversations: AdminConversationDto[]; truncated: boolean }> {
    const organizationId = this.requireInspector(actor);

    const rows = await this.prisma.conversation.findMany({
      where: { organizationId },
      orderBy: { lastActivityAt: 'desc' },
      take: ADMIN_LIST_LIMIT + 1,
      include: {
        family: { select: { displayName: true } },
        _count: { select: { members: { where: { leftAt: null } } } },
      },
    });

    return {
      truncated: rows.length > ADMIN_LIST_LIMIT,
      conversations: rows.slice(0, ADMIN_LIST_LIMIT).map((c) => ({
        id: c.id,
        type: c.type,
        state: c.state,
        title: c.title,
        familyId: c.familyId,
        familyName: c.family?.displayName ?? null,
        liveMembers: c._count.members,
        lastActivityAt: c.lastActivityAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        archivedAt: c.archivedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * The most recent messages of one conversation, oldest first.
   *
   * A conversation outside the inspector's organization is answered exactly
   * like one that does not exist: the same code, the same message. Anything
   * else would make this route a cross-tenant existence oracle.
   */
  async messages(actor: Actor, conversationId: string): Promise<{ messages: AdminMessageDto[] }> {
    const organizationId = this.requireInspector(actor);

    const conversation = isUuid(conversationId)
      ? await this.prisma.conversation.findFirst({
          where: { id: conversationId, organizationId },
          select: { id: true },
        })
      : null;
    if (!conversation) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found', 404);
    }

    const rows = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ADMIN_MESSAGE_LIMIT,
      include: { _count: { select: { attachments: true } } },
    });

    const authors = await this.identity.resolveActors(
      rows
        .filter((m) => m.authorId !== null)
        .map((m) => ({ actorId: m.authorId as string, actorKind: m.authorType })),
    );

    return {
      messages: rows.reverse().map((m) => {
        const deleted = m.deletedAt !== null;
        const author = m.authorId
          ? authors.get(actorRefKey({ actorId: m.authorId, actorKind: m.authorType }))
          : undefined;
        return {
          id: m.id,
          seq: m.seq === null ? null : m.seq.toString(),
          authorKind: m.authorType,
          authorName: author?.displayName ?? null,
          type: m.type,
          visibility: m.visibility,
          moderation: m.moderation,
          body: deleted ? null : m.body,
          deleted,
          attachments: m._count.attachments,
          createdAt: m.createdAt.toISOString(),
        };
      }),
    };
  }

  async stories(actor: Actor): Promise<{ stories: AdminStoryDto[]; truncated: boolean }> {
    const organizationId = this.requireInspector(actor);

    const rows = await this.prisma.story.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: ADMIN_LIST_LIMIT + 1,
      include: {
        creator: { select: { name: true } },
        _count: { select: { recipients: true, views: true } },
      },
    });

    return {
      truncated: rows.length > ADMIN_LIST_LIMIT,
      stories: rows.slice(0, ADMIN_LIST_LIMIT).map((s) => ({
        id: s.id,
        title: s.title,
        state: s.state,
        creatorName: s.creator.name,
        recipients: s._count.recipients,
        views: s._count.views,
        createdAt: s.createdAt.toISOString(),
        publishedAt: s.publishedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt?.toISOString() ?? null,
        deletedAt: s.deletedAt?.toISOString() ?? null,
      })),
    };
  }

  /** The verdict, and the ONLY organization any query in this file may use. */
  private requireInspector(actor: Actor): string {
    const decision = this.authz.canInspectOrganization(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    // canInspectOrganization refuses an actor without one, so this is a type
    // narrowing, not a second decision.
    return actor.organizationId as string;
  }
}

function toUser(
  principalKind: AdminUserDto['principalKind'],
  row: {
    id: string;
    name: string;
    createdAt: Date;
    account: { status: string; lastLoginAt: Date | null } | null;
  },
  extra: Pick<AdminUserDto, 'staffRole' | 'familyId' | 'isActive'>,
): AdminUserDto {
  return {
    principalKind,
    id: row.id,
    displayName: row.name,
    staffRole: extra.staffRole,
    familyId: extra.familyId,
    isActive: extra.isActive,
    hasLogin: row.account !== null,
    accountStatus: row.account?.status ?? null,
    lastLoginAt: row.account?.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id is "not found", not a 500 from Postgres's uuid cast. */
function isUuid(value: string): boolean {
  return UUID.test(value);
}
