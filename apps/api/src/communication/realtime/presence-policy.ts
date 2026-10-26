import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import type { Actor } from '../../platform/types';
import { ActorKind, StaffRole } from '../contracts/vocab';

/** Whether one viewer may see one person's presence, and their last seen. */
export interface PresenceGrant {
  lastSeen: boolean;
}

/** Who may see one person's presence, split by whether they may see last seen. */
export interface PresenceAudience {
  withLastSeen: string[];
  withoutLastSeen: string[];
}

/**
 * PD-37: who sees whose online / last seen (head decisions, 2026-10-26).
 *
 *   staff -> staff     yes, inside one organization (online always; last seen
 *                      unless either side hides it -- WhatsApp's reciprocity).
 *   staff -> teacher   the super admin and the Teachers department (manager or
 *                      member). PD-35's strict teacher scope narrows this once
 *                      it is on main (TeacherScopeService.covers); until then
 *                      the department-wide rule PD-35 itself defaults to.
 *   anyone else        nothing. Families and teachers see nobody's presence;
 *                      nobody sees a family's. A teacher does not see staff.
 *
 * Inactive people, on either side, see and are seen by nobody. One rule
 * function answers both directions (who may see S; whom may V see), so the
 * announcement and the read can never disagree.
 */
@Injectable()
export class PresencePolicy {
  constructor(private readonly prisma: PrismaService) {}

  /** The people who may see `subject`'s presence (the subject is never included). */
  async audienceOf(subject: Actor): Promise<PresenceAudience> {
    const none: PresenceAudience = { withLastSeen: [], withoutLastSeen: [] };
    if (!subject.isActive || !subject.organizationId) return none;

    if (subject.kind === ActorKind.STAFF) {
      const [me] = await this.prisma.$queryRaw<Array<{ hide: boolean }>>`
        SELECT hide_last_seen AS hide FROM chat.staff WHERE id = ${subject.actorId}::uuid`;
      const viewers = await this.prisma.$queryRaw<Array<{ id: string; hide: boolean }>>`
        SELECT id::text AS id, hide_last_seen AS hide
          FROM chat.staff
         WHERE organization_id = ${subject.organizationId}::uuid
           AND is_active AND left_at IS NULL
           AND id <> ${subject.actorId}::uuid`;
      return split(viewers, (v) => !me?.hide && !v.hide);
    }

    if (subject.kind === ActorKind.TEACHER) {
      const viewers = await this.prisma.$queryRaw<Array<{ id: string; hide: boolean }>>`
        SELECT s.id::text AS id, s.hide_last_seen AS hide
          FROM chat.staff s
         WHERE s.organization_id = ${subject.organizationId}::uuid
           AND s.is_active AND s.left_at IS NULL
           AND (s.role = ${StaffRole.SUPER_ADMIN} OR ${teachersDepartmentSql('s.id', subject.organizationId)})`;
      return split(viewers, (v) => !v.hide);
    }

    return none;
  }

  /**
   * Of these people, the ones `viewer` may see, with whether last seen shows.
   * Anyone absent from the answer is not to be shown at all -- not even as
   * "offline", which would itself say something.
   */
  async visibleTo(
    viewer: Actor,
    subjects: { staffIds: readonly string[]; teacherIds: readonly string[] },
  ): Promise<Map<string, PresenceGrant>> {
    const out = new Map<string, PresenceGrant>();
    if (viewer.kind !== ActorKind.STAFF || !viewer.isActive || !viewer.organizationId) return out;
    const org = viewer.organizationId;

    const [me] = await this.prisma.$queryRaw<Array<{ hide: boolean; teachers: boolean }>>`
      SELECT s.hide_last_seen AS hide,
             (s.role = ${StaffRole.SUPER_ADMIN} OR ${teachersDepartmentSql('s.id', org)}) AS teachers
        FROM chat.staff s
       WHERE s.id = ${viewer.actorId}::uuid AND s.is_active AND s.left_at IS NULL`;
    if (!me) return out;

    if (subjects.staffIds.length > 0) {
      const staff = await this.prisma.$queryRaw<Array<{ id: string; hide: boolean }>>`
        SELECT id::text AS id, hide_last_seen AS hide
          FROM chat.staff
         WHERE id = ANY(${[...subjects.staffIds]}::uuid[])
           AND organization_id = ${org}::uuid AND is_active AND left_at IS NULL`;
      for (const s of staff) out.set(s.id, { lastSeen: s.id === viewer.actorId || (!me.hide && !s.hide) });
    }

    if (subjects.teacherIds.length > 0 && me.teachers) {
      const teachers = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
          FROM chat.teacher
         WHERE id = ANY(${[...subjects.teacherIds]}::uuid[])
           AND organization_id = ${org}::uuid AND is_active AND left_at IS NULL`;
      for (const t of teachers) out.set(t.id, { lastSeen: !me.hide });
    }
    return out;
  }
}

function split<T extends { id: string }>(rows: T[], lastSeen: (row: T) => boolean): PresenceAudience {
  const out: PresenceAudience = { withLastSeen: [], withoutLastSeen: [] };
  for (const r of rows) (lastSeen(r) ? out.withLastSeen : out.withoutLastSeen).push(r.id);
  return out;
}

/**
 * The staff member manages or belongs to the organization's Teachers
 * department -- the same test as LessonService.inDepartment(actor, 'teachers').
 */
function teachersDepartmentSql(staffIdColumn: 's.id', organizationId: string) {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM chat.department d
     WHERE d.organization_id = ${organizationId}::uuid AND d.kind = 'teachers'
       AND (d.manager_id = ${Prisma.raw(staffIdColumn)}
            OR EXISTS (SELECT 1 FROM chat.department_member m
                        WHERE m.department_id = d.id AND m.staff_id = ${Prisma.raw(staffIdColumn)})))`;
}
