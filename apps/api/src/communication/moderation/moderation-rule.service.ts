import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { Permission } from '../../platform/rbac/permissions';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService } from '../../platform/audit.service';
import { actorHasPermission, isFamilyFacingStaff, type Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import {
  MatchType,
  ModerationCategory,
  ModerationSeverity,
} from '../contracts/vocab';
import {
  assertUsablePattern,
  InvalidPatternError,
  type ScanRule,
} from './content-scanner';

export interface ModerationRuleDto {
  id: string;
  name: string;
  category: string;
  severity: string;
  matchType: string;
  pattern: string;
  isBuiltin: boolean;
  isEnabled: boolean;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRuleInput {
  name: string;
  category: string;
  severity: string;
  matchType: string;
  pattern: string;
  isEnabled?: boolean;
  notes?: string | null;
}

export interface UpdateRuleInput {
  name?: string;
  category?: string;
  severity?: string;
  matchType?: string;
  pattern?: string;
  isEnabled?: boolean;
  notes?: string | null;
}

const CATEGORIES: ReadonlySet<string> = new Set(Object.values(ModerationCategory));
const SEVERITIES: ReadonlySet<string> = new Set(Object.values(ModerationSeverity));
const MATCH_TYPES: ReadonlySet<string> = new Set(Object.values(MatchType));

/**
 * The rule catalogue: who may read it, who may change it, and how the scanner
 * gets hold of it without a query per message.
 *
 * ## Two different permissions, deliberately
 *
 * `messages.moderate` (admin and above) READS the rules. An approver deciding a
 * held message has to be able to see the rule that held it, or the queue's
 * "reason" is a name they cannot check.
 *
 * `moderation_rules.manage` (manager and above) WRITES them. A rule applies to
 * every conversation in the organization, so an admin who could disable the
 * phone-number rule would be disabling it for families that are not theirs --
 * the exact scope escape the supervisor model exists to prevent. This is the
 * same split that made `labels.manage` a manager's act while filing a family
 * under a label is an admin's.
 *
 * Neither check is a UI concern. RLS enforces both again on the connection
 * (20260907170000 §7), so a direct API call by a teacher fails twice.
 *
 * ## The cache, and why it is short
 *
 * Every message sent in a moderated conversation needs the rule set. Reading it
 * per message would put a query on the hot path of the product's most frequent
 * operation. It is therefore cached for the same 30 seconds AppConfigService
 * caches config, and INVALIDATED on every write -- so a manager disabling a
 * noisy rule sees it stop firing immediately rather than in half a minute,
 * which is the case where the delay would actually matter.
 */
@Injectable()
export class ModerationRuleService {
  private cache = new Map<string, { rules: ScanRule[]; at: number }>();
  private readonly ttlMs = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly conversations: ConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // The scanner's view
  // -------------------------------------------------------------------

  /**
   * The enabled rules for one organization, in the order the scanner applies
   * them: most severe first.
   *
   * Ordering matters for one reason only -- the time budget. If the budget runs
   * out, the rules that did NOT run are the least severe ones, which is the
   * failure that costs least. (The scan still fails closed either way.)
   */
  async enabledRules(organizationId: string | undefined): Promise<ScanRule[]> {
    const key = organizationId ?? 'default';
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.rules;

    // NOT a Prisma read of chat.moderation_rule, and this is load-bearing.
    //
    // The scan runs inside the SENDER'S request, and the sender is usually a
    // teacher or a parent -- exactly the actors the table's read policy
    // correctly refuses. A Prisma read here returns ZERO rules under RLS, finds
    // nothing, and reports every message safe: moderation stops working and
    // nothing fails. chat.enabled_moderation_rules is SECURITY DEFINER for that
    // reason, and returns only the fields the matcher applies.
    //
    // list() below still reads the table through Prisma, under RLS, because
    // THAT read is a user's read and should be policy-enforced.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        category: string;
        severity: string;
        match_type: string;
        pattern: string;
      }>
    >`SELECT * FROM chat.enabled_moderation_rules(${organizationId ?? null}::uuid)`;

    const rules: ScanRule[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      severity: r.severity,
      matchType: r.match_type,
      pattern: r.pattern,
    }));

    this.cache.set(key, { rules, at: Date.now() });
    return rules;
  }

  /** Called by every write here, and available to tests and ops. */
  invalidate(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------

  async list(actorId: string, includeDisabled = true): Promise<ModerationRuleDto[]> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireReader(actor);

    const rows = await this.prisma.moderationRule.findMany({
      where: {
        ...(includeDisabled ? {} : { isEnabled: true }),
        ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  // -------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------

  async create(actorId: string, input: CreateRuleInput): Promise<ModerationRuleDto> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireManager(actor);

    const name = (input.name ?? '').trim();
    const pattern = (input.pattern ?? '').trim();
    this.assertVocabulary(input.category, input.severity, input.matchType);
    if (name === '') {
      throw new CommError(CommErrorCode.MODERATION_RULE_INVALID, 'a rule needs a name', 400);
    }
    await this.assertPattern(input.matchType, pattern);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.moderationRule.create({
        data: {
          name,
          category: input.category,
          severity: input.severity,
          matchType: input.matchType,
          pattern,
          isEnabled: input.isEnabled ?? true,
          notes: input.notes?.trim() || null,
          isBuiltin: false,
          createdBy: actor.actorId,
          updatedBy: actor.actorId,
          ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
        },
      });
      // The pattern IS the rule, so it belongs in the audit row: "who widened
      // what the academy detects, and to what" is the question this table is
      // read to answer.
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'moderation_rule.created',
        entity: 'moderation_rule',
        entityId: row.id,
        after: {
          name: row.name,
          category: row.category,
          severity: row.severity,
          matchType: row.matchType,
          pattern: row.pattern,
          isEnabled: row.isEnabled,
        },
        reason: input.notes?.trim() || 'rule created',
      });
      return row;
    });

    this.invalidate();
    return toDto(created);
  }

  async update(
    actorId: string,
    ruleId: string,
    input: UpdateRuleInput,
  ): Promise<ModerationRuleDto> {
    const actor = await this.conversations.requireActor(actorId);
    this.requireManager(actor);

    const existing = await this.findInScope(actor, ruleId);

    // Only what was actually supplied is validated, so a request that merely
    // disables a rule is not refused because of an unrelated field.
    if (input.category !== undefined && !CATEGORIES.has(input.category)) {
      throw new CommError(
        CommErrorCode.MODERATION_RULE_INVALID,
        `unknown category '${input.category}'`,
        400,
      );
    }
    if (input.severity !== undefined && !SEVERITIES.has(input.severity)) {
      throw new CommError(
        CommErrorCode.MODERATION_RULE_INVALID,
        `unknown severity '${input.severity}'`,
        400,
      );
    }
    if (input.matchType !== undefined && !MATCH_TYPES.has(input.matchType)) {
      throw new CommError(
        CommErrorCode.MODERATION_RULE_INVALID,
        `unknown match type '${input.matchType}'`,
        400,
      );
    }

    const matchType = input.matchType ?? existing.matchType;
    const pattern = input.pattern !== undefined ? input.pattern.trim() : existing.pattern;
    // Re-validated whenever EITHER half changes: a pattern that was valid as a
    // phrase is not necessarily valid as a regex.
    if (input.pattern !== undefined || input.matchType !== undefined) {
      await this.assertPattern(matchType, pattern);
    }
    if (input.name !== undefined && input.name.trim() === '') {
      throw new CommError(CommErrorCode.MODERATION_RULE_INVALID, 'a rule needs a name', 400);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.moderationRule.update({
        where: { id: ruleId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.severity !== undefined ? { severity: input.severity } : {}),
          ...(input.matchType !== undefined ? { matchType } : {}),
          ...(input.pattern !== undefined ? { pattern } : {}),
          ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
          updatedBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'moderation_rule.updated',
        entity: 'moderation_rule',
        entityId: ruleId,
        before: {
          name: existing.name,
          category: existing.category,
          severity: existing.severity,
          matchType: existing.matchType,
          pattern: existing.pattern,
          isEnabled: existing.isEnabled,
        },
        after: {
          name: row.name,
          category: row.category,
          severity: row.severity,
          matchType: row.matchType,
          pattern: row.pattern,
          isEnabled: row.isEnabled,
        },
        reason: describeChange(existing, row),
      });
      return row;
    });

    this.invalidate();
    return toDto(updated);
  }

  /**
   * Enable or disable. A separate method rather than `update({isEnabled})`
   * because it is the operation an operator actually performs -- switching off
   * a rule that is producing noise, at speed, without opening an edit form --
   * and because it is the one that must never be confused with deletion.
   *
   * THERE IS NO DELETE. A rule is disabled; the flags that reference it keep
   * pointing at something. chat_app holds no DELETE privilege on the table, so
   * this is a property of the deployment and not a convention.
   */
  async setEnabled(actorId: string, ruleId: string, enabled: boolean): Promise<ModerationRuleDto> {
    return this.update(actorId, ruleId, { isEnabled: enabled });
  }

  // -------------------------------------------------------------------

  private async findInScope(actor: Actor, ruleId: string) {
    const rule = await this.prisma.moderationRule.findUnique({ where: { id: ruleId } });
    // A rule in another organization is reported as absent, not as forbidden:
    // distinguishing them would make this endpoint an existence oracle for
    // another academy's moderation policy.
    if (
      !rule ||
      (actor.organizationId && rule.organizationId !== actor.organizationId)
    ) {
      throw new CommError(CommErrorCode.MODERATION_RULE_NOT_FOUND, 'rule not found', 404);
    }
    return rule;
  }

  private assertVocabulary(category: string, severity: string, matchType: string): void {
    if (!CATEGORIES.has(category)) {
      throw new CommError(
        CommErrorCode.MODERATION_RULE_INVALID,
        `unknown category '${category}'`,
        400,
      );
    }
    if (!SEVERITIES.has(severity)) {
      throw new CommError(
        CommErrorCode.MODERATION_RULE_INVALID,
        `unknown severity '${severity}'`,
        400,
      );
    }
    if (!MATCH_TYPES.has(matchType)) {
      throw new CommError(
        CommErrorCode.MODERATION_RULE_INVALID,
        `unknown match type '${matchType}'`,
        400,
      );
    }
  }

  /**
   * THE regex gate, and the only place a pattern is admitted.
   *
   * It runs when a rule is WRITTEN, where a human is present to be told what is
   * wrong with their pattern -- not when it is applied, where the only available
   * response is to fail the message of a teacher who did nothing. That is the
   * whole design: a pattern that reaches the scanner has already been proven to
   * compile and has already been refused if it nests quantifiers.
   */
  private async assertPattern(matchType: string, pattern: string): Promise<void> {
    const maxLength = await this.config.get('moderation.max_pattern_length');
    try {
      assertUsablePattern(matchType, pattern, maxLength);
    } catch (err) {
      if (err instanceof InvalidPatternError) {
        throw new CommError(CommErrorCode.MODERATION_RULE_INVALID, err.detail, 400);
      }
      throw err;
    }
  }

  private requireReader(actor: Actor): void {
    if (!actor.isActive) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    }
    if (!isFamilyFacingStaff(actor)) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        'the moderation rules are visible to Jawwid staff only',
      );
    }
    if (
      !actorHasPermission(actor, Permission.MESSAGES_MODERATE) &&
      !actorHasPermission(actor, Permission.MODERATION_RULES_MANAGE)
    ) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        `this actor does not hold ${Permission.MESSAGES_MODERATE}`,
      );
    }
  }

  private requireManager(actor: Actor): void {
    if (!actor.isActive) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    }
    if (!isFamilyFacingStaff(actor) || !actorHasPermission(actor, Permission.MODERATION_RULES_MANAGE)) {
      throw new CommError(
        CommErrorCode.PERMISSION_DENIED,
        `this actor does not hold ${Permission.MODERATION_RULES_MANAGE}`,
      );
    }
  }
}

