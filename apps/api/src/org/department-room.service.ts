import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Conversation, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { REALTIME_REVOCATION } from '../platform/tokens';
import { NO_REALTIME_REVOCATION, type RealtimeRevocation } from '../platform/realtime-revocation';
import { ConversationService } from '../communication/conversations/conversation.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { conversationState, needsReply } from '../communication/contracts/dto';
import { ActorKind, ConversationType, MemberRole } from '../communication/contracts/vocab';

type Tx = Prisma.TransactionClient;

/** What a sync changed in one room: who joined, who left (RT-009 after commit). */
export interface RoomChange {
  conversationId: string;
  added: string[];
  removed: string[];
}

/**
 * PD-35 B6: one staff-only room per department (conversation type
 * 'department_room') -- the department's manager and its members, where
 * supervisors and their manager talk (staff-to-staff 1:1s stay disabled,
 * owner Q2).
 *
 * Who belongs is chat.department_room_party, read live by the PD-8 decision:
 * leaving the department ends access at once, whatever the member rows say.
 * The rows are kept in line here -- in the transaction that changes the
 * structure (OrgStructureService), and by the worker's sweep for anything
 * changed elsewhere (a staff member deactivated, a fixture).
 */
@Injectable()
export class DepartmentRoomService {
  private readonly log = new Logger(DepartmentRoomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    @Optional()
    @Inject(REALTIME_REVOCATION)
    private readonly revocation: RealtimeRevocation = NO_REALTIME_REVOCATION,
  ) {}

  /**
   * Find or open the department's room and bring its members in line with the
   * department. Under a per-department lock, in the caller's transaction.
   * Null when there is no such department.
   */
  async syncInTx(tx: Tx, departmentId: string, byStaffId: string | null): Promise<RoomChange | null> {
    const room = await this.ensureInTx(tx, departmentId, byStaffId);
    return room?.change ?? null;
  }

  /**
   * The department's room, synced -- for a card (B5's case_escalated). The
   * caller evicts `change.removed` after commit (RT-009), as every sync's caller does.
   */
  async roomInTx(tx: Tx, departmentId: string, byStaffId: string | null): Promise<{ conversation: Conversation; change: RoomChange } | null> {
    return this.ensureInTx(tx, departmentId, byStaffId);
  }

  /** Every department's room, one at a time; a failure is logged and the rest go on. */
  async syncAll(): Promise<{ synced: number; failed: number }> {
    const departments = await this.prisma.department.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    let synced = 0;
    let failed = 0;
    let revoked = false;
    for (const d of departments) {
      try {
        const change = await this.prisma.$transaction((tx) => this.syncInTx(tx, d.id, null));
        if (change && change.removed.length > 0) {
          this.revocation.leaveConversation(change.removed, change.conversationId);
          revoked = true;
        }
        synced += 1;
      } catch (e) {
        failed += 1;
        this.log.error(`department room sync failed for department ${d.id}: ${(e as Error).message}`);
      }
    }
    if (revoked) await this.revocation.confirmRevoked();
    return { synced, failed };
  }

  // ------------------------------------------------------------------

  private async ensureInTx(
    tx: Tx,
    departmentId: string,
    byStaffId: string | null,
  ): Promise<{ conversation: Conversation; change: RoomChange } | null> {
    const dept = await tx.department.findUnique({ where: { id: departmentId } });
    if (!dept) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'department_room:' + dept.id}))`;

    const wanted = new Set(
      (await tx.$queryRaw<Array<{ id: string }>>`
        SELECT s.id::text AS id FROM chat.staff s
         WHERE s.organization_id = ${dept.organizationId}::uuid
           AND chat.department_room_party(s.id, ${dept.id}::uuid)
         ORDER BY s.id`).map((r) => r.id),
    );

    let conv = await tx.conversation.findFirst({
      where: { type: ConversationType.DEPARTMENT_ROOM, departmentId: dept.id, archivedAt: null },
    });
    if (!conv) {
      conv = await tx.conversation.create({
        data: {
          organizationId: dept.organizationId,
          type: ConversationType.DEPARTMENT_ROOM,
          departmentId: dept.id,
          familyId: null,
          learnerId: null,
          title: dept.displayName,
          teacherRequiresApproval: false,
          parentRequiresApproval: false,
        },
      });
    } else if (conv.title !== dept.displayName) {
      // The department's name is the room's name; follow a rename, and say so.
      conv = await tx.conversation.update({ where: { id: conv.id }, data: { title: dept.displayName } });
      await this.outbox.enqueue(tx, CommEvent.CONVERSATION_UPDATED, {
        conversationId: conv.id,
        familyId: null,
        state: conversationState(conv),
        needsReply: needsReply(conv),
        lastActivityAt: conv.lastActivityAt.toISOString(),
        handlerId: null,
      });
    }

    const live = await tx.conversationMember.findMany({ where: { conversationId: conv.id, leftAt: null } });
    const present = new Set(live.map((m) => m.actorId));
    const added: string[] = [];
    for (const id of wanted) {
      if (present.has(id)) continue;
      await tx.conversationMember.create({
        data: { conversationId: conv.id, actorId: id, actorKind: ActorKind.STAFF, memberRole: MemberRole.ADMIN, addedBy: byStaffId },
      });
      added.push(id);
    }
    // Anyone else leaves -- the member guard admits nobody but the department's staff.
    const removed = live.filter((m) => !wanted.has(m.actorId)).map((m) => m.actorId);
    if (removed.length > 0) {
      await tx.conversationMember.updateMany({
        where: { conversationId: conv.id, actorId: { in: removed }, leftAt: null },
        data: { leftAt: new Date() },
      });
    }
    if (added.length > 0 || removed.length > 0) {
      await this.outbox.enqueue(tx, CommEvent.MEMBERSHIP_CHANGED, { conversationId: conv.id, added, removed });
    }
    return { conversation: conv, change: { conversationId: conv.id, added, removed } };
  }
}
