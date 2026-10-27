import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { Actor } from './types';

/**
 * PD-35: which teachers a member of the Teachers department works on.
 *
 * THE SWITCH. TEACHER_SUPERVISOR_STRICT_SCOPE is read here only, at boot, and
 * written into chat.config ('teacher_supervisor.strict_scope'), because the
 * database decides part of the scope itself (who is the staff side of a
 * teacher's supervision conversation and trial group). Both sides then read that
 * one row -- chat.teacher_scope_strict() -- so they cannot disagree.
 * Only an explicit value is written: a process booted without the variable
 * leaves the row as it is (no last-boot-wins), and a boot that turns the
 * stored value over says so loudly.
 *
 *   off (default)  department-wide, exactly as before PD-35: every member of the
 *                  Teachers department works on every teacher. Assigning
 *                  teachers already works, so the switch can be turned on once
 *                  the assignments are done.
 *   on             a teacher supervisor works on the teachers assigned to them
 *                  (and to a supervisor they back up); the Teachers Manager and
 *                  the super admin on every teacher. Outside that, answered as
 *                  not found.
 *
 * This is the ONLY narrowing: every Teachers-department gate keeps deciding
 * whether the caller is in the department at all (PD-10, PD-12, PD-26), and
 * asks this service which of the teachers are theirs.
 */
export type TeacherScope = { all: true } | { all: false; teacherIds: ReadonlySet<string> };

export const ALL_TEACHERS: TeacherScope = Object.freeze({ all: true });

/** 'true' / '1' / 'yes' / 'on', any case: strict. Anything else, or unset: off. */
export function teacherSupervisorStrictScope(): boolean {
  return ['true', '1', 'yes', 'on'].includes((process.env.TEACHER_SUPERVISOR_STRICT_SCOPE ?? '').trim().toLowerCase());
}

/** Was TEACHER_SUPERVISOR_STRICT_SCOPE given at all (an empty value is not)? */
export function teacherSupervisorStrictScopeSet(): boolean {
  return (process.env.TEACHER_SUPERVISOR_STRICT_SCOPE ?? '').trim() !== '';
}

export function scopeCovers(scope: TeacherScope, teacherId: string | null | undefined): boolean {
  if (scope.all) return true;
  return !!teacherId && scope.teacherIds.has(teacherId);
}

const label = (strict: boolean) => (strict ? 'strict (own teachers)' : 'department-wide');

@Injectable()
export class TeacherScopeService implements OnModuleInit {
  private readonly log = new Logger(TeacherScopeService.name);

