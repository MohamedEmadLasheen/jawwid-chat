import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { OBJECT_STORAGE } from '../platform/tokens';
import type { Tx } from '../platform/audit.service';
import { ActorScopedDatabase } from '../platform/actor-database';
import { CommError, CommErrorCode } from '../platform/errors';
import type { Actor } from '../platform/types';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { ObjectStorage, UploadAuthorization } from '../communication/attachments/object-storage';
import { assertSafeObjectKey } from '../communication/attachments/object-key';
import {
  NEVER_A_TEAM_MEMBER,
  NO_PROFILE_ACCESS,
  StaffProfilePermission,
  profilePermissionsFor,
  type StaffProfileAccess,
  type StaffProfileTarget,
} from '../platform/staff-profile-policy';
import {
  AVATAR_HEAD_BYTES,
  MAX_AVATAR_BYTES,
  isAvatarMime,
  judgeAvatar,
} from './image-inspection';
import {
  ABOUT_MAX,
  DISPLAY_NAME_MAX,
  JOB_TITLE_MAX,
  REASON_MAX,
  SCOPE_NOTE_MAX,
  normalizeLine,
  normalizeParagraphs,
  type TextVerdict,
} from './profile-text';
import {
  ProfileAuditAction,
  isResponsibilityCategory,
} from './staff-profile.vocab';
import { StaffWorkloadService, type OrganizationTotals, type StaffWorkload } from './staff-workload.service';

/**
 * Staff profiles: the one service behind every profile read and write.
 *
 * ## Whose profile
 *
 * The caller is `actor`, written by the auth guard from a verified token. The
 * TARGET arrives as a path segment (`me` or a staff id) and is treated as
 * untrusted: it is looked up INSIDE the caller's organization, its relation to
 * the caller is resolved from chat.staff_reporting_line, and AuthorizationService
 * decides what the caller may do with it. A profile the caller may not see
 * answers exactly like one that does not exist (STAFF_PROFILE_NOT_FOUND), so
 * this surface is not an oracle for which staff ids are real.
 *
 * ## What a write can reach
 *
 * There is no generic update and no request object is ever spread into a
 * Prisma `data`. Each method writes named columns: job_title and about on
 * chat.staff_profile; name and avatar_object_key on chat.staff; rows of
 * chat.staff_responsibility and chat.staff_reporting_line. `role`, `is_active`,
 * `left_at`, `account_id`, chat.account and chat.account_credential are not
 * written anywhere in this file, by anyone, so a profile edit cannot change a
 * role, a permission, an account's status or a login -- including the super
 * admin's own, whose role and login binding chat.guard_super_admin_grant also
 * protects at the database.
 *
 * ## Re-checked inside the write
 *
 * Every mutation re-resolves the caller and the target inside its transaction,
 * with the target's staff row locked (AUTHORIZATION-MODEL A-9). A manager whose
 * report was moved to another team between page load and Save is refused, not
 * honoured from a stale verdict.
 *
 * ## Audit
 *
 * Every successful change writes chat.audit_log in the same transaction: actor,
 * target (entity_id = staff id), the changed fields before and after, and a
 * reason. Never a password, token, object key or signed URL. A refused change
 * writes nothing -- it changed nothing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DIRECTORY_LIMIT = 500;
export const ACTIVITY_LIMIT = 50;

export interface ProfilePersonDto {
  staffId: string;
  displayName: string;
  role: string;
  jobTitle: string | null;
  avatarUrl: string | null;
}

export interface ResponsibilityDto {
  id: string;
  category: string;
  scopeNote: string | null;
  assignedAt: string;
  assignedBy: { staffId: string; displayName: string } | null;
  endedAt: string | null;
  endReason: string | null;
}

/** Facts derived from records, shown beside -- never mixed with -- assigned labels. */
export interface DerivedResponsibilityDto {
  kind: 'family_supervision' | 'team_management' | 'coverage_role';
  count: number | null;
}

export interface CompletenessDto {
  complete: number;
  total: number;
  missing: Array<'photo' | 'job_title' | 'about' | 'reporting_line' | 'responsibility'>;
}

export interface StaffProfileDto {
  staffId: string;
  displayName: string;
  role: string;
  isActive: boolean;
  leftAt: string | null;
  joinedAt: string;
  lastActivityAt: string | null;
  account: { hasLogin: boolean; status: string | null; lastLoginAt: string | null };
  /** The caller's own login identifier, read-only. Null for anybody else's profile. */
  signInIdentity: string | null;
  jobTitle: string | null;
  about: string | null;
  avatarUrl: string | null;
  /** Optimistic-concurrency token: send it back as `expectedVersion`. Null = no profile row yet. */
  version: string | null;
  profileUpdatedAt: string | null;
  profileUpdatedBy: { staffId: string; displayName: string } | null;
  reportingManager: ProfilePersonDto | null;
  responsibilities: ResponsibilityDto[];
  derivedResponsibilities: DerivedResponsibilityDto[];
  workload: StaffWorkload;
  completeness: CompletenessDto;
  access: StaffProfileAccess;
  /**
   * What the VIEWER may open beyond this profile, from their effective
   * permissions -- so the Admin Web decides which sections to request from the
   * server's answer, never from a role string it holds itself.
   */
  viewer: { team: boolean; organizationOverview: boolean };
  generatedAt: string;
}

export interface StaffSummaryDto {
  staffId: string;
  displayName: string;
  role: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  account: { hasLogin: boolean; status: string | null };
  lastActivityAt: string | null;
  profileUpdatedAt: string | null;
  joinedAt: string;
  reportingManager: { staffId: string; displayName: string; role: string } | null;
  responsibilities: string[];
  workload: StaffWorkload;
  completeness: CompletenessDto;
  access: Pick<StaffProfileAccess, 'relation' | 'canEditProfessional' | 'canManageResponsibilities' | 'canManageReportingLine'>;
}

export interface TeamDto {
  manager: ProfilePersonDto;
  members: StaffSummaryDto[];
  /** Families, students, contacts, conversations and approvals are disjoint across owners, so these sums are exact. */
  totals: StaffWorkload;
  /** Computed DISTINCT across the team -- never the sum of members' counts. */
  distinctTeachers: number;
  generatedAt: string;
}

