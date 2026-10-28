import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { isUuid } from '../communication/conversations/conversation.service';
import type { Actor } from '../platform/types';
import { FIRST_LOGIN_CODE_HOURS, PasswordResetService } from '../platform/auth/password-reset.service';
import { FIRST_LOGIN_MAILER, firstLoginMail, sendWithin, type MailSender } from '../account-recovery/recovery-delivery';
import { PermissionService } from '../platform/permissions/permission.service';
import { PERMISSIONS } from '../platform/permissions/catalogue';
import {
  decideStaffAccountCreate,
  decideStaffAccountManage,
  type StaffAccountStanding,
  type StaffAccountTarget,
} from '../platform/staff-account-policy';
import { accessRoleConflict } from './access-role-conflict';

export interface StaffAccountRoleDto {
  id: string;
  key: string;
  nameEn: string;
  nameAr: string;
}

export interface StaffAccountDto {
  staffId: string;
  accountId: string;
  name: string;
  /** chat.staff.role: specialist | admin | coverage | manager | finance | technical | academic */
  tier: string;
  /** provisioned | active | suspended | deactivated */
  status: string;
  /** A specialist's department (chat.department_account); null for anyone else. */
  departmentId: string | null;
  roles: StaffAccountRoleDto[];
  lastLoginAt: string | null;
  /** Provisioned, with a live first sign-in code waiting. */
  setupPending: boolean;
}

export interface FirstLoginDto {
  /**
   * Shown once, to the super admin, and to the manager who CREATES the account.
   * Absent when a manager reissues it: then it goes by e-mail only, so nobody
   * but the person holds a way into a live identity (review of #212, P1).
   */
  code?: string;
  expiresAt: string;
  /** Sent to the sign-in address. False: the channel is off or the provider failed -- hand the code over. */
  emailed: boolean;
}

export interface AccessRoleDto {
  id: string;
  key: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  maxTier: string;
  permissions: string[];
  archived: boolean;
  /** Seeded for every organization (role-templates.ts, PD-40 PR-4); otherwise ordinary data. */
  template: boolean;
  /** May THIS caller grant it now (S1, H5)? Advisory: the database decides again. */
  grantable: boolean;
}

interface TargetRow {
  staff_id: string;
  account_id: string | null;
  organization_id: string;
  name: string;
  role: string;
  status: string | null;
  department_id: string | null;
  last_login_at: Date | null;
  setup_pending: boolean;
}

const MAX_ROLES = 10;
const MAIL_TIMEOUT_MS = 10_000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const invalid = (why: string) => new CommError(CommErrorCode.STAFF_ACCOUNT_INVALID, why, 400);
const denied = (why: string) => new CommError(CommErrorCode.STAFF_ACCOUNT_DENIED, why);
const notFound = () => new CommError(CommErrorCode.STAFF_ACCOUNT_NOT_FOUND, 'no such staff account');
const roleInvalid = (why: string) => new CommError(CommErrorCode.ACCESS_ROLE_INVALID, why, 400);

/**
 * PD-40 PR-3: staff accounts and access roles, from creation to first sign-in
 * and day-to-day management, under the owner's safeguards (2026-10-28, plan
 * §13).
 *
 * The rules are decided twice and agree: here first (staff-account-policy.ts,
 * so a refusal is a clear 403 before anything is written), then by the SQL
 * functions that are the only writers -- chat.create_staff_account,
 * chat.grant_access_role / revoke_access_role, chat.define_access_role and
 * siblings, the password-reset-code guard. A refusal from the database is
 * mapped to the same codes.
 *
 * The first sign-in code is PD-43's primitive (PasswordResetService,
 * purpose first_login): issued in the transaction that creates the account,
 * shown once in this response, e-mailed after the commit, never written to the
 * audit trail or a log line. A REISSUE by a manager is e-mailed only and never
 * returned (review of #212, P1): only the super admin sees a reissued code.
 */
