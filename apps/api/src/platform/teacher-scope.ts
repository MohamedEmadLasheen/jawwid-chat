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
}