export interface ActivityEntryDto {
  id: string;
  action: string;
  at: string;
  target: { staffId: string; displayName: string | null };
  actor: { staffId: string; displayName: string } | null;
  changedFields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
}

export interface OrganizationOverviewDto {
  generatedAt: string;
  accounts: {
    byRole: Record<string, { active: number; inactive: number }>;
    managers: number;
    adminsAndSupervisors: number;
    active: number;
    inactive: number;
    withoutLogin: number;
  };
  teams: Array<{
    manager: ProfilePersonDto & { isActive: boolean };
    memberCount: number;
    totals: StaffWorkload;
    distinctTeachers: number;
  }>;
  responsibilityCoverage: Array<{ category: string; holders: Array<{ staffId: string; displayName: string }> }>;
  workload: {
    /** Unique organization totals, each from its own query. */
    unique: OrganizationTotals;
    /** Sum over every team above. Lower than `unique` whenever families are owned outside any team. */
    sumOfTeams: Pick<StaffWorkload, 'assignedFamilies' | 'studentsInAssignedFamilies' | 'openConversations' | 'pendingApprovals'>;
    /** Families owned by staff who belong to no team (unique.families - sumOfTeams.assignedFamilies). */
    familiesOutsideTeams: number;
  };
  health: {
    withoutReportingLine: ProfilePersonDto[];
    incompleteProfiles: Array<ProfilePersonDto & { missing: CompletenessDto['missing'] }>;
    withoutLogin: ProfilePersonDto[];
    /** Reporting lines whose manager is no longer a manager (role changed since). */
    staleReportingLines: Array<{ member: ProfilePersonDto; manager: ProfilePersonDto }>;
    familiesOwnedByInactiveStaff: number;
  };
  directory: StaffSummaryDto[];
  directoryTruncated: boolean;
  recentActivity: ActivityEntryDto[];
}

type StaffRow = Prisma.StaffGetPayload<{
  include: {
    profile: true;
    reportingLine: { include: { manager: { include: { profile: true } } } };
  };
}>;

const STAFF_INCLUDE = {
  profile: true,
  reportingLine: { include: { manager: { include: { profile: true } } } },
} as const;

@Injectable()
export class StaffProfileService {
  private readonly logger = new Logger(StaffProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly workload: StaffWorkloadService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    /**
     * The restricted runtime path (chat_app + trusted actor context). Present
     * and enabled when DATABASE_APP_URL is set; otherwise every request runs on
     * the owner connection exactly as before.
     */
    @Optional() private readonly scoped?: ActorScopedDatabase,
  ) {}

  /**
   * ONE transaction per request. On chat_app it is a scoped transaction whose
   * identity the database itself enforces (RLS, column grants, the authorizing
   * functions); on the owner connection, a plain transaction. The rules in this
   * service run in both modes; on chat_app the database applies them again.
   */
  private run<T>(actor: Actor, fn: (db: Tx) => Promise<T>): Promise<T> {
    if (this.scoped?.enabled) return this.scoped.withActor(actor, fn);
    return this.prisma.$transaction(fn, { timeout: 15_000 });
  }

  // =========================================================================
  // Reads
  // =========================================================================

  async profile(actor: Actor, targetRef: string): Promise<StaffProfileDto> {
    const organizationId = this.requireStaffActor(actor);
    const targetId = this.resolveRef(actor, targetRef);
    return this.run(actor, (db) => this.profileIn(db, actor, organizationId, targetId));
  }

