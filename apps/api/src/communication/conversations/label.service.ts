import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { Actor, isConversationStaff } from '../../platform/types';
import { ConversationService, isUuid } from './conversation.service';

export interface ChatLabelDto {
  id: string;
  name: string;
  /** One of the eight label tones the clients draw, 1..8. */
  color: number;
}

/**
 * Chat labels: an organization's shared tags for conversations (owner request
 * 2026-10-19, "admins must be able to create and manage labels").
 *
 * STAFF ONLY, in both directions. Only conversation staff may list, create,
 * rename, recolour, delete or apply them, and a label never appears on any
 * DTO served to a parent or a teacher -- `labelsFor` answers only for staff.
 * Applying one needs read access to the conversation (the same check every
 * read path takes); the label must be of the conversation's organization,
 * which the database also enforces (chat.enforce_conversation_label_tenant).
 *
 * Every change is audited. Labels carry no family data.
 */
@Injectable()
export class LabelService {
  /** initial hypothesis: enough for a team's working set, few enough to scan as filter chips. */
  static readonly MAX_LABELS = 50;
  static readonly MAX_NAME = 40;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async list(actorId: string): Promise<{ labels: ChatLabelDto[] }> {
    const { organizationId } = await this.requireLabelStaff(actorId);
    const rows = await this.prisma.chatLabel.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { labels: rows.map(toDto) };
  }

  async create(actorId: string, input: { name?: unknown; color?: unknown }): Promise<ChatLabelDto> {
    const { actor, organizationId } = await this.requireLabelStaff(actorId);
    const name = validName(input.name);
    const color = input.color === undefined ? 1 : validColor(input.color);

    return this.prisma.$transaction(async (tx) => {
      // Serialize creations per organization so two at once cannot pass the cap.
      await tx.$queryRaw`SELECT id FROM chat.organization WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const count = await tx.chatLabel.count({ where: { organizationId } });
      if (count >= LabelService.MAX_LABELS) {
        throw new CommError(
          CommErrorCode.LABEL_LIMIT_REACHED,
          `an organization holds at most ${LabelService.MAX_LABELS} labels`,
          409,
        );
      }
      const row = await nameTaken(() =>
        tx.chatLabel.create({ data: { organizationId, name, color, createdBy: actor.actorId } }),
      );
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'chat_label.create',
        entity: 'chat_label',
        entityId: row.id,
        after: { name, color },
        reason: 'label created',
      });
      return toDto(row);
    });
  }

  async update(
    actorId: string,
    labelId: string,
    input: { name?: unknown; color?: unknown },
  ): Promise<ChatLabelDto> {
    const { actor, organizationId } = await this.requireLabelStaff(actorId);
    const existing = await this.requireLabel(labelId, organizationId);
    const patch = {
      name: input.name === undefined ? undefined : validName(input.name),
      color: input.color === undefined ? undefined : validColor(input.color),
    };
    return this.prisma.$transaction(async (tx) => {
      const row = await nameTaken(() => tx.chatLabel.update({ where: { id: existing.id }, data: patch }));
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'chat_label.update',
        entity: 'chat_label',
        entityId: row.id,
        before: { name: existing.name, color: existing.color },
        after: { name: row.name, color: row.color },
        reason: 'label edited',
      });
      return toDto(row);
    });
  }

  /** Deleting a label removes it from every conversation (cascade). */
  async remove(actorId: string, labelId: string): Promise<void> {
    const { actor, organizationId } = await this.requireLabelStaff(actorId);
    const existing = await this.requireLabel(labelId, organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.chatLabel.delete({ where: { id: existing.id } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'chat_label.delete',
        entity: 'chat_label',
        entityId: existing.id,
        before: { name: existing.name, color: existing.color },
        reason: 'label deleted',
      });
    });
  }

  /** Apply (`on`) or remove a label on a conversation the caller can read. Idempotent. */
  async setOnConversation(actorId: string, conversationId: string, labelId: string, on: boolean): Promise<void> {
    const { actor, organizationId } = await this.requireLabelStaff(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const decision = await this.conversations.canReadResolved(actor, conv, membership);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    const label = await this.requireLabel(labelId, organizationId);
    // The conversation's own organization, as a second bound: a staff member
    // who could read across tenants still could not cross-label.
    if (conv.organizationId !== label.organizationId) {
      throw new CommError(CommErrorCode.LABEL_NOT_FOUND, 'label not found', 404);
    }

    await this.prisma.$transaction(async (tx) => {
      if (on) {
        const created = await tx.conversationLabel.createMany({
          data: [{ conversationId: conv.id, labelId: label.id, labeledBy: actor.actorId }],
          skipDuplicates: true,
        });
        if (created.count === 0) return;
      } else {
        const removed = await tx.conversationLabel.deleteMany({ where: { conversationId: conv.id, labelId: label.id } });
        if (removed.count === 0) return;
      }
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: on ? 'conversation.label_added' : 'conversation.label_removed',
        entity: 'conversation',
        entityId: conv.id,
        after: { labelId: label.id },
        reason: on ? 'label applied' : 'label removed',
      });
    });
  }

  /**
   * The labels on these conversations, for a staff viewer; EMPTY for anyone
   * else, so a label cannot reach a parent or a teacher through the list.
   * THE CALLER AUTHORIZES THE IDS (the list route passes what listForActor
   * returned). One query.
   */
  async labelsFor(conversationIds: readonly string[], actor: Actor): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!isConversationStaff(actor) || !actor.organizationId || conversationIds.length === 0) return out;
    const rows = await this.prisma.conversationLabel.findMany({
      where: { conversationId: { in: [...conversationIds] }, label: { organizationId: actor.organizationId } },
      orderBy: { labeledAt: 'asc' },
      select: { conversationId: true, labelId: true },
    });
    for (const r of rows) out.set(r.conversationId, [...(out.get(r.conversationId) ?? []), r.labelId]);
    return out;
  }

  private async requireLabelStaff(actorId: string): Promise<{ actor: Actor; organizationId: string }> {
    const actor = await this.conversations.requireActor(actorId);
    if (!isConversationStaff(actor) || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.LABELS_STAFF_ONLY, 'labels are for staff');
    }
    return { actor, organizationId: actor.organizationId };
  }

  /** Another organization's label reads exactly as an unknown one. */
  private async requireLabel(labelId: string, organizationId: string) {
    const label = isUuid(labelId)
      ? await this.prisma.chatLabel.findFirst({ where: { id: labelId, organizationId } })
      : null;
    if (!label) throw new CommError(CommErrorCode.LABEL_NOT_FOUND, 'label not found', 404);
    return label;
  }
}

function toDto(row: { id: string; name: string; color: number }): ChatLabelDto {
  return { id: row.id, name: row.name, color: row.color };
}

function validName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > LabelService.MAX_NAME) {
    throw new CommError(
      CommErrorCode.VALIDATION,
      `name: a label name is 1 to ${LabelService.MAX_NAME} characters`,
      400,
    );
  }
  return name;
}

function validColor(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 8) {
    throw new CommError(CommErrorCode.VALIDATION, 'color: an integer from 1 to 8', 400);
  }
  return raw;
}

/** A duplicate name (case-insensitive, chat_label_org_name_key) is a 409, not a 500. */
async function nameTaken<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new CommError(CommErrorCode.LABEL_NAME_TAKEN, 'a label with this name already exists', 409);
    }
    throw e;
  }
}
