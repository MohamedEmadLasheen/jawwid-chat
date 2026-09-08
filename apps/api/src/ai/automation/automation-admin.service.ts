import { Inject, Injectable } from '@nestjs/common';
import type { AutomationRule, AutomationRun } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { Permission } from '../../platform/rbac/permissions';
import { CommError, CommErrorCode } from '../../platform/errors';
import { IDENTITY_SERVICE, AUDIT_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { AuditService } from '../../platform/audit.service';
import { IdentityAwareService } from '../identity-aware.service';

/**
 * Reading the automation engine, and turning one rule off.
 *
 * Separate from AutomationEngine on purpose. The engine runs in the worker with
 * no actor, as chat_service; this runs in a request with an actor, as chat_app.
 * Putting a permission check inside the engine would mean inventing an actor for
 * a background sweep that acts on nobody's behalf -- which is exactly the
 * pretence the audit trail exists to avoid.
 */
@Injectable()
export class AutomationAdminService extends IdentityAwareService {
  constructor(
    prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {
    super(prisma, identity);
  }

  async listRules(actorId: string): Promise<AutomationRule[]> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AUTOMATION_MANAGE);
    return this.prisma.automationRule.findMany({ orderBy: [{ enabled: 'desc' }, { key: 'asc' }] });
  }

  async listRuns(
    actorId: string,
    filter: { ruleKey?: string; outcome?: string } = {},
  ): Promise<AutomationRun[]> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AUTOMATION_MANAGE);
    return this.prisma.automationRun.findMany({
      where: { ruleKey: filter.ruleKey, outcome: filter.outcome },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Enable or disable one rule.
   *
   * Audited with a mandatory reason, like every other sensitive action here.
   * Silently disabling the rule that reminds families about their classes, and
   * nobody being able to say who or why, is precisely the incident this makes
   * impossible.
   */
  async setEnabled(
    actorId: string,
    key: string,
    enabled: boolean,
    reason: string,
  ): Promise<AutomationRule> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.AUTOMATION_MANAGE);
    if (!reason.trim()) {
      throw new CommError(
        CommErrorCode.KNOWLEDGE_REASON_REQUIRED,
        'enabling or disabling an automation requires a reason',
        400,
      );
    }

    const existing = await this.prisma.automationRule.findUnique({ where: { key } });
    if (!existing) {
      throw new CommError(CommErrorCode.AUTOMATION_RULE_NOT_FOUND, 'no such rule', 404);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.automationRule.update({ where: { key }, data: { enabled } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: enabled ? 'automation_rule.enabled' : 'automation_rule.disabled',
        entity: 'automation_rule',
        entityId: key,
        before: { enabled: existing.enabled },
        after: { enabled },
        reason: reason.trim(),
      });
      return updated;
    });
  }
}
