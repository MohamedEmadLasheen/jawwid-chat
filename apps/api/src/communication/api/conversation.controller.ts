import { StaffToolsService } from '../staff-tools/staff-tools.service';
import { signAvatar } from '../profile/avatar-urls';
import { Body, Controller, Inject, Optional, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ConversationService } from '../conversations/conversation.service';
import { MessageService } from '../messages/message.service';
import { CallService } from '../calls/call.service';
import { toConversationDto, toLastMessageDto, type ConversationViewerStateDto, type ResolvedMember } from '../contracts/dto';
import { AuthorizationService } from '../../platform/authorization.service';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import { signWallpaper } from '../themes/wallpaper-urls';
import { SUBSCRIPTION_LOCK } from '../../platform/tokens';
import type { SubscriptionLockReader } from '../../platform/subscription-lock';
import type { Actor } from '../../platform/types';

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
    private readonly calls: CallService,
    private readonly authz: AuthorizationService,
    // Optional only so the positional constructions the harnesses share do not
    // shift; without it no labels are attached.
    @Optional() private readonly tools?: StaffToolsService,
    // PD-30: whether the group is locked for payment, for the banner.
    @Optional() @Inject(SUBSCRIPTION_LOCK) private readonly locks?: SubscriptionLockReader,
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
    const actor = await this.conversations.requireActor(actorId);
    const rows = await this.conversations.listForActor(actorId);
    const ids = rows.map((c) => c.id);
    // Every per-row fact is computed for exactly the ids listForActor
    // authorized, each in one batch: unread counts (the caller's own
    // receipts), members with names, the viewer's own preferences, and the
    // newest message THIS viewer may see.
    const [unread, members, states, last, children] = await Promise.all([
      this.messages.unreadCountsFor(ids, actorId),
      this.conversations.membersOfMany(ids, actor),
      this.conversations.viewerStates(ids, actor.actorId),
      this.messages.lastVisibleMessages(ids, actor),
      // A group's picture: its one child's photo (one query for the whole list).
      this.conversations.soleChildOf(rows.filter((c) => c.type !== 'direct')),
    ]);
    // The viewer's PRIVATE labels (staff only); families never get the field.
    const labels = actor.kind === 'staff' && this.tools ? await this.tools.labelsFor(actor.actorId, ids) : null;

    // Search narrows the caller's own list -- it never widens it. A row matches
    // on its title, its child's name, or a member's display name.
    const needle = typeof q === 'string' ? q.trim().toLocaleLowerCase().slice(0, 100) : '';
    const matches = (c: (typeof rows)[number]) =>
      !needle ||
      [c.title, c.learner?.name, ...(members.get(c.id) ?? []).map((m: ResolvedMember) => m.displayName)].some(
        (text) => typeof text === 'string' && text.toLocaleLowerCase().includes(needle),
      );

    return {
      conversations: rows.filter(matches).map((c) =>
        toConversationDto(c, members.get(c.id), {
          unreadCount: unread.get(c.id) ?? 0,
          // PD-14: nothing is held for approval. Still sent, as false, for
          // clients built before it.
          viewerRequiresApproval: false,
          viewerState: viewerState(states.get(c.id), c.id, actor.actorId),
          lastMessage: last.has(c.id) ? toLastMessageDto(last.get(c.id)!) : null,
          learnerAvatarUrl: c.learner
            ? signAvatar('learner', c.learner.id, c.id, actor.actorId, c.learner.avatarObjectKey)
            : null,
          avatarUrl: children.has(c.id)
            ? signAvatar('learner', children.get(c.id)!.id, c.id, actor.actorId, children.get(c.id)!.avatarObjectKey)
            : null,
          ...(labels ? { labels: labels.get(c.id) ?? [] } : {}),
        }),
      ),
    };
  }

  /**
   * Get or create the 1:1 channel with another actor.
   *
   * BR-1 (PD-7): a teacher/parent pair is refused outright with
   * COMM.BR1_TEACHER_PARENT_DIRECT, whatever their relationship. `withActorId`
   * selects the other party; it asserts nothing about them.
   */
  @Post('direct')
  async direct(@ActorId() actorId: string, @Body() body: { withActorId: string }) {
    const conv = await this.conversations.getOrCreateDirect(actorId, body.withActorId);
    // PD-6: members[] so the client can tell a Parent<->Teacher channel from a
    // Parent<->Admin one. The caller was just authorized into this conversation
    // by getOrCreateDirect, so no second read check is needed -- but the viewer is
    // passed so `canOpenDirect` is answered for THIS caller rather than defaulting
    // to false on the one route that returns a freshly opened channel.
    return toConversationDto(
      conv,
      await this.conversations.membersOf(conv.id, await this.conversations.requireActor(actorId)),
    );
  }

  /**
   * PD-8: a supervisor creates a group about one or more of their children in
   * ONE family, with the parents and teachers they choose from that family and
   * those children. Every participant is validated server side and by the
   * database; see ConversationService.createFamilyGroup.
   */
  @Post('family-group')
  async familyGroup(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    const conv = await this.conversations.createFamilyGroup(actorId, body ?? {});
    return toConversationDto(
      conv,
      await this.conversations.membersOf(conv.id, await this.conversations.requireActor(actorId)),
    );
  }

  /** The official group for a learner, created from Core relationships. */
  @Post('student-group')
  async studentGroup(@ActorId() actorId: string, @Body() body: { learnerId: string }) {
    const conv = await this.conversations.ensureStudentGroup(body.learnerId, actorId);
    return toConversationDto(conv);
  }

  @Post('student-group/:learnerId/sync')
  async sync(@ActorId() actorId: string, @Param('learnerId') learnerId: string) {
    const conv = await this.conversations.syncStudentGroup(learnerId, actorId);
    return conv ? toConversationDto(conv) : { synced: false };
  }

  /**
   * One conversation, with its membership.
   *
   * `members[]` is required here by API-CONTRACT section 3.4 and is what lets a
   * client classify a `direct` conversation after PD-6. readWithMembers()
   * authorizes the read explicitly rather than leaving it to the preferences
   * upsert below to throw.
   */
  @Get(':id')
  async get(@ActorId() actorId: string, @Param('id') id: string) {
    // Authorization is EXPLICIT here. It used to ride on setPreferences
    // throwing (API-CONTRACT 3.4 recorded the wart), which meant the route was
    // readable only by tracing a side effect. readWithMembers runs canRead
    // against the actor's membership and refuses before anything is read.
    const { conversation, members } = await this.conversations.readWithMembers(id, actorId);

    // setPreferences stays, for what it is actually for: the per-actor
    // preference/read row. It is no longer this route's access control.
    await this.conversations.setPreferences(id, actorId, {});

    // Members carry display names (mobile gap O3); `readWithMembers` resolves
    // them through the one batch primitive. Only on this route: the LIST
    // endpoint deliberately does not load members, because that would be an
    // identity batch per row for a screen that renders none of them.
    const actor = await this.conversations.requireActor(actorId);
    const [states, last, children] = await Promise.all([
      this.conversations.viewerStates([conversation.id], actor.actorId),
      this.messages.lastVisibleMessages([conversation.id], actor),
      conversation.type === 'direct' ? new Map() : this.conversations.soleChildOf([conversation]),
    ]);
    const child = children.get(conversation.id) as { id: string; avatarObjectKey: string | null } | undefined;
    const labels =
      actor.kind === 'staff' && this.tools ? await this.tools.labelsFor(actor.actorId, [conversation.id]) : null;
    const away = await this.conversations.teachersAway(
      members.filter((m) => m.actorKind === 'teacher' && m.actorId !== actor.actorId).map((m) => m.actorId),
      actor.kind === 'staff',
    );
    const paymentLock = await this.paymentLockView(actor, conversation);
    const dto = toConversationDto(conversation, members.map((m) => (away.has(m.actorId) ? { ...m, away: away.get(m.actorId) } : m)), {
      unreadCount: await this.messages.unreadCount(id, actorId),
      viewerRequiresApproval: false, // PD-14
      viewerModerates: this.authz.moderatableAuthorKinds(actor, await this.conversations.staffAccess(actor, conversation)),
      viewerState: viewerState(states.get(conversation.id), conversation.id, actor.actorId),
      lastMessage: last.has(conversation.id) ? toLastMessageDto(last.get(conversation.id)!) : null,
      learnerAvatarUrl: conversation.learner
        ? signAvatar('learner', conversation.learner.id, conversation.id, actor.actorId, conversation.learner.avatarObjectKey)
        : null,
      avatarUrl: child ? signAvatar('learner', child.id, conversation.id, actor.actorId, child.avatarObjectKey) : null,
      ...(labels ? { labels: labels.get(conversation.id) ?? [] } : {}),
    });
    return { ...dto, paymentLock };
  }

  /**
   * PD-30: the banner of a group locked for payment, or null. Advisory -- every
   * send, reaction and call is refused by the server on its own. It names each
   * locked child; the parent and staff also read why ("lessons used up",
   * "instalment 2/3 overdue since ..."), the teacher only that the lessons are
   * paused (nothing financial). `readOnly` is the viewer's: staff still write.
   */
  private async paymentLockView(actor: Actor, conversation: { id: string; type: string }) {
    if (!this.locks?.enforced) return null;
    if (conversation.type !== 'family_group' && conversation.type !== 'student_group') return null;
    const locked = await this.locks.lockedChildren(conversation.id);
    if (locked.length === 0) return null;
    const financial = actor.kind !== 'teacher';
    return {
      readOnly: actor.kind !== 'staff',
      canPay: actor.kind === 'contact',
      children: locked.map((c) =>
        financial
          ? {
              id: c.learnerId,
              name: c.learnerName,
              reasons: c.reasons,
              overdue: c.overdueDueOn ? { label: c.instalmentLabel, dueDate: c.overdueDueOn } : null,
            }
          : { id: c.learnerId, name: c.learnerName },
      ),
    };
  }

  /**
   * May the caller start a call in this conversation? ADVISORY.
   *
   * The interface needs this because it may not work it out for itself:
   * `screens/call.md` section 4 requires the call affordance to be ABSENT
   * where the backend does not authorize the pairing, and forbids the client
   * inferring which pairings those are. Since PD-6 that set is data.
   *
   * NOT AN AUTHORIZATION. `canCall: true` is this instant's answer and does not
   * promise that the POST which follows will succeed -- `POST /calls` decides
   * again, from scratch, and is the only thing that authorizes a call. A
   * relationship revoked in between is refused there, as it should be.
   *
   * Read access is established first, so this cannot be used to probe a
   * conversation the caller cannot open: that case returns the read path's own
   * error, not a capability answer.
   *
   * Response: `{ canCall, code }` -- the code a stable COMM.* value or null,
   * and nothing else. No ids, no names, no relationship detail.
   */
  @Get(':id/call-capability')
  async callCapability(@ActorId() actorId: string, @Param('id') id: string) {
    return this.calls.callCapability(id, actorId);
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
    // Passed through as received: the service validates every field and judges
    // the member from their own row, so nothing here is trusted.
    await this.conversations.setMembership(
      id,
      actorId,
      {
        actorId: body?.actorId,
        actorKind: body?.actorKind,
        memberRole: body?.memberRole,
        isSilent: body?.isSilent,
      },
      body?.action,
      body?.reason,
    );
    return { ok: true };
  }

  /** Archive / mute / pin / favorite are per-user preferences. */
  @Post(':id/preferences')
  async preferences(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Body() body: { archived?: boolean; pinned?: boolean; mutedUntil?: string | null; favorite?: boolean },
  ) {
    await this.conversations.setPreferences(id, actorId, {
      archived: body.archived,
      pinned: body.pinned,
      favorite: typeof body.favorite === 'boolean' ? body.favorite : undefined,
      mutedUntil: body.mutedUntil === undefined ? undefined : body.mutedUntil ? new Date(body.mutedUntil) : null,
    });
    return { ok: true };
  }
}

/** The viewer's stored preferences, or the defaults when they never set any. */
function viewerState(
  row:
    | {
        pinnedAt: Date | null
        archivedAt: Date | null
        mutedUntil: Date | null
        favoritedAt: Date | null
        theme: string | null
        wallpaperObjectKey: string | null
      }
    | undefined,
  conversationId: string,
  viewerId: string,
): ConversationViewerStateDto {
  return {
    pinned: !!row?.pinnedAt,
    favorite: !!row?.favoritedAt,
    archived: !!row?.archivedAt,
    mutedUntil: row?.mutedUntil?.toISOString() ?? null,
    theme: row?.theme ?? null,
    wallpaperUrl: signWallpaper(conversationId, viewerId, row?.wallpaperObjectKey),
  };
}
