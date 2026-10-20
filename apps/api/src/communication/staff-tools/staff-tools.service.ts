import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { isConversationStaff, type Actor } from '../../platform/types';
import { ConversationService, isUuid } from '../conversations/conversation.service';

export interface LabelDto {
  id: string;
  name: string;
  /** '1'..'8': a palette tone. */
  color: string;
}

export interface QuickReplyDto {
  id: string;
  shortcut: string;
  body: string;
  /** 'team': the organization's library; 'mine': the caller's own. */
  scope: 'team' | 'mine';
  updatedAt: string;
}

const COLORS: ReadonlySet<string> = new Set(['1', '2', '3', '4', '5', '6', '7', '8']);
const SHORTCUT = /^[\p{L}\p{N}_-]{1,24}$/u;

const denied = () =>
  new CommError(CommErrorCode.STAFF_TOOLS_DENIED, 'labels and quick replies are for Jawwid staff', 403);
const notFound = () => new CommError(CommErrorCode.STAFF_TOOL_NOT_FOUND, 'not found', 404);
const invalid = (message: string) => new CommError(CommErrorCode.STAFF_TOOL_INVALID, message, 400);

/**
 * Staff tools (Chat UI group B, owner decisions 2026-10-19).
 *
 * LABELS are PRIVATE to each staff member: their own labels, applied to chats
 * they can open; no colleague, family or teacher ever sees them. Every query
 * below is keyed by the caller's own staff id, so another person's label reads
 * as absent (404), never as forbidden.
 *
 * QUICK REPLIES: one TEAM library per organization -- any staff member may add,
 * edit or delete in it -- plus each staff member's PERSONAL replies, which only
 * their owner sees or changes.
 */