  private async profileIn(db: Tx, actor: Actor, organizationId: string, targetId: string): Promise<StaffProfileDto> {
    const staff = await this.findStaff(db, organizationId, targetId);
    const access = staff ? this.accessFor(actor, staff) : NO_PROFILE_ACCESS;
    if (!staff || !access.canView) throw notFound();

    const [workload, facts, responsibilities] = await Promise.all([
      this.workload.forStaff(organizationId, [staff.id], db),
      this.loginFacts(db, [staff.id]),
      db.staffResponsibility.findMany({
        where: { staffId: staff.id, organizationId },
        orderBy: [{ endedAt: { sort: 'desc', nulls: 'first' } }, { assignedAt: 'desc' }],
        take: 100,
      }),
    ]);
    const login = facts.get(staff.id);
    const names = await this.staffNames(db, organizationId, [
      ...responsibilities.map((r) => r.assignedBy),
      staff.profile?.updatedBy ?? null,
    ]);
    const w = workload.get(staff.id)!;
    const active = responsibilities.filter((r) => r.endedAt === null);

    return {
      staffId: staff.id,
      displayName: staff.name,
      role: staff.role,
      isActive: isLive(staff),
      leftAt: iso(staff.leftAt),
      joinedAt: staff.createdAt.toISOString(),
      lastActivityAt: iso(staff.lastActivityAt),
      account: {
        hasLogin: login?.hasLogin ?? false,
        status: login?.status ?? null,
        lastLoginAt: iso(login?.lastLoginAt ?? null),
      },
      signInIdentity: access.relation === 'self' ? (login?.subject ?? null) : null,
      jobTitle: staff.profile?.jobTitle ?? null,
      about: staff.profile?.about ?? null,
      avatarUrl: await this.sign(staff.avatarObjectKey),
      version: iso(staff.profile?.updatedAt ?? null),
      profileUpdatedAt: iso(staff.profile?.updatedAt ?? null),
      profileUpdatedBy: person(names, staff.profile?.updatedBy ?? null),
      reportingManager: staff.reportingLine
        ? await this.personDto(staff.reportingLine.manager)
        : null,
      // History (ended rows) only for someone who may manage them or read audit.
      responsibilities: (access.canManageResponsibilities || access.canReadAudit ? responsibilities : active).map(
        (r) => ({
          id: r.id,
          category: r.category,
          scopeNote: r.scopeNote,
          assignedAt: r.assignedAt.toISOString(),
          assignedBy: person(names, r.assignedBy),
          endedAt: iso(r.endedAt),
          endReason: r.endReason,
        }),
      ),
      derivedResponsibilities: derived(staff.role, w),
      workload: w,
      completeness: completeness(staff, active.length),
      access,
      viewer: {
        team: profilePermissionsFor(actor.staffRole).has(StaffProfilePermission.TEAM_VIEW),
        organizationOverview: this.authz.canViewOrganizationProfiles(actor).allowed,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * The caller's direct reports. A manager (team_profiles.view) sees their
   * team; the super admin sees the managers and staff who report to them.
   * Everybody else gets an empty team, not an error: having no reports is a
   * fact, not a refusal.
   */
  async team(actor: Actor): Promise<TeamDto> {
    const organizationId = this.requireStaffActor(actor);
    return this.run(actor, async (db) => {
    const me = await this.findStaff(db, organizationId, actor.actorId);
    if (!me) throw notFound();

    const rows = await db.staff.findMany({
      where: { organizationId, reportingLine: { managerId: me.id } },
      include: STAFF_INCLUDE,
      orderBy: { name: 'asc' },
      take: DIRECTORY_LIMIT,
    });
    const members = rows.filter((row) => this.accessFor(actor, row).canView);
    const summaries = await this.summaries(db, actor, organizationId, members);

    return {
      manager: await this.personDto(me),
      members: summaries,
      totals: sumWorkload(summaries.filter((m) => m.isActive).map((m) => m.workload)),
      distinctTeachers: await this.workload.distinctTeachers(
        organizationId,
        summaries.filter((m) => m.isActive).map((m) => m.staffId),
        db,
      ),
      generatedAt: new Date().toISOString(),
    };
    });
  }

  async activity(actor: Actor, targetRef: string): Promise<{ entries: ActivityEntryDto[] }> {
    const organizationId = this.requireStaffActor(actor);
    const targetId = this.resolveRef(actor, targetRef);
    return this.run(actor, async (db) => {
      const staff = await this.findStaff(db, organizationId, targetId);
      const access = staff ? this.accessFor(actor, staff) : NO_PROFILE_ACCESS;
      if (!staff || !access.canView) throw notFound();
      if (!access.canReadAudit) {
        throw new CommError(CommErrorCode.STAFF_PROFILE_EDIT_DENIED, 'the audit trail is readable by managers and the super admin', 403);
      }
      return { entries: await this.auditEntries(db, organizationId, [staff.id]) };
    });
  }

  /** The super admin's master overview. Every number is its own query; nothing is a sum of overlapping sets. */
  async organization(actor: Actor): Promise<OrganizationOverviewDto> {
    const decision = this.authz.canViewOrganizationProfiles(actor);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason, 403);
    const organizationId = actor.organizationId as string;
    return this.run(actor, async (db) => {

    const rows = await db.staff.findMany({
      where: { organizationId },
      include: STAFF_INCLUDE,
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      take: DIRECTORY_LIMIT + 1,
    });
    const truncated = rows.length > DIRECTORY_LIMIT;
    const staff = rows.slice(0, DIRECTORY_LIMIT);

    const [directory, unique, activeResponsibilities, recentActivity] = await Promise.all([
      this.summaries(db, actor, organizationId, staff),
      this.workload.organizationTotals(organizationId, db),
      db.staffResponsibility.findMany({
        where: { organizationId, endedAt: null },
        select: { staffId: true, category: true },
      }),
      this.auditEntries(db, organizationId, staff.map((s) => s.id)),
    ]);
    const byId = new Map(directory.map((d) => [d.staffId, d]));

    const byRole: Record<string, { active: number; inactive: number }> = {};
    for (const s of staff) {
      const bucket = (byRole[s.role] ??= { active: 0, inactive: 0 });
      if (isLive(s)) bucket.active += 1;
      else bucket.inactive += 1;
    }

    const managers = staff.filter((s) => s.role === StaffRole.MANAGER);
    const teams = await Promise.all(
      managers.map(async (m) => {
        const memberIds = staff
          // Same membership rule as team(): live, and never a manager or the
          // super admin (a role changed after the line was written).
          .filter((s) => s.reportingLine?.managerId === m.id && isLive(s) && !NEVER_A_TEAM_MEMBER.has(s.role))
          .map((s) => s.id);
        return {
          manager: { ...(await this.personDto(m)), isActive: isLive(m) },
          memberCount: memberIds.length,
          totals: sumWorkload(memberIds.map((id) => byId.get(id)!.workload)),
          distinctTeachers: await this.workload.distinctTeachers(organizationId, memberIds, db),
        };
      }),
    );

    const sumOfTeams = sumWorkload(teams.map((t) => t.totals));
    const live = staff.filter(isLive);
    const people = new Map(await Promise.all(staff.map(async (s) => [s.id, await this.personDto(s)] as const)));

    return {
      generatedAt: new Date().toISOString(),
      accounts: {
        byRole,
        managers: live.filter((s) => s.role === StaffRole.MANAGER).length,
        adminsAndSupervisors: live.filter(
          (s) => s.role !== StaffRole.MANAGER && s.role !== StaffRole.SUPER_ADMIN,
        ).length,
        active: live.length,
        inactive: staff.length - live.length,
        withoutLogin: live.filter((s) => !byId.get(s.id)!.account.hasLogin).length,
      },
      teams,
      // Coverage is what LIVE staff hold: a label on a departed account covers nothing.
      responsibilityCoverage: groupCoverage(
        activeResponsibilities.filter((r) => live.some((s) => s.id === r.staffId)),
        people,
      ),
      workload: {
        unique,
        sumOfTeams: {
          assignedFamilies: sumOfTeams.assignedFamilies,
          studentsInAssignedFamilies: sumOfTeams.studentsInAssignedFamilies,
          openConversations: sumOfTeams.openConversations,
          pendingApprovals: sumOfTeams.pendingApprovals,
        },
        familiesOutsideTeams: Math.max(0, unique.families - sumOfTeams.assignedFamilies),
      },
      health: {
        withoutReportingLine: live
          .filter((s) => s.role !== StaffRole.SUPER_ADMIN && !s.reportingLine)
          .map((s) => people.get(s.id)!),
        incompleteProfiles: live
          .map((s) => ({ s, c: byId.get(s.id)!.completeness }))
          .filter(({ c }) => c.missing.length > 0)
          .map(({ s, c }) => ({ ...people.get(s.id)!, missing: c.missing })),
        withoutLogin: live.filter((s) => !byId.get(s.id)!.account.hasLogin).map((s) => people.get(s.id)!),
        staleReportingLines: live
          .filter((s) => s.reportingLine && isStaleLine(s.role, s.reportingLine.manager))
          .map((s) => ({ member: people.get(s.id)!, manager: people.get(s.reportingLine!.managerId)! }))
          .filter((x) => x.manager),
        familiesOwnedByInactiveStaff: unique.familiesOwnedByInactiveStaff,
      },
      directory,
      directoryTruncated: truncated,
      recentActivity: recentActivity.slice(0, ACTIVITY_LIMIT),
    };
    });
  }

  // =========================================================================
  // Writes: descriptive fields
  // =========================================================================

  /**
   * Edit job title, introduction and (super admin only) display name. Only the
   * fields present in `input` change; an absent field is left exactly as it is.
   */
  async updateProfile(
    actor: Actor,
    targetRef: string,
    input: Record<string, unknown>,
  ): Promise<StaffProfileDto> {
    const organizationId = this.requireStaffActor(actor);
    const allowed = new Set(['jobTitle', 'about', 'displayName', 'expectedVersion', 'reason']);
    const unknown = Object.keys(input ?? {}).filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
      throw invalid(`not an editable profile field: ${unknown.join(', ')}`);
    }

    const changes: { jobTitle?: string | null; about?: string | null; displayName?: string } = {};
    if ('jobTitle' in input) changes.jobTitle = text(normalizeLine(input.jobTitle, JOB_TITLE_MAX), 'jobTitle');
    if ('about' in input) changes.about = text(normalizeParagraphs(input.about, ABOUT_MAX), 'about');
    if ('displayName' in input) {
      changes.displayName = text(normalizeLine(input.displayName, DISPLAY_NAME_MAX, true), 'displayName') as string;
    }
    const reason = optionalReason(input.reason);
    const expectedVersion = 'expectedVersion' in input ? (input.expectedVersion as string | null) : undefined;

    const targetId = this.resolveRef(actor, targetRef);
    await this.run(actor, async (tx) => {
      const { staff, access, fresh } = await this.lockTarget(tx, actor, organizationId, targetId);

      if (('jobTitle' in changes || 'about' in changes) && !access.canEditProfessional) throw editDenied('job title and introduction');
      if ('displayName' in changes && !access.canEditDisplayName) throw editDenied('display name');
      if (expectedVersion !== undefined && expectedVersion !== iso(staff.profile?.updatedAt ?? null)) {
        throw new CommError(CommErrorCode.STAFF_PROFILE_CONFLICT, 'the profile changed since it was loaded', 409);
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const note = (field: string, from: unknown, to: unknown) => {
        if (from !== to) {
          before[field] = from;
          after[field] = to;
        }
      };
      if ('jobTitle' in changes) note('jobTitle', staff.profile?.jobTitle ?? null, changes.jobTitle);
      if ('about' in changes) note('about', staff.profile?.about ?? null, changes.about);
      if ('displayName' in changes) note('displayName', staff.name, changes.displayName);
      if (Object.keys(after).length === 0) return;

      if ('jobTitle' in after || 'about' in after) {
        const data = {
          ...('jobTitle' in after ? { jobTitle: changes.jobTitle ?? null } : {}),
          ...('about' in after ? { about: changes.about ?? null } : {}),
          updatedBy: fresh.actorId,
        };
        await tx.staffProfile.upsert({
          where: { staffId: staff.id },
          create: { staffId: staff.id, ...data },
          update: data,
        });
      }
      if ('displayName' in after) {
        // The NAME column only. Login identity (chat.account.subject), ids and
        // every foreign key are untouched: renaming someone changes how they are
        // shown, never who they are or how they sign in.
        await this.setStaffColumn(tx, staff.id, 'name', changes.displayName as string);
        // A name change still bumps the profile version so a stale editor conflicts.
        await tx.staffProfile.upsert({
          where: { staffId: staff.id },
          create: { staffId: staff.id, updatedBy: fresh.actorId },
          update: { updatedBy: fresh.actorId, updatedAt: new Date() },
        });
      }

      await this.writeAudit(tx, fresh, staff.id, ProfileAuditAction.UPDATED, before, after, reason ?? defaultReason(access));
    });

    return this.profile(actor, targetId);
  }

  // =========================================================================
  // Writes: the photo
  // =========================================================================

  /** Step 1: a short-lived PUT URL bound to type and size, under the TARGET's own prefix. */
  async authorizeAvatarUpload(
    actor: Actor,
    targetRef: string,
    input: { mimeType?: unknown; byteSize?: unknown },
  ): Promise<UploadAuthorization> {
    const organizationId = this.requireStaffActor(actor);
    const targetId = this.resolveRef(actor, targetRef);
    const staff = await this.run(actor, (db) => this.findStaff(db, organizationId, targetId));
    const access = staff ? this.accessFor(actor, staff) : NO_PROFILE_ACCESS;
    if (!staff || !access.canView) throw notFound();
    if (!access.canEditPhoto) throw editDenied('photo');

    if (!isAvatarMime(input.mimeType)) {
      throw avatarInvalid('a profile photo must be a JPEG, PNG or WebP image');
    }
    const byteSize = Number(input.byteSize);
    if (!Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_AVATAR_BYTES) {
      throw avatarInvalid(`a profile photo must be between 1 byte and ${MAX_AVATAR_BYTES} bytes`);
    }
    return this.storage.authorizeUpload({
      prefix: avatarPrefix(staff.id),
      mimeType: input.mimeType,
      byteSize,
    });
  }

  /**
   * Step 2: commit an uploaded object as the profile photo.
   *
   * The key must sit under THIS profile's prefix (`avatars/staff/<id>/<uuid>`),
   * checked structurally, so a key lifted from someone else's signed URL is
   * refused before anything is read. Then the stored bytes -- not the client's
   * claim -- are inspected: real JPEG/PNG/WebP signature, matching the type
   * storage recorded, size and dimensions within limits. A rejected object is
   * deleted. On success the previous photo's object is deleted after the
   * transaction commits, so replacing a photo leaves no orphan behind.
   */
  async commitAvatar(
    actor: Actor,
    targetRef: string,
    input: { objectKey?: unknown },
  ): Promise<StaffProfileDto> {
    const organizationId = this.requireStaffActor(actor);
    const targetId = this.resolveRef(actor, targetRef);
    const pre = await this.run(actor, (db) => this.findStaff(db, organizationId, targetId));
    const preAccess = pre ? this.accessFor(actor, pre) : NO_PROFILE_ACCESS;
    if (!pre || !preAccess.canView) throw notFound();
    if (!preAccess.canEditPhoto) throw editDenied('photo');

    const objectKey = typeof input.objectKey === 'string' ? input.objectKey : '';
    if (!avatarKeyBelongsTo(pre.id, objectKey)) {
      throw new CommError(
        CommErrorCode.STAFF_PROFILE_EDIT_DENIED,
        'that object is not an upload for this profile',
        403,
      );
    }
    if (objectKey === pre.avatarObjectKey) return this.profile(actor, targetId);

    const stored = await this.storage.readHead(objectKey, AVATAR_HEAD_BYTES);
    if (!stored) throw avatarInvalid('no uploaded photo was found for that key; upload it first');
    const verdict = judgeAvatar({ head: stored.head, byteSize: stored.byteSize, declaredMime: stored.contentType });
    if (!verdict.ok) {
      await this.discard(objectKey);
      throw avatarInvalid(AVATAR_REJECTION_MESSAGE[verdict.reason]);
    }

    let previous: string | null = null;
    try {
      await this.run(actor, async (tx) => {
        const { staff, access, fresh } = await this.lockTarget(tx, actor, organizationId, targetId);
        if (!access.canEditPhoto) throw editDenied('photo');
        previous = staff.avatarObjectKey;
        await this.setStaffColumn(tx, staff.id, 'avatar_object_key', objectKey);
        await tx.staffProfile.upsert({
          where: { staffId: staff.id },
          create: { staffId: staff.id, updatedBy: fresh.actorId },
          update: { updatedBy: fresh.actorId, updatedAt: new Date() },
        });
        await this.writeAudit(
          tx,
          fresh,
          staff.id,
          ProfileAuditAction.PHOTO_SET,
          { hasPhoto: previous !== null },
          { hasPhoto: true, width: verdict.image.width, height: verdict.image.height, type: verdict.image.mime },
          defaultReason(access),
        );
      });
    } catch (error) {
      // The database refused: the new object is referenced by nothing.
      await this.discard(objectKey);
      throw error;
    }
    if (previous && previous !== objectKey) await this.discard(previous);
    return this.profile(actor, targetId);
  }

  async removeAvatar(actor: Actor, targetRef: string): Promise<StaffProfileDto> {
    const organizationId = this.requireStaffActor(actor);
    const targetId = this.resolveRef(actor, targetRef);
    let previous: string | null = null;
    await this.run(actor, async (tx) => {
      const { staff, access, fresh } = await this.lockTarget(tx, actor, organizationId, targetId);
      if (!access.canEditPhoto) throw editDenied('photo');
      previous = staff.avatarObjectKey;
      if (!previous) return;
      await this.setStaffColumn(tx, staff.id, 'avatar_object_key', null);
      await tx.staffProfile.upsert({
        where: { staffId: staff.id },
        create: { staffId: staff.id, updatedBy: fresh.actorId },
        update: { updatedBy: fresh.actorId, updatedAt: new Date() },
      });
      await this.writeAudit(tx, fresh, staff.id, ProfileAuditAction.PHOTO_REMOVED, { hasPhoto: true }, { hasPhoto: false }, defaultReason(access));
    });
    if (previous) await this.discard(previous);
    return this.profile(actor, targetId);
  }

  // =========================================================================
  // Writes: official assignments
  // =========================================================================

  async assignResponsibility(
    actor: Actor,
    targetRef: string,
    input: { category?: unknown; scopeNote?: unknown },
  ): Promise<StaffProfileDto> {
    const organizationId = this.requireStaffActor(actor);
    if (!isResponsibilityCategory(input.category)) throw invalid('unknown responsibility category');
    const category = input.category;
    const scopeNote = text(normalizeLine(input.scopeNote, SCOPE_NOTE_MAX), 'scopeNote');
    if (category === 'other' && !scopeNote) throw invalid('an "other" responsibility needs a scope note');

    const targetId = this.resolveRef(actor, targetRef);
    await this.run(actor, async (tx) => {
      const { staff, access, fresh } = await this.lockTarget(tx, actor, organizationId, targetId);
      if (!access.canManageResponsibilities) throw assignmentDenied('you may not assign responsibilities on this profile');

      const existing = await tx.staffResponsibility.findFirst({
        where: { staffId: staff.id, category, endedAt: null },
        select: { id: true },
      });
      if (existing) throw assignmentInvalid('this responsibility is already assigned');

      const row = await tx.staffResponsibility.create({
        data: { staffId: staff.id, category, scopeNote, assignedBy: fresh.actorId },
      });
      await this.writeAudit(
        tx,
        fresh,
        staff.id,
        ProfileAuditAction.RESPONSIBILITY_ASSIGNED,
        null,
        { responsibilityId: row.id, category, scopeNote },
        defaultReason(access),
      );
    });
    return this.profile(actor, targetId);
  }

  async endResponsibility(
    actor: Actor,
    targetRef: string,
    responsibilityId: string,
    input: { reason?: unknown },
  ): Promise<StaffProfileDto> {
    const organizationId = this.requireStaffActor(actor);
    const reason = text(normalizeLine(input.reason, REASON_MAX, true), 'reason') as string;
    const targetId = this.resolveRef(actor, targetRef);
    if (!UUID.test(responsibilityId)) throw assignmentInvalid('no such active responsibility');

    await this.run(actor, async (tx) => {
      const { staff, access, fresh } = await this.lockTarget(tx, actor, organizationId, targetId);
      if (!access.canManageResponsibilities) throw assignmentDenied('you may not end responsibilities on this profile');

      // Narrowed to THIS profile in the WHERE clause, so another person's
      // responsibility id is simply not found.
      const row = await tx.staffResponsibility.findFirst({
        where: { id: responsibilityId, staffId: staff.id, organizationId, endedAt: null },
      });
      if (!row) throw assignmentInvalid('no such active responsibility');

      await tx.staffResponsibility.update({
        where: { id: row.id },
        data: { endedAt: new Date(), endedBy: fresh.actorId, endReason: reason },
      });
      await this.writeAudit(
        tx,
        fresh,
        staff.id,
        ProfileAuditAction.RESPONSIBILITY_ENDED,
        { responsibilityId: row.id, category: row.category, scopeNote: row.scopeNote },
        { responsibilityId: row.id, ended: true },
        reason,
      );
    });
    return this.profile(actor, targetId);
  }

  /**
   * Set or clear who a staff member reports to. `reporting_lines.manage` --
   * the super admin only. The hierarchy (admin -> manager -> super admin, nobody
   * above the super admin) is checked here for a clear error and again by
   * chat.guard_staff_reporting_line for every other writer.
   */
  async setReportingLine(
    actor: Actor,
    targetRef: string,
    input: { managerStaffId?: unknown; reason?: unknown },
  ): Promise<StaffProfileDto> {
    const organizationId = this.requireStaffActor(actor);
    const reason = text(normalizeLine(input.reason, REASON_MAX, true), 'reason') as string;
    const managerId = input.managerStaffId === null ? null : String(input.managerStaffId ?? '');
    if (managerId !== null && !UUID.test(managerId)) throw assignmentInvalid('manager not found');
    const targetId = this.resolveRef(actor, targetRef);

    await this.run(actor, async (tx) => {
      const { staff, access, fresh } = await this.lockTarget(tx, actor, organizationId, targetId);
      if (!access.canManageReportingLine) throw assignmentDenied('only the super admin changes reporting lines');

      const before = staff.reportingLine
        ? { managerStaffId: staff.reportingLine.managerId, managerName: staff.reportingLine.manager.name }
        : { managerStaffId: null };

      if (managerId === null) {
        if (!staff.reportingLine) return;
        await tx.staffReportingLine.delete({ where: { staffId: staff.id } });
        await this.writeAudit(tx, fresh, staff.id, ProfileAuditAction.REPORTING_LINE_CLEARED, before, { managerStaffId: null }, reason);
        return;
      }

      const manager = await tx.staff.findFirst({ where: { id: managerId, organizationId } });
      if (!manager) throw assignmentInvalid('manager not found');
      if (manager.id === staff.id) throw assignmentInvalid('a staff member cannot report to themselves');
      if (!isLive(manager)) throw assignmentInvalid('the manager is inactive');
      if (manager.role !== StaffRole.MANAGER && manager.role !== StaffRole.SUPER_ADMIN) {
        throw assignmentInvalid('only a manager or the super admin can have direct reports');
      }
      if (staff.role === StaffRole.MANAGER && manager.role !== StaffRole.SUPER_ADMIN) {
        throw assignmentInvalid('a manager reports only to the super admin');
      }
      if (staff.reportingLine?.managerId === manager.id) return;

      await tx.staffReportingLine.upsert({
        where: { staffId: staff.id },
        create: { staffId: staff.id, managerId: manager.id, assignedBy: fresh.actorId },
        update: { managerId: manager.id, assignedBy: fresh.actorId, assignedAt: new Date() },
      });
      await this.writeAudit(
        tx,
        fresh,
        staff.id,
        ProfileAuditAction.REPORTING_LINE_SET,
        before,
        { managerStaffId: manager.id, managerName: manager.name },
        reason,
      );
    });
    return this.profile(actor, targetId);
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private requireStaffActor(actor: Actor): string {
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId) {
      // A parent or teacher has no staff profile surface at all.
      throw notFound();
    }
    if (!actor.isActive) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not use staff profiles', 403);
    }
    return actor.organizationId;
  }

  /** `me` is the caller. Anything else must at least be a uuid, or it is simply not found. */
  private resolveRef(actor: Actor, ref: string): string {
    if (ref === 'me') return actor.actorId;
    if (!UUID.test(ref)) throw notFound();
    return ref;
  }

  private findStaff(db: Tx, organizationId: string, staffId: string): Promise<StaffRow | null> {
    return db.staff.findFirst({ where: { id: staffId, organizationId }, include: STAFF_INCLUDE });
  }

  private accessFor(actor: Actor, staff: StaffRow): StaffProfileAccess {
    return this.authz.staffProfileAccess(actor, toTarget(actor, staff));
  }

  /**
   * Inside a write: lock the target row, re-read the caller, and decide again.
   * The caller is re-read because the token was minted up to 15 minutes ago; a
   * manager demoted or deactivated since then must not finish the write.
   */
  private async lockTarget(
    tx: Tx,
    actor: Actor,
    organizationId: string,
    targetId: string,
  ): Promise<{ staff: StaffRow; access: StaffProfileAccess; fresh: Actor }> {
    await tx.$queryRaw`select id from chat.staff where id = ${targetId}::uuid and organization_id = ${organizationId}::uuid for update`;
    const [staff, me] = await Promise.all([
      this.findStaff(tx, organizationId, targetId),
      tx.staff.findFirst({ where: { id: actor.actorId, organizationId } }),
    ]);
    const fresh: Actor = me
      ? { ...actor, staffRole: me.role as StaffRole, isActive: isLive(me) }
      : { ...actor, isActive: false };
    const access = staff ? this.authz.staffProfileAccess(fresh, toTarget(fresh, staff)) : NO_PROFILE_ACCESS;
    if (!staff || !access.canView) throw notFound();
    return { staff, access, fresh };
  }

  private async summaries(db: Tx, actor: Actor, organizationId: string, rows: StaffRow[]): Promise<StaffSummaryDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [workload, facts, responsibilities] = await Promise.all([
      this.workload.forStaff(organizationId, ids, db),
      this.loginFacts(db, ids),
      db.staffResponsibility.findMany({
        where: { organizationId, staffId: { in: ids }, endedAt: null },
        select: { staffId: true, category: true },
      }),
    ]);
    const categories = new Map<string, string[]>();
    for (const r of responsibilities) {
      const list = categories.get(r.staffId) ?? [];
      list.push(r.category);
      categories.set(r.staffId, list);
    }
    return Promise.all(
      rows.map(async (s) => {
        const access = this.accessFor(actor, s);
        const held = categories.get(s.id) ?? [];
        return {
          staffId: s.id,
          displayName: s.name,
          role: s.role,
          jobTitle: s.profile?.jobTitle ?? null,
          avatarUrl: await this.sign(s.avatarObjectKey),
          isActive: isLive(s),
          account: { hasLogin: facts.get(s.id)?.hasLogin ?? false, status: facts.get(s.id)?.status ?? null },
          lastActivityAt: iso(s.lastActivityAt),
          profileUpdatedAt: iso(s.profile?.updatedAt ?? null),
          joinedAt: s.createdAt.toISOString(),
          reportingManager: s.reportingLine
            ? {
                staffId: s.reportingLine.managerId,
                displayName: s.reportingLine.manager.name,
                role: s.reportingLine.manager.role,
              }
            : null,
          responsibilities: held,
          workload: workload.get(s.id)!,
          completeness: completeness(s, held.length),
          access: {
            relation: access.relation,
            canEditProfessional: access.canEditProfessional,
            canManageResponsibilities: access.canManageResponsibilities,
            canManageReportingLine: access.canManageReportingLine,
          },
        };
      }),
    );
  }

