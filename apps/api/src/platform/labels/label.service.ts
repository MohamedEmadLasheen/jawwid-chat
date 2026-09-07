import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthorizationService } from '../authorization.service';
import { ALL_FAMILIES, ScopeService } from '../scope.service';
import { Actor } from '../types';
import { CommError, CommErrorCode } from '../errors';
import { Permission } from '../rbac/permissions';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { ActorKind } from '../../communication/contracts/vocab';

export interface LabelView {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  familyCount: number;
  createdAt: string;
}

/** Per-family outcome of a bulk operation. Deterministic and complete. */
export interface BulkOutcome {
  familyId: string;
  status: 'applied' | 'already' | 'out_of_scope' | 'not_found';
}

/**
 * LABELS -- the academy's own filing system over families.
 *
 * Deliberately inert: nothing in authorization, scope or messaging reads a
 * label. A label that could grant access would be a role with no audit trail
 * and no reason column.
 *
 * THE PERMISSION SPLIT, which is the whole design:
 *
 *   labels.manage    curating the VOCABULARY -- create, rename, delete. A
 *                    manager's act, because it changes what every supervisor
 *                    sees.
 *   families.manage  FILING a family under an existing label. An ordinary
 *                    supervisor's act, narrowed to their own families by scope.
 *
 * Without that split, either every admin could rename the shared vocabulary, or
 * only a manager could tag a family -- and the second makes the feature useless.
 */
