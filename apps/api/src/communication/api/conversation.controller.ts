import { Body, Controller, Get, Inject, Param, Post, Query, UseFilters } from '@nestjs/common';
import type { ConversationMember } from '@prisma/client';
import { ConversationService } from '../conversations/conversation.service';
import { MessageService } from '../messages/message.service';
import { DIRECTORY_SERVICE } from '../../platform/tokens';
import type { ActorRef, DirectoryService } from '../../platform/directory.service';
import { AuthorizationService } from '../../platform/authorization.service';
import {
  toConversationDto,
  toPreviewText,
  toSystemEventDto,
  type ConversationDto,
  type ConversationLastMessageDto,
  type ConversationWithLearner,
} from '../contracts/dto';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

@Controller('conversations')
@UseFilters(CommErrorFilter)
export class ConversationController {
  /**
   * Two services, composed here rather than one calling the other.
   *
   * MessageService already depends on ConversationService; having conversations
   * reach back for an unread count would close that loop. The controller is the
   * place the two meet, which is what MessageController already does with
   * AttachmentService.
   */
  constructor(
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    @Inject(DIRECTORY_SERVICE) private readonly directory: DirectoryService,
    private readonly authz: AuthorizationService,
  ) {}

  /**
   * The chat list, RBAC-scoped to what this actor may see.
   *
   * Order matters and is load-bearing: `listForActor` establishes the
   * authorization boundary FIRST, and the unread counts are then computed for
   * exactly that set of ids. The count query is never handed an id from the
   * request, so it cannot be asked about a conversation this actor may not see
   * -- and being scoped to their own receipts, it could not answer if it were.
   *
   * One count query for the whole list, not one per row (mobile gap O1).
   */
  @Get()
  async list(@ActorId() actorId: string, @Query('q') q?: string) {
    // Search and the plain list differ only in which authorized rows come back.
    // Both go through the SAME scope predicate inside ConversationService, so a
    // search term can narrow the result and can never widen it past what the
    // list would have shown.
    const term = typeof q === 'string' ? q.trim() : '';
    const rows = term
      ? await this.conversations.searchForActor(actorId, term)
      : await this.conversations.listForActor(actorId);

    return { conversations: await this.decorate(rows, actorId) };
  }

  /**
   * Assemble the list rows: unread, membership, counterpart, own pin/mute
   * state, and the last message.
   *
   * A FIXED NUMBER OF QUERIES, whatever the length of the list. One for unread,
   * one for membership, one for the caller's participant state, two for the
   * newest visible message, and at most three to resolve every display name in
   * the whole page at once. Each of these was, at some point, tempting to do
   * per row; per row is the round-trip cost this audience's network cannot
   * absorb, and it is why the chat list shipped without most of them.
   */
  private async decorate(
    rows: ConversationWithLearner[],
    actorId: string,
  ): Promise<ConversationDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((c) => c.id);
    const actor = await this.conversations.requireActor(actorId);

    const [unread, membersByConversation, viewerStates, lastMessages] = await Promise.all([
      this.messages.unreadCountsFor(ids, actorId),
      this.conversations.membersFor(ids),
      this.conversations.viewerStatesFor(ids, actorId),
      this.messages.lastVisibleMessagesFor(ids, actorId),
    ]);

    // Everything nameable in the page, gathered before a single name is looked
    // up: the 1:1 counterparts and the authors of every preview.
    const refs: ActorRef[] = [];
    const counterparts = new Map<string, { actorId: string; actorKind: string } | null>();
    for (const conv of rows) {
      const members = membersByConversation.get(conv.id) ?? [];
      const other = this.conversations.counterpartOf(conv, members, actorId);
      counterparts.set(conv.id, other);
      if (other) refs.push(other);

      const last = lastMessages.get(conv.id);
      if (last?.authorId) refs.push({ actorId: last.authorId, actorKind: last.authorType });
    }
    const directory = await this.directory.resolveMany(refs);