  /**
   * The only two chat.staff columns this module writes, by name. Not
   * `tx.staff.update`: Prisma always adds `updated_at` (@updatedAt) to the SET
   * list, and the request role holds no grant on it -- trigger
   * staff_set_updated_at maintains it -- so on chat_app that update is refused.
   */
  private async setStaffColumn(tx: Tx, staffId: string, column: 'name' | 'avatar_object_key', value: string | null): Promise<void> {
    if (column === 'name') {
      await tx.$executeRaw`update chat.staff set name = ${value} where id = ${staffId}::uuid`;
    } else {
      await tx.$executeRaw`update chat.staff set avatar_object_key = ${value} where id = ${staffId}::uuid`;
    }
  }

  /** Profile audit rows, through the authorizing function (both connection modes). */
  private async auditEntries(db: Tx, organizationId: string, staffIds: string[]): Promise<ActivityEntryDto[]> {
    if (staffIds.length === 0) return [];
    const rows = await db.$queryRaw<Array<{
      id: bigint; actor_id: string | null; action: string; entity_id: string;
      before: unknown; after: unknown; reason: string; at: Date;
    }>>`select id, actor_id::text, action, entity_id::text, before, after, reason, at
          from chat.staff_profile_activity(${staffIds}::uuid[], ${ACTIVITY_LIMIT}::int)`;
    const names = await this.staffNames(db, organizationId, [
      ...rows.map((r) => r.actor_id),
      ...rows.map((r) => r.entity_id),
    ]);
    return rows.map((r) => {
      const after = asRecord(r.after);
      const before = asRecord(r.before);
      return {
        id: r.id.toString(),
        action: r.action,
        at: r.at.toISOString(),
        target: { staffId: r.entity_id, displayName: names.get(r.entity_id) ?? null },
        actor: person(names, r.actor_id),
        changedFields: Object.keys({ ...(before ?? {}), ...(after ?? {}) }),
        before,
        after,
        reason: r.reason,
      };
    });
  }