@Injectable()
export class LabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly scope: ScopeService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private require(actor: Actor, permission: Permission | string): void {
    const decision = this.authz.can(actor, permission);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
  }

  private org(actor: Actor) {
    return actor.organizationId ? { organizationId: actor.organizationId } : {};
  }

  /** The live vocabulary. Soft-deleted labels are never offered. */
  async list(actor: Actor): Promise<LabelView[]> {
    this.require(actor, Permission.LABELS_READ);
    const rows = await this.prisma.label.findMany({
      where: { ...this.org(actor), deletedAt: null },
      include: { _count: { select: { families: true } } },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return rows.map(toLabelView);
  }

  private async requireLabel(actor: Actor, labelId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, ...this.org(actor), deletedAt: null },
    });
    if (!label) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'label not found', 404);
    return label;
  }

  async create(
    actor: Actor,
    input: { name: string; color?: string | null; description?: string | null },
  ): Promise<LabelView> {
    this.require(actor, Permission.LABELS_MANAGE);
    const name = requireText(input.name, 'a label needs a name');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const label = await tx.label.create({
          data: {
            name,
            color: input.color ?? null,
            description: input.description ?? null,
            createdBy: staffIdOf(actor),
          },
          include: { _count: { select: { families: true } } },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'label.created',
          entity: 'label',
          entityId: label.id,
          reason: `label "${name}" created`,
          after: { name },
        });
        await this.audit.event(tx, {
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'label_created',
          payload: { labelId: label.id, name },
        });
        return toLabelView(label);
      });
    } catch (error) {
      // The case-insensitive partial unique index is what makes two admins
      // racing to create "VIP" resolve to one label rather than two.
      if ((error as { code?: string })?.code === 'P2002') {
        throw new CommError(
          CommErrorCode.GROUP_ALREADY_EXISTS,
          `a label named "${name}" already exists`,
          409,
        );
      }
      throw error;
    }
  }

  /**
   * Rename or restyle. The label KEEPS ITS IDENTITY -- "Renewal" becoming
   * "Renewal Soon" is an edit, not a new label, so every family already filed
   * under it stays filed.
   */
  async update(
    actor: Actor,
    labelId: string,
    input: { name?: string; color?: string | null; description?: string | null },
  ): Promise<LabelView> {
    this.require(actor, Permission.LABELS_MANAGE);
    const label = await this.requireLabel(actor, labelId);

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = requireText(input.name, 'a label needs a name');
    if (input.color !== undefined) data.color = input.color;
    if (input.description !== undefined) data.description = input.description;
    if (Object.keys(data).length === 0) return this.get(actor, labelId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.label.update({
          where: { id: labelId },
          data,
          include: { _count: { select: { families: true } } },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'label.updated',
          entity: 'label',
          entityId: labelId,
          reason: 'label edited',
          before: { name: label.name, color: label.color },
          after: data,
        });
        await this.audit.event(tx, {
          actorKind: actor.kind,
          actorId: actor.actorId,
          type: 'label_updated',
          payload: { labelId, from: label.name, to: data.name ?? label.name },
        });
        return toLabelView(updated);
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new CommError(CommErrorCode.GROUP_ALREADY_EXISTS, 'that label name is taken', 409);
      }
      throw error;
    }
  }

  async get(actor: Actor, labelId: string): Promise<LabelView> {
    this.require(actor, Permission.LABELS_READ);
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, ...this.org(actor), deletedAt: null },
      include: { _count: { select: { families: true } } },
    });
    if (!label) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'label not found', 404);
    return toLabelView(label);
  }

  /**
   * Delete a label -- SOFTLY, through chat.delete_label().
   *
   * Deleting a label must never reach a family, a student, a conversation or
   * any unrelated history. Soft deletion makes the destructive shape
   * unrepresentable: the label stops being offered and every association it had
   * stays on disk. `chat_app` is not even granted DELETE on chat.label.
   */
  async remove(actor: Actor, labelId: string, reason: string): Promise<{ ok: true }> {
    this.require(actor, Permission.LABELS_MANAGE);
    await this.requireLabel(actor, labelId);
    const why = requireText(reason, 'deleting a label must state a reason');
    await this.prisma.$queryRaw`
      select chat.delete_label(${labelId}::uuid, ${why}, ${actor.actorId}::uuid)
    `;
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Filing families
  // ------------------------------------------------------------------

  /**
   * Add families to a label, in bulk.
   *
   * FOUR PROPERTIES, each of which the requirement names explicitly:
   *
   *   AUTHORIZED PER FAMILY  every id is checked against ScopeService before
   *                          anything is written, so a bulk call can never
   *                          reach a family the actor could not reach one at a
   *                          time. An out-of-scope id is reported, not applied.
   *   IDEMPOTENT             the composite primary key means a repeat cannot
   *                          create a second row; `skipDuplicates` turns that
   *                          into a quiet no-op rather than an error.
   *   TRANSACTIONAL          one transaction for the writes and their audit.
   *   DETERMINISTIC          an outcome for EVERY id supplied, in the order
   *                          supplied, so a partially-valid input reports
   *                          exactly what happened rather than failing whole.
   */
  async addFamilies(
    actor: Actor,
    labelId: string,
    familyIds: readonly string[],
  ): Promise<BulkOutcome[]> {
    this.require(actor, Permission.FAMILIES_MANAGE);
    await this.requireLabel(actor, labelId);
    const ids = dedupe(familyIds);
    if (ids.length === 0) return [];

    const { permitted, outcomes } = await this.classify(actor, ids);
    const existing = new Set(
      (
        await this.prisma.familyLabel.findMany({
          where: { labelId, familyId: { in: permitted } },
          select: { familyId: true },
        })
      ).map((r) => r.familyId),
    );
    const toAdd = permitted.filter((id) => !existing.has(id));

    if (toAdd.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.familyLabel.createMany({
          data: toAdd.map((familyId) => ({
            labelId,
            familyId,
            addedBy: staffIdOf(actor),
          })),
          skipDuplicates: true,
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'label.families_added',
          entity: 'label',
          entityId: labelId,
          reason: `${toAdd.length} family/families labelled`,
          after: { familyIds: toAdd },
        });
        for (const familyId of toAdd) {
          await this.audit.event(tx, {
            familyId,
            actorKind: actor.kind,
            actorId: actor.actorId,
            type: 'family_label_added',
            payload: { labelId },
          });
        }
      });
    }

    const added = new Set(toAdd);
    return outcomes.map((o) =>
      o.status === 'applied'
        ? { familyId: o.familyId, status: added.has(o.familyId) ? 'applied' : 'already' }
        : o,
    );
  }

  async removeFamilies(
    actor: Actor,
    labelId: string,
    familyIds: readonly string[],
  ): Promise<BulkOutcome[]> {
    this.require(actor, Permission.FAMILIES_MANAGE);
    await this.requireLabel(actor, labelId);
    const ids = dedupe(familyIds);
    if (ids.length === 0) return [];

    const { permitted, outcomes } = await this.classify(actor, ids);
    const present = new Set(
      (
        await this.prisma.familyLabel.findMany({
          where: { labelId, familyId: { in: permitted } },
          select: { familyId: true },
        })
      ).map((r) => r.familyId),
    );
    const toRemove = permitted.filter((id) => present.has(id));

    if (toRemove.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.familyLabel.deleteMany({
          where: { labelId, familyId: { in: toRemove } },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'label.families_removed',
          entity: 'label',
          entityId: labelId,
          reason: `${toRemove.length} family/families unlabelled`,
          before: { familyIds: toRemove },
        });
        for (const familyId of toRemove) {
          await this.audit.event(tx, {
            familyId,
            actorKind: actor.kind,
            actorId: actor.actorId,
            type: 'family_label_removed',
            payload: { labelId },
          });
        }
      });
    }

    const removed = new Set(toRemove);
    return outcomes.map((o) =>
      o.status === 'applied'
        ? { familyId: o.familyId, status: removed.has(o.familyId) ? 'applied' : 'already' }
        : o,
    );
  }

  /**
   * Classify every supplied id as reachable or not, WITHOUT revealing which.
   *
   * `not_found` and `out_of_scope` are deliberately distinguished in the
   * returned shape but produced by the same lookup, so an operator sees why
   * their bulk action skipped a row while a caller probing ids learns only that
   * it was skipped.
   */
  private async classify(
    actor: Actor,
    ids: readonly string[],
  ): Promise<{ permitted: string[]; outcomes: BulkOutcome[] }> {
    const visible = await this.scope.visibleFamilies(actor);
    const found = new Set(
      (
        await this.prisma.family.findMany({
          where: { id: { in: [...ids] }, ...this.org(actor) },
          select: { id: true },
        })
      ).map((f) => f.id),
    );

    const permitted: string[] = [];
    const outcomes: BulkOutcome[] = ids.map((familyId) => {
      if (!found.has(familyId)) return { familyId, status: 'not_found' as const };
      const inScope = visible === ALL_FAMILIES || visible.includes(familyId);
      if (!inScope) return { familyId, status: 'out_of_scope' as const };
      permitted.push(familyId);
      return { familyId, status: 'applied' as const };
    });
    return { permitted, outcomes };
  }

  /** The labels on one family. */
  async forFamily(actor: Actor, familyId: string): Promise<LabelView[]> {
    this.require(actor, Permission.FAMILIES_READ);
    if (!(await this.scope.canAccessFamily(actor, familyId))) {
      throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'family not found', 404);
    }
    const rows = await this.prisma.familyLabel.findMany({
      where: { familyId, label: { deletedAt: null } },
      include: { label: { include: { _count: { select: { families: true } } } } },
    });
    return rows
      .map((r) => toLabelView(r.label))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

function toLabelView(row: {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  createdAt: Date;
  _count?: { families: number };
}): LabelView {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    familyCount: row._count?.families ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))];
}

function staffIdOf(actor: Actor): string | null {
  return actor.kind === ActorKind.STAFF ? actor.actorId : null;
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    throw new CommError(CommErrorCode.APPROVAL_REASON_REQUIRED, message, 400);
  }
  return trimmed;
}