  /** This boot turned the stored switch over: the re-seat runs at once (TeacherSupervisorService). */
  changedAtBoot = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes the switch where the database reads it -- only when the variable is
   * given. Unset, the stored value stands (another process, or the owner, set it).
   */
  async onModuleInit(): Promise<void> {
    const stored = await this.strict();
    if (!teacherSupervisorStrictScopeSet()) {
      this.log.log(`teacher supervisor scope: ${label(stored)} (stored; TEACHER_SUPERVISOR_STRICT_SCOPE unset)`);
      return;
    }
    const strict = teacherSupervisorStrictScope();
    await this.prisma.$executeRaw`
      INSERT INTO chat.config (key, value, scope, description)
      VALUES ('teacher_supervisor.strict_scope', ${JSON.stringify(strict)}::jsonb, 'teachers',
              'PD-35: written at boot from TEACHER_SUPERVISOR_STRICT_SCOPE.')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    if (strict !== stored) {
      this.changedAtBoot = true;
      this.log.warn(`teacher supervisor scope CHANGED at boot: ${label(stored)} -> ${label(strict)} (TEACHER_SUPERVISOR_STRICT_SCOPE)`);
    } else {
      this.log.log(`teacher supervisor scope: ${label(strict)}`);
    }
  }

  /** The switch, as the database reads it. */
  async strict(): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ strict: boolean }>>`SELECT chat.teacher_scope_strict() AS strict`;
    return row?.strict === true;
  }

  /**
   * The teachers `actor` works on. Callers have already decided the actor is
   * in the Teachers department (or is the super admin); this only narrows.
   * Anyone else gets no teacher at all.
   */
  async scopeOf(actor: Actor, at: Date = new Date()): Promise<TeacherScope> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return { all: false, teacherIds: new Set() };
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return ALL_TEACHERS;
    if (!(await this.strict())) return ALL_TEACHERS;
    const [{ manager }] = await this.prisma.$queryRaw<Array<{ manager: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM chat.department d
                      WHERE d.kind = 'teachers' AND d.manager_id = ${actor.actorId}::uuid) AS manager`;
    if (manager && actor.staffRole === StaffRole.MANAGER) return ALL_TEACHERS;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.staff_supervised_teacher_ids(${actor.actorId}::uuid, ${at}::timestamptz) AS id`;
    return { all: false, teacherIds: new Set(rows.map((r) => r.id)) };
  }

  /** Is this one teacher in the actor's scope (see scopeOf)? */
  async covers(actor: Actor, teacherId: string | null | undefined): Promise<boolean> {
    return scopeCovers(await this.scopeOf(actor), teacherId);
  }

  // ------------------------------------------------------------------
  // PD-26 amendment (owner 2026-10-27): the Teacher Supervision page's bases
  // ------------------------------------------------------------------

  /**
   * Who works the Teacher Supervision page, and on what basis: the super admin;
   * the Teachers department (as before, narrowed by the PD-35 switch); or an
   * Operations supervisor, for the teachers of their own families. Anyone else:
   * null. Teachers comes first: someone in both keeps the Teachers basis.
   */
  async pageBasis(actor: Actor): Promise<PageBasis | null> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return null;
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return 'super_admin';
    const [row] = await this.prisma.$queryRaw<Array<{ teachers: string | null; operations: string | null }>>`
      SELECT chat.teachers_department_role(${actor.actorId}::uuid) AS teachers,
             (SELECT CASE WHEN EXISTS (SELECT 1 FROM chat.department d
                                        WHERE d.kind = 'operations' AND d.manager_id = ${actor.actorId}::uuid) THEN 'manager'
                          WHEN EXISTS (SELECT 1 FROM chat.department_member m
                                         JOIN chat.department d ON d.id = m.department_id
                                        WHERE d.kind = 'operations' AND m.staff_id = ${actor.actorId}::uuid) THEN 'member'
                     END) AS operations`;
    return decidePageBasis(actor, asDepartmentRole(row?.teachers), asDepartmentRole(row?.operations));
  }

  /**
   * The teachers an Operations supervisor works on: chat.operations_teacher_ids,
   * the database's own rule (the PD-26 guards read the same function), so the
   * page and the backstop cannot disagree. Never department-wide, whatever the
   * PD-35 switch says.
   */
  async operationsScopeOf(actor: Actor, at: Date = new Date()): Promise<TeacherScope> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return { all: false, teacherIds: new Set() };
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.operations_teacher_ids(${actor.actorId}::uuid, ${at}::timestamptz) AS id`;
    return { all: false, teacherIds: new Set(rows.map((r) => r.id)) };
  }

  /** The teachers this caller works on, on the Teacher Supervision page. None without a basis. */
  async pageScopeOf(actor: Actor, at: Date = new Date()): Promise<TeacherScope> {
    const basis = await this.pageBasis(actor);
    if (basis === 'operations') return this.operationsScopeOf(actor, at);
    if (basis === null) return { all: false, teacherIds: new Set() };
    return this.scopeOf(actor, at);
  }

  async pageCovers(actor: Actor, teacherId: string | null | undefined): Promise<boolean> {
    return scopeCovers(await this.pageScopeOf(actor), teacherId);
  }
}

export type PageBasis = 'super_admin' | 'teachers' | 'operations';
type DepartmentRole = 'manager' | 'member' | null;

function asDepartmentRole(raw: string | null | undefined): DepartmentRole {
  return raw === 'manager' || raw === 'member' ? raw : null;
}

/**
 * PD-26 amendment, the pure part: the role is re-checked against the department
 * relation, as PD-12 does (a manager row counts for role manager; a member row
 * for admin or coverage), so a stale row grants nothing.
 */
export function decidePageBasis(actor: Actor, teachers: DepartmentRole, operations: DepartmentRole): PageBasis | null {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return null;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return 'super_admin';
  const fits = (role: DepartmentRole) =>
    (role === 'manager' && actor.staffRole === StaffRole.MANAGER) ||
    (role === 'member' && (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE));
  if (fits(teachers)) return 'teachers';
  if (fits(operations)) return 'operations';
  return null;
}