@Injectable()
export class StaffAccountsService {
  private readonly log = new Logger('StaffAccounts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PermissionService,
    private readonly resets: PasswordResetService,
    @Inject(FIRST_LOGIN_MAILER) private readonly mailer: MailSender,
  ) {}

  // -------------------------------------------------------------------------
  // Staff accounts
  // -------------------------------------------------------------------------

  /** The super admin: every staff account but their own and the super admin's. A department manager: the specialists of their department. */
  async list(actor: Actor): Promise<{ accounts: StaffAccountDto[] }> {
    const standing = await this.standing(actor);
    const org = requireStaff(actor);
    let ids: string[];
    if (actor.staffRole === StaffRole.SUPER_ADMIN) {
      const rows = await this.prisma.staff.findMany({
        where: { organizationId: org, role: { not: StaffRole.SUPER_ADMIN }, id: { not: actor.actorId } },
        select: { id: true },
        orderBy: { name: 'asc' },
        take: 500,
      });
      ids = rows.map((r) => r.id);
    } else if (actor.staffRole === StaffRole.MANAGER && standing.managedDepartmentId) {
      // The ones they may administer: a specialist holding more than the manager may grant is the super admin's (H5).
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT s.id::text AS id
          FROM chat.department_account da
          JOIN chat.staff s ON s.id = da.staff_id
         WHERE da.department_id = ${standing.managedDepartmentId}::uuid AND s.role = 'specialist'
           AND chat.may_administer_staff_account(${actor.actorId}::uuid, s.id)
         ORDER BY s.name`;
      ids = rows.map((r) => r.id);
    } else {
      throw denied('only the super admin and department managers see staff accounts');
    }
    const accounts = await Promise.all(ids.map((id) => this.dtoOf(id)));
    return { accounts: accounts.filter((a): a is StaffAccountDto => a !== null) };
  }

  async get(actor: Actor, staffId: string): Promise<StaffAccountDto> {
    const { row } = await this.reach(actor, staffId);
    return this.toDto(row, await this.rolesOf(row.staff_id));
  }

  /** Body: `{ name, email, tier, departmentId?, roleIds?, reason }`. Returns the code ONCE. */
  async create(
    actor: Actor,
    actorAccountId: string,
    body: Record<string, unknown>,
  ): Promise<{ account: StaffAccountDto; signIn: string; firstLogin: FirstLoginDto }> {
    const org = requireStaff(actor);
    const name = text('name', body.name, 120);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 254) throw invalid('email: must be an e-mail address');
    const tier = typeof body.tier === 'string' ? body.tier : '';
    const departmentId = body.departmentId === undefined || body.departmentId === null ? null : uuid('departmentId', body.departmentId);
    const roleIds = roleList(body.roleIds);
    const reason = text('reason', body.reason, 500);

    const standing = await this.standing(actor);
    const decision = decideStaffAccountCreate(actor, standing, { tier, departmentId });
    if (!decision.allowed) {
      if (!['specialist', 'admin', 'coverage', 'manager'].includes(tier)) throw invalid(`tier: ${decision.reason}`);
      if (actor.staffRole === StaffRole.SUPER_ADMIN) throw invalid(decision.reason);
      throw denied(decision.reason);
    }

    let created: { staffId: string; accountId: string; issued: { id: string; code: string; expiresAt: Date } };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT chat.create_staff_account(${name}::text, ${email}::text, ${tier}::text, ${departmentId}::uuid,
                                           ${reason}::text, ${actor.actorId}::uuid)::text AS id`;
        const staffId = rows[0]!.id;
        for (const roleId of roleIds) {
          await tx.$queryRaw`SELECT chat.grant_access_role(${staffId}::uuid, ${roleId}::uuid, ${reason}::text, ${actor.actorId}::uuid)`;
        }
        const staff = await tx.staff.findUniqueOrThrow({ where: { id: staffId }, select: { accountId: true } });
        const issued = await this.resets.issueInTx(tx, {
          accountId: staff.accountId as string,
          organizationId: org,
          issuedByStaffId: actor.actorId,
          issuedByAccountId: actorAccountId,
          reason: 'a new staff account’s first sign-in',
          signOutEverywhere: false,
          purpose: 'first_login',
        });
        return { staffId, accountId: staff.accountId as string, issued };
      });
    } catch (e) {
      throw refusal(e);
    }
    const emailed = await this.deliver(email, created.issued);
    const account = await this.dtoOf(created.staffId);
    return {
      account: account as StaffAccountDto,
      signIn: email,
      firstLogin: { code: created.issued.code, expiresAt: created.issued.expiresAt.toISOString(), emailed },
    };
  }

  /** Body: `{ roleId, reason }`. */
  async grantRole(actor: Actor, staffId: string, body: Record<string, unknown>): Promise<StaffAccountDto> {
    const { row } = await this.reach(actor, staffId);
    const roleId = uuid('roleId', body.roleId);
    const reason = text('reason', body.reason, 500);
    try {
      await this.prisma.$queryRaw`SELECT chat.grant_access_role(${row.staff_id}::uuid, ${roleId}::uuid, ${reason}::text, ${actor.actorId}::uuid)`;
    } catch (e) {
      throw refusal(e);
    }
    return this.get(actor, staffId);
  }

  /** Body: `{ reason }`. */
  async revokeRole(actor: Actor, staffId: string, roleId: string, body: Record<string, unknown>): Promise<StaffAccountDto> {
    const { row } = await this.reach(actor, staffId);
    const id = uuid('roleId', roleId);
    const reason = text('reason', body.reason, 500);
    try {
      await this.prisma.$queryRaw`SELECT chat.revoke_access_role(${row.staff_id}::uuid, ${id}::uuid, ${reason}::text, ${actor.actorId}::uuid)`;
    } catch (e) {
      throw refusal(e);
    }
    return this.get(actor, staffId);
  }

  /**
   * A new first sign-in code for an account that has not signed in yet. It
   * kills every earlier one. The super admin sees it; a manager's goes by e-mail
   * only -- and with the channel off, a manager issues none (it would kill the
   * live code and deliver nothing). Body: `{ reason }`.
   */
  async reissueSetupCode(actor: Actor, actorAccountId: string, staffId: string, body: Record<string, unknown>): Promise<{ firstLogin: FirstLoginDto }> {
    const { row } = await this.reach(actor, staffId);
    const reason = text('reason', body.reason, 500);
    if (!row.account_id || row.status !== 'provisioned') {
      throw new CommError(CommErrorCode.ACCOUNT_ADMIN_STATE, 'this account has signed in already; reset its password instead', 409);
    }
    const seesCode = actor.staffRole === StaffRole.SUPER_ADMIN;
    if (!seesCode && !this.mailer.available) {
      throw new CommError(CommErrorCode.ACCOUNT_ADMIN_STATE, 'the e-mail channel is off, so only the super admin can issue a new code', 409);
    }
    const accountId = row.account_id;
    const subject = (await this.prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { subject: true } })).subject;
    let issued: { id: string; code: string; expiresAt: Date };
    try {
      issued = await this.prisma.$transaction((tx) =>
        this.resets.issueInTx(tx, {
          accountId,
          organizationId: row.organization_id,
          issuedByStaffId: actor.actorId,
          issuedByAccountId: actorAccountId,
          reason,
          signOutEverywhere: false,
          purpose: 'first_login',
        }),
      );
    } catch (e) {
      throw refusal(e);
    }
    const emailed = await this.deliver(subject, issued);
    const expiresAt = issued.expiresAt.toISOString();
    return { firstLogin: seesCode ? { code: issued.code, expiresAt, emailed } : { expiresAt, emailed } };
  }

  // -------------------------------------------------------------------------
  // Access roles and the catalogue
  // -------------------------------------------------------------------------

  async roles(actor: Actor): Promise<{ roles: AccessRoleDto[] }> {
    const org = requireStaff(actor);
    const standing = await this.standing(actor);
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; key: string; name_en: string; name_ar: string; description: string | null; max_tier: string; archived: boolean; template: boolean; permissions: string[] | null }>
    >`
      SELECT r.id::text AS id, r.key, r.name_en, r.name_ar, r.description, r.max_tier, r.archived_at IS NOT NULL AS archived, r.is_template AS template,
             array_agg(arp.permission_key ORDER BY arp.permission_key) FILTER (WHERE arp.permission_key IS NOT NULL) AS permissions
        FROM chat.access_role r
        LEFT JOIN chat.access_role_permission arp ON arp.role_id = r.id
       WHERE r.organization_id = ${org}::uuid
       GROUP BY r.id
       ORDER BY r.name_en`;
    const byKey = new Map(PERMISSIONS.map((p) => [p.key, p]));
    return {
      roles: rows.map((r) => {
        const keys = r.permissions ?? [];
        const grantable =
          !r.archived &&
          (actor.staffRole === StaffRole.SUPER_ADMIN ||
            (actor.staffRole === StaffRole.MANAGER &&
              standing.managedDepartmentId !== null &&
              standing.permissions.has('staff_accounts.manage') &&
              r.max_tier === 'specialist' &&
              keys.every((k) => byKey.get(k)?.delegable && byKey.get(k)?.inRoles && standing.permissions.has(k))));
        return {
          id: r.id,
          key: r.key,
          nameEn: r.name_en,
          nameAr: r.name_ar,
          description: r.description,
          maxTier: r.max_tier,
          permissions: keys,
          archived: r.archived,
          template: r.template,
          grantable,
        };
      }),
    };
  }

  /** The super admin defines a role from a checklist in one step (S4). Body: `{ key, nameEn, nameAr, description?, maxTier?, permissions, reason }`. */
  async defineRole(actor: Actor, body: Record<string, unknown>): Promise<{ role: AccessRoleDto }> {
    requireStaff(actor);
    const key = typeof body.key === 'string' ? body.key : '';
    const permissions = keyList(body.permissions);
    const maxTier = body.maxTier === undefined ? 'specialist' : String(body.maxTier);
    let id: string;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT chat.define_access_role(${key}::text, ${str(body.nameEn)}::text, ${str(body.nameAr)}::text,
                                       ${optionalStr(body.description)}::text, ${maxTier}::text, ${permissions}::text[],
                                       ${str(body.reason)}::text, ${actor.actorId}::uuid)::text AS id`;
      id = rows[0]!.id;
    } catch (e) {
      throw roleRefusal(e);
    }
    return { role: (await this.roles(actor)).roles.find((r) => r.id === id) as AccessRoleDto };
  }

  /** Body: `{ nameEn?, nameAr?, description?, permissions?, reason }`. */
  async updateRole(actor: Actor, roleId: string, body: Record<string, unknown>): Promise<{ role: AccessRoleDto }> {
    requireStaff(actor);
    const id = uuid('roleId', roleId);
    const permissions = body.permissions === undefined ? null : keyList(body.permissions);
    try {
      await this.prisma.$executeRaw`
        SELECT chat.update_access_role(${id}::uuid, ${optionalStr(body.nameEn)}::text, ${optionalStr(body.nameAr)}::text,
                                       ${optionalStr(body.description)}::text, ${permissions}::text[], ${str(body.reason)}::text,
                                       ${actor.actorId}::uuid)`;
    } catch (e) {
      throw roleRefusal(e);
    }
    const role = (await this.roles(actor)).roles.find((r) => r.id === id);
    if (!role) throw notFound();
    return { role };
  }

  /** Body: `{ reason }`. Existing grants keep working; nobody can be granted it again. */
  async archiveRole(actor: Actor, roleId: string, body: Record<string, unknown>): Promise<{ role: AccessRoleDto }> {
    requireStaff(actor);
    const id = uuid('roleId', roleId);
    try {
      await this.prisma.$executeRaw`SELECT chat.archive_access_role(${id}::uuid, ${str(body.reason)}::text, ${actor.actorId}::uuid)`;
    } catch (e) {
      throw roleRefusal(e);
    }
    const role = (await this.roles(actor)).roles.find((r) => r.id === id);
    if (!role) throw notFound();
    return { role };
  }

  /** The checklist a role is made from: every key, its page, risk, and whether it goes in roles and may be delegated. */
  permissions(): { permissions: Array<{ key: string; page: string; action: string; label: { en: string; ar: string }; risk: string; delegable: boolean; inRoles: boolean }> } {
    return {
      permissions: PERMISSIONS.map((p) => ({
        key: p.key,
        page: p.page,
        action: p.action,
        label: p.label,
        risk: p.risk,
        delegable: p.delegable,
        inRoles: p.inRoles,
      })),
    };
  }

  // -------------------------------------------------------------------------

  private async standing(actor: Actor): Promise<StaffAccountStanding> {
    const [profile, dept] = await Promise.all([
      this.access.profileOf(actor),
      this.prisma.department.findFirst({ where: { managerId: actor.actorId, organizationId: actor.organizationId ?? undefined }, select: { id: true } }),
    ]);
    return { managedDepartmentId: dept?.id ?? null, permissions: profile.permissions };
  }

  /** The target, if the caller may manage it; anything else answers not found (S2: no account outside one's reach is confirmed). */
  private async reach(actor: Actor, staffId: string): Promise<{ row: TargetRow }> {
    requireStaff(actor);
    if (!isUuid(staffId)) throw notFound();
    const row = await this.row(staffId);
    if (!row) throw notFound();
    const held = await this.prisma.$queryRaw<Array<{ key: string }>>`
      SELECT DISTINCT arp.permission_key AS key
        FROM chat.staff_access_role sar JOIN chat.access_role_permission arp ON arp.role_id = sar.role_id
       WHERE sar.staff_id = ${row.staff_id}::uuid`;
    const target: StaffAccountTarget = {
      staffId: row.staff_id,
      organizationId: row.organization_id,
      role: row.role,
      departmentId: row.department_id,
      permissions: new Set(held.map((h) => h.key)),
    };
    if (!decideStaffAccountManage(actor, await this.standing(actor), target).allowed) throw notFound();
    return { row };
  }

  private async row(staffId: string): Promise<TargetRow | null> {
    const rows = await this.prisma.$queryRaw<TargetRow[]>`
      SELECT s.id::text AS staff_id, s.account_id::text AS account_id, s.organization_id::text AS organization_id, s.name, s.role,
             a.status, da.department_id::text AS department_id, a.last_login_at,
             (a.status = 'provisioned' AND EXISTS (
                SELECT 1 FROM chat.password_reset_code c
                 WHERE c.account_id = a.id AND c.purpose = 'first_login'
                   AND c.used_at IS NULL AND c.superseded_at IS NULL AND c.expires_at > now())) AS setup_pending
        FROM chat.staff s
        LEFT JOIN chat.account a ON a.id = s.account_id
        LEFT JOIN chat.department_account da ON da.staff_id = s.id
       WHERE s.id = ${staffId}::uuid`;
    return rows[0] ?? null;
  }

  private async rolesOf(staffId: string): Promise<StaffAccountRoleDto[]> {
    return this.prisma.$queryRaw<StaffAccountRoleDto[]>`
      SELECT r.id::text AS id, r.key, r.name_en AS "nameEn", r.name_ar AS "nameAr"
        FROM chat.staff_access_role sar JOIN chat.access_role r ON r.id = sar.role_id
       WHERE sar.staff_id = ${staffId}::uuid
       ORDER BY r.name_en`;
  }

  private async dtoOf(staffId: string): Promise<StaffAccountDto | null> {
    const row = await this.row(staffId);
    return row ? this.toDto(row, await this.rolesOf(staffId)) : null;
  }

  private toDto(row: TargetRow, roles: StaffAccountRoleDto[]): StaffAccountDto {
    return {
      staffId: row.staff_id,
      accountId: row.account_id ?? '',
      name: row.name,
      tier: row.role,
      status: row.status ?? 'deactivated',
      departmentId: row.department_id,
      roles,
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
      setupPending: row.setup_pending,
    };
  }

  /** After the commit, to the sign-in address; on failure only the code's id is logged -- never the code, the address or the provider's text. */
  private async deliver(to: string, issued: { id: string; code: string }): Promise<boolean> {
    if (!this.mailer.available) return false;
    const result = await sendWithin(this.mailer, to, firstLoginMail(issued.code, FIRST_LOGIN_CODE_HOURS, to), MAIL_TIMEOUT_MS);
    if (!result.sent) this.log.error(`first sign-in code ${issued.id} not e-mailed: ${result.failure}`);
    return result.sent;
  }
}

function requireStaff(actor: Actor): string {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) throw denied('only staff manage staff accounts');
  return actor.organizationId;
}

function text(field: string, value: unknown, max: number): string {
  const t = typeof value === 'string' ? value.trim() : '';
  if (t.length < 1 || t.length > max) throw invalid(`${field}: must be 1 to ${max} characters`);
  return t;
}

function uuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw invalid(`${field}: must be a uuid`);
  return (value as string).toLowerCase();
}

function roleList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ROLES) throw invalid(`roleIds: at most ${MAX_ROLES} role ids`);
  return [...new Set(value.map((v) => uuid('roleIds', v)))];
}

function keyList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200 || value.some((v) => typeof v !== 'string')) {
    throw roleInvalid('permissions: a list of permission keys');
  }
  return value as string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const optionalStr = (v: unknown) => (typeof v === 'string' ? v : null);

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A database refusal of an account write, as the API's codes. Unknown errors pass through untouched. */
function refusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  const t = errorText(e);
  if (/this e-mail already signs in to Chat/.test(t)) return new CommError(CommErrorCode.STAFF_ACCOUNT_CONFLICT, 'email: this e-mail already signs in to Chat', 409);
  if (/may not grant|changes the access|only the super admin (changes|creates|grants)|creates accounts in the department|only the super admin and department managers|nobody changes their own access|never granted a role/.test(t)) {
    return denied(t.replace(/^[\s\S]*?(?:ERROR|Message):\s*/i, '').split('\n')[0]!.slice(0, 300));
  }
  if (/archived role|may be granted up to|no such staff member or role|a staff account|e-mail address|department/.test(t)) {
    return invalid(t.replace(/^[\s\S]*?(?:ERROR|Message):\s*/i, '').split('\n')[0]!.slice(0, 300));
  }
  return e;
}

function roleRefusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  const t = errorText(e);
  if (/only the super admin defines/.test(t)) return new CommError(CommErrorCode.STAFF_ACCOUNT_DENIED, 'only the super admin defines and changes access roles');
  // Parsed from the full text before the message is cut: detail.grants names every blocking grant (review of #239).
  if (/their granting manager may not grant/.test(t)) return accessRoleConflict(t);
  if (/no such role/.test(t)) return notFound();
  if (/unknown permission|super admin's own powers|super admin''s own powers|at least one permission|access_role_key|violates check constraint|a reason is required|duplicate key|access_role_key_per_organization/.test(t)) {
    return roleInvalid(t.replace(/^[\s\S]*?(?:ERROR|Message):\s*/i, '').split('\n')[0]!.slice(0, 300));
  }
  return e;
}