  /** has_login / status / last_login_at; subject on the caller's own row only. */
  private async loginFacts(
    db: Tx,
    staffIds: string[],
  ): Promise<Map<string, { hasLogin: boolean; status: string | null; lastLoginAt: Date | null; subject: string | null }>> {
    if (staffIds.length === 0) return new Map();
    const rows = await db.$queryRaw<Array<{
      staff_id: string; has_login: boolean; status: string | null; last_login_at: Date | null; subject: string | null;
    }>>`select staff_id::text, has_login, status, last_login_at, subject from chat.staff_login_facts(${staffIds}::uuid[])`;
    return new Map(rows.map((r) => [r.staff_id, {
      hasLogin: r.has_login, status: r.status, lastLoginAt: r.last_login_at, subject: r.subject,
    }]));
  }

  private async staffNames(db: Tx, organizationId: string, ids: Array<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await db.staff.findMany({
      where: { id: { in: wanted }, organizationId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async personDto(s: {
    id: string;
    name: string;
    role: string;
    avatarObjectKey: string | null;
    profile?: { jobTitle: string | null } | null;
  }): Promise<ProfilePersonDto> {
    return {
      staffId: s.id,
      displayName: s.name,
      role: s.role,
      jobTitle: s.profile?.jobTitle ?? null,
      avatarUrl: await this.sign(s.avatarObjectKey),
    };
  }

  /**
   * Through chat.record_staff_profile_audit in both modes: its actor is
   * chat.trusted_staff_actor, so on chat_app a request can only ever write audit
   * rows as itself, and nothing needs INSERT on chat.audit_log.
   */
  private async writeAudit(
    tx: Tx,
    actor: Actor,
    staffId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    reason: string,
  ): Promise<void> {
    await tx.$queryRaw`select chat.record_staff_profile_audit(
      ${actor.actorId}::uuid, ${action}, ${staffId}::uuid,
      ${before === null ? null : JSON.stringify(before)}::jsonb,
      ${after === null ? null : JSON.stringify(after)}::jsonb,
      ${reason})`;
  }

  /** Signed only after the caller was authorized to see the profile it belongs to. */
  private sign(objectKey: string | null): Promise<string | null> {
    if (!objectKey) return Promise.resolve(null);
    const ttl = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);
    return this.storage.signedReadUrl(objectKey, Number.isFinite(ttl) && ttl > 0 ? ttl : 300);
  }

  /** Best effort: a failed delete leaves an unreferenced object, never a broken profile. */
  private async discard(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch (error) {
      this.logger.warn(`could not delete unreferenced avatar object: ${(error as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function avatarPrefix(staffId: string): string {
  return `avatars/staff/${staffId}`;
}

/** Structural, not `startsWith`: `avatars/staff/<idA><suffix>` must not pass for idA. */
export function avatarKeyBelongsTo(staffId: string, objectKey: string): boolean {
  try {
    assertSafeObjectKey(objectKey);
  } catch {
    return false;
  }
  const s = objectKey.split('/');
  return s.length === 4 && s[0] === 'avatars' && s[1] === 'staff' && s[2] === staffId && UUID.test(s[3]);
}

function toTarget(actor: Actor, staff: StaffRow): StaffProfileTarget {
  return {
    staffId: staff.id,
    role: staff.role,
    organizationId: staff.organizationId,
    isActive: isLive(staff),
    reportsToActor: staff.reportingLine?.managerId === actor.actorId,
  };
}

/**
 * A reporting line the database accepted when it was written but that no
 * longer fits the hierarchy, because a role or activity changed AFTERWARDS
 * (the guard runs on writes to the line, not on writes to chat.staff). Such a
 * line grants nothing -- staffProfileAccess re-checks the manager's role on
 * every request -- but the super admin should see it and fix it.
 */
export function isStaleLine(
  memberRole: string,
  manager: { role: string; isActive: boolean; leftAt: Date | null },
): boolean {
  if (!isLive(manager)) return true;
  if (memberRole === StaffRole.SUPER_ADMIN) return true;
  if (manager.role !== StaffRole.MANAGER && manager.role !== StaffRole.SUPER_ADMIN) return true;
  return memberRole === StaffRole.MANAGER && manager.role !== StaffRole.SUPER_ADMIN;
}

function isLive(s: { isActive: boolean; leftAt: Date | null }): boolean {
  return s.isActive && s.leftAt === null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function person(names: Map<string, string>, id: string | null): { staffId: string; displayName: string } | null {
  if (!id) return null;
  const displayName = names.get(id);
  // An id that does not resolve is reported as unknown, never given a made-up name.
  return displayName ? { staffId: id, displayName } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function completeness(
  s: { role: string; avatarObjectKey: string | null; profile?: { jobTitle: string | null; about: string | null } | null; reportingLine?: unknown },
  activeResponsibilities: number,
): CompletenessDto {
  const missing: CompletenessDto['missing'] = [];
  let total = 3;
  if (!s.avatarObjectKey) missing.push('photo');
  if (!s.profile?.jobTitle) missing.push('job_title');
  if (!s.profile?.about) missing.push('about');
  if (s.role !== StaffRole.SUPER_ADMIN) {
    total += 2;
    if (!s.reportingLine) missing.push('reporting_line');
    if (activeResponsibilities === 0) missing.push('responsibility');
  }
  return { complete: total - missing.length, total, missing };
}

function derived(role: string, w: StaffWorkload): DerivedResponsibilityDto[] {
  const out: DerivedResponsibilityDto[] = [];
  if (w.assignedFamilies > 0) out.push({ kind: 'family_supervision', count: w.assignedFamilies });
  if (w.directReports > 0) out.push({ kind: 'team_management', count: w.directReports });
  if (role === StaffRole.COVERAGE) out.push({ kind: 'coverage_role', count: null });
  return out;
}

export function sumWorkload(items: StaffWorkload[]): StaffWorkload {
  const total: StaffWorkload = {
    assignedFamilies: 0,
    studentsInAssignedFamilies: 0,
    parentContacts: 0,
    teachersOfAssignedStudents: 0,
    openConversations: 0,
    awaitingReply: 0,
    pendingApprovals: 0,
    directReports: 0,
  };
  for (const w of items) {
    for (const key of Object.keys(total) as Array<keyof StaffWorkload>) total[key] += w[key];
  }
  // A teacher shared by two supervisors would be counted twice: callers report
  // the DISTINCT team figure separately and must not show this one.
  total.teachersOfAssignedStudents = 0;
  return total;
}

function groupCoverage(
  rows: Array<{ staffId: string; category: string }>,
  people: Map<string, ProfilePersonDto>,
): OrganizationOverviewDto['responsibilityCoverage'] {
  const map = new Map<string, Array<{ staffId: string; displayName: string }>>();
  for (const r of rows) {
    const p = people.get(r.staffId);
    if (!p) continue;
    const list = map.get(r.category) ?? [];
    list.push({ staffId: p.staffId, displayName: p.displayName });
    map.set(r.category, list);
  }
  return [...map.entries()].map(([category, holders]) => ({ category, holders }));
}

function defaultReason(access: StaffProfileAccess): string {
  switch (access.relation) {
    case 'self':
      return 'self-service profile edit';
    case 'team':
      return 'edited by the staff member\'s manager';
    default:
      return 'edited by the super admin';
  }
}

function optionalReason(raw: unknown): string | null {
  return text(normalizeLine(raw, REASON_MAX), 'reason');
}

function text(verdict: TextVerdict, field: string): string | null {
  if (verdict.ok) return verdict.value;
  const why =
    verdict.problem === 'too_long' ? 'is too long' : verdict.problem === 'required' ? 'is required' : 'must be text';
  throw invalid(`${field} ${why}`);
}

function notFound(): CommError {
  return new CommError(CommErrorCode.STAFF_PROFILE_NOT_FOUND, 'staff profile not found', 404);
}
function invalid(message: string): CommError {
  return new CommError(CommErrorCode.STAFF_PROFILE_INVALID, message, 400);
}
function editDenied(what: string): CommError {
  return new CommError(CommErrorCode.STAFF_PROFILE_EDIT_DENIED, `you may not change the ${what} on this profile`, 403);
}
function avatarInvalid(message: string): CommError {
  return new CommError(CommErrorCode.STAFF_AVATAR_INVALID, message, 400);
}
function assignmentDenied(message: string): CommError {
  return new CommError(CommErrorCode.STAFF_ASSIGNMENT_DENIED, message, 403);
}
function assignmentInvalid(message: string): CommError {
  return new CommError(CommErrorCode.STAFF_ASSIGNMENT_INVALID, message, 409);
}

const AVATAR_REJECTION_MESSAGE: Record<string, string> = {
  empty: 'the uploaded photo is empty',
  too_large_bytes: `a profile photo must be at most ${MAX_AVATAR_BYTES} bytes`,
  unrecognized: 'the uploaded file is not a JPEG, PNG or WebP image',
  type_mismatch: 'the uploaded bytes do not match the declared image type',
  animated: 'animated images are not accepted as a profile photo',
  too_small: 'a profile photo must be at least 64 x 64 pixels',
  too_large_dimensions: 'a profile photo must be at most 4096 x 4096 pixels',
};
