import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type CertificateType } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { certificateAccessFrom, isCertificateCategory } from '../platform/pd041-policy';
import { PermissionService } from '../platform/permissions/permission.service';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';

const PERIODS = ['month', 'term', 'year'] as const;

/**
 * PD-41: the certificate types (owner safeguard 6). Every certificates account
 * reads the active types of a category; the super admin (certificates.types)
 * adds, relabels, enables and disables them. A type is never deleted -- the
 * table refuses it -- so every certificate keeps its label.
 */
@Injectable()
export class CertificateTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly permissions: PermissionService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async list(actorId: string, query: { category?: string; includeDisabled?: string }) {
    const { actor, access } = await this.access(actorId);
    if (!access.view) throw denied();
    if (query.category !== undefined && !isCertificateCategory(query.category)) throw invalid('category: student | teacher');
    const all = query.includeDisabled === 'true' && access.types;
    const types = await this.prisma.certificateType.findMany({
      where: { organizationId: actor.organizationId ?? '', ...(query.category ? { category: query.category } : {}), ...(all ? {} : { isActive: true }) },
      orderBy: [{ category: 'asc' }, { sort: 'asc' }, { labelEn: 'asc' }],
    });
    return { types: types.map(dto) };
  }

  async create(actorId: string, body: Record<string, unknown>) {
    const { actor } = await this.requireManager(actorId);
    const category = body.category;
    if (!isCertificateCategory(category)) throw invalid('category: student | teacher');
    const key = body.key;
    if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw invalid('key: lowercase letters, digits and _');
    const data = fields(body, true);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const t = await tx.certificateType.create({
          data: { organizationId: actor.organizationId as string, category, key, ...data, createdBy: actor.actorId } as Prisma.CertificateTypeUncheckedCreateInput,
        });
        await this.audit.audit(tx, { actorId: actor.actorId, action: 'certificate_type.created', entity: 'certificate_type', entityId: t.id, after: { category, key, ...data }, reason: 'certificate type added' });
        return t;
      });
      return { type: dto(created) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw invalid('key: this category already has that type');
      throw e;
    }
  }

  /** Relabel, reorder, enable or disable. Disabling hides it from new requests only. */
  async update(actorId: string, id: string, body: Record<string, unknown>) {
    const { actor } = await this.requireManager(actorId);
    if (!isUuid(id)) throw notFound();
    const current = await this.prisma.certificateType.findFirst({ where: { id, organizationId: actor.organizationId ?? '' } });
    if (!current) throw notFound();
    const data: Prisma.CertificateTypeUncheckedUpdateInput = fields(body, false);
    let action = 'certificate_type.updated';
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') throw invalid('isActive: true | false');
      if (body.isActive !== current.isActive) {
        data.isActive = body.isActive;
        data.disabledAt = body.isActive ? null : new Date();
        data.disabledBy = body.isActive ? null : actor.actorId;
        action = body.isActive ? 'certificate_type.enabled' : 'certificate_type.disabled';
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.certificateType.update({ where: { id }, data });
      await this.audit.audit(tx, { actorId: actor.actorId, action, entity: 'certificate_type', entityId: id, before: dto(current), after: dto(t), reason: 'certificate type changed' });
      return t;
    });
    return { type: dto(updated) };
  }

  private async access(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    return { actor, access: certificateAccessFrom((await this.permissions.profileOf(actor)).permissions) };
  }

  private async requireManager(actorId: string) {
    const a = await this.access(actorId);
    if (!a.access.types) throw new CommError(CommErrorCode.CERTIFICATE_DENIED, 'only the super admin manages certificate types');
    return a;
  }
}

function fields(body: Record<string, unknown>, creating: boolean) {
  const out: { labelEn?: string; labelAr?: string; needsJuz?: boolean; needsPeriod?: string | null; sort?: number } = {};
  for (const [field, key] of [['labelEn', 'labelEn'], ['labelAr', 'labelAr']] as const) {
    const v = body[field];
    if (v === undefined && !creating) continue;
    if (typeof v !== 'string' || v.trim().length === 0 || v.trim().length > 80) throw invalid(`${field}: 1 to 80 characters`);
    out[key] = v.trim();
  }
  if (body.needsJuz !== undefined) {
    if (typeof body.needsJuz !== 'boolean') throw invalid('needsJuz: true | false');
    out.needsJuz = body.needsJuz;
  }
  if (body.needsPeriod !== undefined) {
    if (body.needsPeriod !== null && !(PERIODS as readonly unknown[]).includes(body.needsPeriod)) throw invalid('needsPeriod: month | term | year | null');
    out.needsPeriod = body.needsPeriod as string | null;
  }
  if (body.sort !== undefined) {
    if (typeof body.sort !== 'number' || !Number.isInteger(body.sort) || body.sort < 0 || body.sort > 999) throw invalid('sort: 0 to 999');
    out.sort = body.sort;
  }
  return out;
}

function dto(t: CertificateType) {
  return {
    id: t.id,
    category: t.category,
    key: t.key,
    labelEn: t.labelEn,
    labelAr: t.labelAr,
    needsJuz: t.needsJuz,
    needsPeriod: t.needsPeriod,
    isActive: t.isActive,
    sort: t.sort,
    disabledAt: t.disabledAt?.toISOString() ?? null,
  };
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function denied() {
  return new CommError(CommErrorCode.CERTIFICATE_DENIED, 'you may not open certificates');
}

function notFound() {
  return new CommError(CommErrorCode.CERTIFICATE_NOT_FOUND, 'certificate type not found');
}
