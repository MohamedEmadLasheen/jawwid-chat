import { Body, Controller, Get, Patch, Query, UseFilters } from '@nestjs/common';
import { CommError, CommErrorCode } from '../../platform/errors';
import { PrismaService } from '../../platform/prisma.service';
import { ConversationService, isUuid } from '../conversations/conversation.service';
import { ActorKind } from '../contracts/vocab';
import { PresencePolicy } from '../realtime/presence-policy';
import { PresenceService } from '../realtime/presence.service';
import { ActionScope, RateLimited } from '../../platform/auth/action-throttle.guard';
import { ActorId } from './actor.decorator';
import { CommErrorFilter } from './http-exception.filter';
import { Requires, SelfService } from '../../platform/permissions/route-access';

/** The most people one `GET /presence` may ask about. */
const MAX_PEOPLE = 100;

function idList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(isUuid))];
}

/**
 * PD-37: online / last seen. Who may see whose is PresencePolicy's alone; this
 * controller asks it and answers only for the people it allows. Someone the
 * caller may not see is simply absent from the answer -- not "offline".
 */
@Controller()
@UseFilters(CommErrorFilter)
export class PresenceController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly presence: PresenceService,
    private readonly policy: PresencePolicy,
    private readonly prisma: PrismaService,
  ) {}

  /** `GET /presence?staff=<id,…>&teachers=<id,…>` -- up to 100 people. */
  @RateLimited(ActionScope.PRESENCE_READ)
  @Requires('chat.use')
  @Get('presence')
  async read(@ActorId() actorId: string, @Query('staff') staff?: string, @Query('teachers') teachers?: string) {
    const viewer = await this.conversations.requireActor(actorId);
    const staffIds = idList(staff);
    const teacherIds = idList(teachers);
    if (staffIds.length + teacherIds.length > MAX_PEOPLE) {
      throw new CommError(CommErrorCode.VALIDATION, `ask about at most ${MAX_PEOPLE} people at once`, 400);
    }
    const grants = await this.policy.visibleTo(viewer, { staffIds, teacherIds });
    const snapshot = await this.presence.snapshot([...grants.keys()]);
    return {
      presence: [...grants].map(([id, grant]) => {
        const now = snapshot.get(id);
        return {
          actorId: id,
          online: now?.online ?? false,
          lastSeenAt: grant.lastSeen ? (now?.lastSeenAt?.toISOString() ?? null) : null,
        };
      }),
    };
  }

  /** The caller's own presence settings (staff only). */
  @SelfService()
  @Get('me/presence')
  async settings(@ActorId() actorId: string) {
    const staffId = await this.requireStaff(actorId);
    const row = await this.prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: { hideLastSeen: true } });
    return { hideLastSeen: row.hideLastSeen };
  }

  /**
   * `PATCH /me/presence { hideLastSeen }` -- WhatsApp's switch. On: nobody sees
   * the caller's last seen, and the caller sees nobody's. Online stays visible.
   */
  @SelfService()
  @Patch('me/presence')
  async update(@ActorId() actorId: string, @Body() body: { hideLastSeen?: unknown }) {
    const staffId = await this.requireStaff(actorId);
    if (typeof body?.hideLastSeen !== 'boolean') {
      throw new CommError(CommErrorCode.VALIDATION, 'hideLastSeen must be true or false', 400);
    }
    const row = await this.prisma.staff.update({
      where: { id: staffId },
      data: { hideLastSeen: body.hideLastSeen },
      select: { hideLastSeen: true },
    });
    return { hideLastSeen: row.hideLastSeen };
  }

  private async requireStaff(actorId: string): Promise<string> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.isActive) {
      throw new CommError(CommErrorCode.PRESENCE_DENIED, 'presence settings are for Jawwid staff', 403);
    }
    return actor.actorId;
  }
}