    return rows.map((conv) => {
      const last = lastMessages.get(conv.id);
      const lastMessage: ConversationLastMessageDto | null = last
        ? {
            id: last.id,
            type: last.type,
            authorKind: last.authorType,
            authorId: last.authorId,
            authorName: last.authorId
              ? (directory.get(last.authorId)?.displayName ?? null)
              : null,
            preview: toPreviewText(last.type, last.body),
            systemEvent:
              last.type === 'system' ? toSystemEventDto(last.body) : null,
            createdAt: last.createdAt.toISOString(),
          }
        : null;

      return toConversationDto(conv, undefined, {
        unreadCount: unread.get(conv.id) ?? 0,
        viewerRequiresApproval: this.authz.requiresApprovalFor(actor, conv),
        counterpart: counterparts.get(conv.id)
          ? { ...counterparts.get(conv.id)!, displayName: null }
          : null,
        viewerState: viewerStates.get(conv.id) ?? null,
        lastMessage,
        directory,
      });
    });
  }

  /**
   * Get or create the 1:1 channel with another actor.
   * A teacher/parent pair is refused here with COMM.BR1_TEACHER_PARENT_DIRECT.
   */
  @Post('direct')
  async direct(@ActorId() actorId: string, @Body() body: { withActorId: string }) {
    const conv = await this.conversations.getOrCreateDirect(actorId, body.withActorId);
    return toConversationDto(conv);
  }

  /** The official group for a learner, created from Core relationships. */
  @Post('student-group')
  async studentGroup(@ActorId() actorId: string, @Body() body: { learnerId: string }) {
    const conv = await this.conversations.ensureStudentGroup(body.learnerId, actorId);
    return toConversationDto(conv);
  }

  /**
   * Reconcile a group with current relationships. Staff-only, like creating
   * one -- and the actor is READ AND PASSED, which it previously was not: this
   * route took no actor at all, so its membership mutation was open to anyone
   * holding any valid token.
   */
  @Post('student-group/:learnerId/sync')
  async sync(@ActorId() actorId: string, @Param('learnerId') learnerId: string) {
    const conv = await this.conversations.syncStudentGroup(learnerId, actorId);
    return conv ? toConversationDto(conv) : { synced: false };
  }

  @Get(':id')
  async get(@ActorId() actorId: string, @Param('id') id: string) {
    const conv = await this.conversations.requireConversation(id);
    // Unchanged: setPreferences is where this route's authorization happens
    // today (API-CONTRACT 3.4 records the wart and Phase 1's fix). It runs
    // BEFORE anything below, so an actor who may not read this conversation is
    // refused here and never reaches a member list or a name.
    await this.conversations.setPreferences(id, actorId, {});

    const actor = await this.conversations.requireActor(actorId);
    const members = (await this.conversations.membersFor([id])).get(id) ?? [];
    const counterpart = this.conversations.counterpartOf(conv, members, actorId);
    const viewerState = (await this.conversations.viewerStatesFor([id], actorId)).get(id) ?? null;

    // Group Info renders every member, so every member is named -- in one
    // batch, not one lookup per row. This is the payload the client was always
    // written against: it expected `members` and the route never sent any,
    // which is why the section rendered empty.
    const directory = await this.directory.resolveMany(
      members.map((m: ConversationMember) => ({ actorId: m.actorId, actorKind: m.actorKind })),
    );

    return toConversationDto(conv, members, {
      unreadCount: await this.messages.unreadCount(id, actorId),
      viewerRequiresApproval: this.authz.requiresApprovalFor(actor, conv),
      counterpart: counterpart ? { ...counterpart, displayName: null } : null,
      viewerState,
      directory,
    });
  }

  /** Membership mutations are staff-only, and always carry a reason. */
  @Post(':id/members')
  async setMember(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body()
    body: {
      action: 'add' | 'remove';
      actorId: string;
      actorKind: string;
      memberRole: string;
      isSilent?: boolean;
      reason: string;
    },
  ) {
    await this.conversations.setMembership(
      id,
      actorId,
      {
        actorId: body.actorId,
        actorKind: body.actorKind,
        memberRole: body.memberRole,
        isSilent: body.isSilent,
      },
      body.action,
      body.reason,
    );
    return { ok: true };
  }

  /** Archive / mute / pin are per-user preferences. */
  @Post(':id/preferences')
  async preferences(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { archived?: boolean; pinned?: boolean; mutedUntil?: string | null },
  ) {
    await this.conversations.setPreferences(id, actorId, {
      archived: body.archived,
      pinned: body.pinned,
      mutedUntil: body.mutedUntil === undefined ? undefined : body.mutedUntil ? new Date(body.mutedUntil) : null,
    });
    return { ok: true };
  }
}