@Injectable()
export class StaffToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
  ) {}

  private async requireStaff(actorId: string): Promise<Actor & { organizationId: string }> {
    const actor = await this.conversations.requireActor(actorId);
    if (!isConversationStaff(actor) || !actor.isActive || !actor.organizationId) throw denied();
    return actor as Actor & { organizationId: string };
  }

  // ------------------------------------------------------------- labels

  async labels(actorId: string): Promise<{ labels: Array<LabelDto & { conversationCount: number }> }> {
    const staff = await this.requireStaff(actorId);
    const rows = await this.prisma.staffLabel.findMany({
      where: { ownerStaffId: staff.actorId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { conversations: true } } },
    });
    return { labels: rows.map((r) => ({ id: r.id, name: r.name, color: r.color, conversationCount: r._count.conversations })) };
  }

  async createLabel(actorId: string, input: { name?: unknown; color?: unknown }): Promise<LabelDto> {
    const staff = await this.requireStaff(actorId);
    const { name, color } = this.labelFields(input, true);
    try {
      const row = await this.prisma.staffLabel.create({
        data: { organizationId: staff.organizationId, ownerStaffId: staff.actorId, name: name!, color: color! },
      });
      return { id: row.id, name: row.name, color: row.color };
    } catch (error) {
      throw this.conflictOr(error, 'you already have a label with that name');
    }
  }

  async updateLabel(actorId: string, labelId: string, input: { name?: unknown; color?: unknown }): Promise<LabelDto> {
    const staff = await this.requireStaff(actorId);
    const own = await this.ownLabel(staff, labelId);
    const { name, color } = this.labelFields(input, false);
    try {
      const row = await this.prisma.staffLabel.update({
        where: { id: own.id },
        data: { ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}) },
      });
      return { id: row.id, name: row.name, color: row.color };
    } catch (error) {
      throw this.conflictOr(error, 'you already have a label with that name');
    }
  }

  async deleteLabel(actorId: string, labelId: string): Promise<void> {
    const staff = await this.requireStaff(actorId);
    const own = await this.ownLabel(staff, labelId);
    await this.prisma.staffLabel.delete({ where: { id: own.id } }); // its taggings cascade
  }

  /**
   * Set which of the caller's OWN labels tag a conversation they can open.
   * Only the caller's labels are touched; nobody else's tagging exists to them.
   */
  async setConversationLabels(actorId: string, conversationId: string, labelIds: unknown): Promise<{ labels: LabelDto[] }> {
    const staff = await this.requireStaff(actorId);
    const ids = [...new Set(Array.isArray(labelIds) ? labelIds.filter((x): x is string => typeof x === 'string') : [])];
    if (!ids.every(isUuid)) throw notFound();
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, staff.actorId);
    const decision = await this.conversations.canReadResolved(staff, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const mine = await this.prisma.staffLabel.findMany({ where: { ownerStaffId: staff.actorId }, select: { id: true } });
    const mineIds = new Set(mine.map((l) => l.id));
    if (!ids.every((id) => mineIds.has(id))) throw notFound();

    await this.prisma.$transaction([
      this.prisma.conversationLabel.deleteMany({ where: { conversationId: conv.id, labelId: { in: [...mineIds] } } }),
      this.prisma.conversationLabel.createMany({ data: ids.map((labelId) => ({ labelId, conversationId: conv.id })) }),
    ]);
    return { labels: (await this.labelsFor(staff.actorId, [conv.id])).get(conv.id) ?? [] };
  }

  /** The VIEWER's labels on each conversation -- for the chat list and header. One query. */
  async labelsFor(staffId: string, conversationIds: readonly string[]): Promise<Map<string, LabelDto[]>> {
    const out = new Map<string, LabelDto[]>();
    if (conversationIds.length === 0) return out;
    const rows = await this.prisma.conversationLabel.findMany({
      where: { conversationId: { in: [...conversationIds] }, label: { ownerStaffId: staffId } },
      include: { label: true },
      orderBy: { label: { name: 'asc' } },
    });
    for (const r of rows) {
      out.set(r.conversationId, [...(out.get(r.conversationId) ?? []), { id: r.label.id, name: r.label.name, color: r.label.color }]);
    }
    return out;
  }

  private async ownLabel(staff: Actor, labelId: string) {
    if (!isUuid(labelId)) throw notFound();
    const row = await this.prisma.staffLabel.findFirst({ where: { id: labelId, ownerStaffId: staff.actorId } });
    if (!row) throw notFound();
    return row;
  }

  private labelFields(input: { name?: unknown; color?: unknown }, required: boolean) {
    const name = input.name === undefined ? undefined : typeof input.name === 'string' ? input.name.trim() : null;
    const color = input.color === undefined ? undefined : typeof input.color === 'string' ? input.color : null;
    if (required && (name === undefined || color === undefined)) throw invalid('a label needs a name and a colour');
    if (name !== undefined && (name === null || name.length < 1 || name.length > 40)) {
      throw invalid('a label name is 1 to 40 characters');
    }
    if (color !== undefined && (color === null || !COLORS.has(color))) throw invalid('choose one of the eight label colours');
    return { name: name ?? undefined, color: color ?? undefined };
  }

  // ------------------------------------------------------- quick replies

  async quickReplies(actorId: string): Promise<{ team: QuickReplyDto[]; mine: QuickReplyDto[] }> {
    const staff = await this.requireStaff(actorId);
    const rows = await this.prisma.quickReply.findMany({
      where: {
        organizationId: staff.organizationId,
        OR: [{ ownerStaffId: null }, { ownerStaffId: staff.actorId }],
      },
      orderBy: { shortcut: 'asc' },
    });
    const dto = (r: (typeof rows)[number]): QuickReplyDto => ({
      id: r.id,
      shortcut: r.shortcut,
      body: r.body,
      scope: r.ownerStaffId ? 'mine' : 'team',
      updatedAt: r.updatedAt.toISOString(),
    });
    return { team: rows.filter((r) => !r.ownerStaffId).map(dto), mine: rows.filter((r) => r.ownerStaffId).map(dto) };
  }

  async createQuickReply(actorId: string, input: { shortcut?: unknown; body?: unknown; scope?: unknown }): Promise<QuickReplyDto> {
    const staff = await this.requireStaff(actorId);
    const { shortcut, body } = this.replyFields(input, true);
    if (input.scope !== 'team' && input.scope !== 'mine') throw invalid("scope is 'team' or 'mine'");
    try {
      const row = await this.prisma.quickReply.create({
        data: {
          organizationId: staff.organizationId,
          ownerStaffId: input.scope === 'mine' ? staff.actorId : null,
          shortcut: shortcut!,
          body: body!,
          createdBy: staff.actorId,
          updatedBy: staff.actorId,
        },
      });
      return { id: row.id, shortcut: row.shortcut, body: row.body, scope: input.scope, updatedAt: row.updatedAt.toISOString() };
    } catch (error) {
      throw this.conflictOr(error, 'that shortcut is already used in this library');
    }
  }

  async updateQuickReply(actorId: string, id: string, input: { shortcut?: unknown; body?: unknown }): Promise<QuickReplyDto> {
    const staff = await this.requireStaff(actorId);
    const row = await this.editableReply(staff, id);
    const { shortcut, body } = this.replyFields(input, false);
    try {
      const updated = await this.prisma.quickReply.update({
        where: { id: row.id },
        data: { ...(shortcut !== undefined ? { shortcut } : {}), ...(body !== undefined ? { body } : {}), updatedBy: staff.actorId },
      });
      return {
        id: updated.id,
        shortcut: updated.shortcut,
        body: updated.body,
        scope: updated.ownerStaffId ? 'mine' : 'team',
        updatedAt: updated.updatedAt.toISOString(),
      };
    } catch (error) {
      throw this.conflictOr(error, 'that shortcut is already used in this library');
    }
  }

  async deleteQuickReply(actorId: string, id: string): Promise<void> {
    const staff = await this.requireStaff(actorId);
    const row = await this.editableReply(staff, id);
    await this.prisma.quickReply.delete({ where: { id: row.id } });
  }

  /** A team reply of the caller's organization, or the caller's own personal one. */
  private async editableReply(staff: Actor & { organizationId: string }, id: string) {
    if (!isUuid(id)) throw notFound();
    const row = await this.prisma.quickReply.findFirst({
      where: { id, organizationId: staff.organizationId, OR: [{ ownerStaffId: null }, { ownerStaffId: staff.actorId }] },
    });
    if (!row) throw notFound();
    return row;
  }

  private replyFields(input: { shortcut?: unknown; body?: unknown }, required: boolean) {
    const raw = input.shortcut;
    const shortcut = raw === undefined ? undefined : typeof raw === 'string' ? raw.trim().replace(/^\//, '') : null;
    const body = input.body === undefined ? undefined : typeof input.body === 'string' ? input.body.trim() : null;
    if (required && (shortcut === undefined || body === undefined)) throw invalid('a quick reply needs a shortcut and a text');
    if (shortcut !== undefined && (shortcut === null || !SHORTCUT.test(shortcut))) {
      throw invalid('a shortcut is 1 to 24 letters, digits, _ or -');
    }
    if (body !== undefined && (body === null || body.length < 1 || body.length > 2000)) {
      throw invalid('a quick reply is 1 to 2000 characters');
    }
    return { shortcut: shortcut ?? undefined, body: body ?? undefined };
  }

  private conflictOr(error: unknown, message: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new CommError(CommErrorCode.STAFF_TOOL_CONFLICT, message, 409);
    }
    return error;
  }
}