interface RuleRow {
  id: string;
  name: string;
  category: string;
  severity: string;
  matchType: string;
  pattern: string;
  isBuiltin: boolean;
  isEnabled: boolean;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(r: RuleRow): ModerationRuleDto {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    severity: r.severity,
    matchType: r.matchType,
    pattern: r.pattern,
    isBuiltin: r.isBuiltin,
    isEnabled: r.isEnabled,
    notes: r.notes,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** A reason the audit log can be read without diffing two JSON blobs by eye. */
function describeChange(before: RuleRow, after: RuleRow): string {
  const changes: string[] = [];
  if (before.isEnabled !== after.isEnabled) {
    changes.push(after.isEnabled ? 'enabled' : 'disabled');
  }
  if (before.pattern !== after.pattern) changes.push('pattern changed');
  if (before.severity !== after.severity) {
    changes.push(`severity ${before.severity} -> ${after.severity}`);
  }
  if (before.category !== after.category) {
    changes.push(`category ${before.category} -> ${after.category}`);
  }
  if (before.matchType !== after.matchType) {
    changes.push(`match type ${before.matchType} -> ${after.matchType}`);
  }
  if (before.name !== after.name) changes.push('renamed');
  return changes.length > 0 ? changes.join('; ') : 'rule updated';
}
