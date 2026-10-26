import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService, type ShiftDefault } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { StaffRole } from '../communication/contracts/vocab';
import { LessonService } from '../lessons/lesson.service';
import { SchedulingService } from '../lessons/scheduling.service';
import { CalendarService } from './calendar.service';
import { clockField, dayField, SHIFT_CATEGORIES, type Category } from './calendar-filters';
import { isPaletteKey } from './palette';

type WorkCategory = Exclude<Category, 'unset'>;
const WORK_CATEGORIES: readonly WorkCategory[] = ['full_shift', 'part_shift', 'hourly'];

interface Window {
  weekday: number;
  start: number;
  end: number;
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}
function conflict(reason: string) {
  return new CommError(CommErrorCode.LESSON_STATE, reason, 409);
}
function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Validate shift windows: a weekday each, end after start, no two overlapping on one day. */
export function parseWindows(raw: unknown): Window[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 28) throw invalid('windows: 1 to 28 windows');
  const windows = raw.map((w, i) => {
    if (typeof w !== 'object' || w === null) throw invalid(`windows[${i}]: an object`);
    const o = w as Record<string, unknown>;
    if (typeof o.weekday !== 'number' || !Number.isInteger(o.weekday) || o.weekday < 1 || o.weekday > 7) {
      throw invalid(`windows[${i}].weekday: 1 (Monday) to 7 (Sunday)`);
    }
    const start = clockField(typeof o.start === 'string' ? o.start : '', `windows[${i}].start`) as number;
    const end = clockField(typeof o.end === 'string' ? o.end : '', `windows[${i}].end`, true) as number;
    if (end <= start) throw invalid(`windows[${i}]: end must be after start`);
    return { weekday: o.weekday, start, end };
  });
  for (const a of windows) {
    for (const b of windows) {
      if (a !== b && a.weekday === b.weekday && a.start < b.end && b.start < a.end) {
        throw invalid('windows: two windows overlap on the same day');
      }
    }
  }
  return windows;
}

/** A category's default shift (chat.config, else the code default) as windows. */
export function defaultWindows(d: ShiftDefault): Window[] {
  return parseWindows(d.weekdays.map((weekday) => ({ weekday, start: d.start, end: d.end })));
}

/**
 * PD-38: a teacher's work pattern (category + shift windows, effective-dated)
 * and an Operations supervisor's calendar color. The Teachers Manager and the
 * super admin set patterns; the Operations Manager and the super admin set
 * colors. Every change is audited in its own transaction.
 */
@Injectable()
export class WorkPatternService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
    private readonly calendar: CalendarService,
    private readonly config: AppConfigService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async pattern(actorId: string, teacherId: string) {
    const { actor, scope } = await this.calendar.requireScope(actorId);
    const teacher = await this.orgTeacher(actor, teacherId);
    if (scope.kind === 'teachers' && !scope.teacherIds.has(teacher.id)) {
      throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    }
    // A change's free-text reason is the Teachers department's (and the super
    // admin's); Operations reads the shift itself, not why it changed.
    const readsReasons = actor.staffRole === StaffRole.SUPER_ADMIN || (await this.lessons.isManager(actor));
    const [patterns, full, part] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        id: string; category: string; timezone: string; valid_from: string; valid_to: string | null;
        reason: string | null; created_at: Date; windows: Array<{ weekday: number; start: number; end: number }>;
      }>>`
        SELECT p.id::text AS id, p.category, p.timezone, to_char(p.valid_from, 'YYYY-MM-DD') AS valid_from,
               to_char(p.valid_to, 'YYYY-MM-DD') AS valid_to, p.reason, p.created_at,
               coalesce((SELECT jsonb_agg(jsonb_build_object('weekday', w.weekday, 'start', w.start_minute, 'end', w.end_minute)
                                          ORDER BY w.weekday, w.start_minute)
                           FROM chat.teacher_work_window w WHERE w.pattern_id = p.id), '[]'::jsonb) AS windows
          FROM chat.teacher_work_pattern p
         WHERE p.teacher_id = ${teacher.id}::uuid
           -- a pattern replaced before it began covers nothing
           AND (p.valid_to IS NULL OR p.valid_to > p.valid_from)
         ORDER BY p.valid_from DESC
         LIMIT 24`,
      this.config.get('schedule.shift.full_shift'),
      this.config.get('schedule.shift.part_shift'),
    ]);
    const dto = (p: (typeof patterns)[number]) => ({
      id: p.id,
      category: p.category,
      timezone: p.timezone,
      validFrom: p.valid_from,
      validTo: p.valid_to,
      reason: readsReasons ? p.reason : null,
      createdAt: p.created_at.toISOString(),
      windows: p.windows.map((w) => ({ weekday: w.weekday, start: hhmm(w.start), end: hhmm(w.end) })),
    });
    return {
      teacherId: teacher.id,
      // The first day a change may start: today on the academy's calendar.
      today: await this.academyToday(),
      patterns: patterns.map(dto),
      defaults: { full_shift: full, part_shift: part },
    };
  }

  /**
   * A new pattern from `validFrom`, today or later (academy calendar): a past
   * month keeps the shift it was worked under. It closes the pattern in force
   * on that day (one that began the same day is replaced: it covers nothing).
   * A change may not start before the latest pattern began -- that would
   * rewrite a later decision.
   *
   * For a shift starting TODAY, `applyToAvailability` (default on) also makes
   * the shift the teacher's bookable hours, in the same transaction, so the
   * pickers offer the same times. Bookable hours change at once, so a future
   * shift cannot carry them; they are set on its first day. The replaced
   * availability is archived (20261026210000), so past months keep their hours.
   */
  async setPattern(actorId: string, teacherId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireShiftEditor(actor);
    const teacher = await this.orgTeacher(actor, teacherId);

    const category = body.category;
    if (typeof category !== 'string' || !(WORK_CATEGORIES as readonly string[]).includes(category)) {
      throw invalid(`category: ${WORK_CATEGORIES.join(', ')}`);
    }
    const isShift = (SHIFT_CATEGORIES as readonly string[]).includes(category);
    const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : '';
    if (timezone.length === 0 || timezone.length > 64) throw invalid('timezone: an IANA time zone, e.g. Africa/Cairo');
    const zoned = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.is_time_zone(${timezone}) AS ok`;
    if (!zoned[0]?.ok) throw invalid('timezone: an IANA time zone, e.g. Africa/Cairo');
    const validFrom = dayField(typeof body.validFrom === 'string' ? body.validFrom : undefined, 'validFrom');
    const today = await this.academyToday();
    if (validFrom < today) throw invalid(`validFrom: today (${today}) or later -- a past month keeps the shift it was worked under`);
    let reason: string | null = null;
    if (body.reason !== undefined && body.reason !== null) {
      if (typeof body.reason !== 'string' || body.reason.trim().length === 0 || body.reason.trim().length > 500) {
        throw invalid('reason: 1 to 500 characters');
      }
      reason = body.reason.trim();
    }
    let windows: Window[] = [];
    if (isShift) {
      windows = body.windows === undefined || body.windows === null
        ? defaultWindows(await this.config.get(`schedule.shift.${category as 'full_shift' | 'part_shift'}`))
        : parseWindows(body.windows);
    } else if (body.windows !== undefined && body.windows !== null && !(Array.isArray(body.windows) && body.windows.length === 0)) {
      throw invalid('windows: an hourly teacher\'s working hours are their availability');
    }
    if (body.applyToAvailability !== undefined && typeof body.applyToAvailability !== 'boolean') {
      throw invalid('applyToAvailability: true or false');
    }
    if (body.applyToAvailability === true && (!isShift || validFrom !== today)) {
      throw invalid('applyToAvailability: only for a shift starting today -- bookable hours change at once; set them on the shift\'s first day');
    }
    const applyToAvailability = isShift && validFrom === today && body.applyToAvailability !== false;

    const latest = await this.prisma.$queryRaw<Array<{ valid_from: string; valid_to: string | null }>>`
      SELECT to_char(valid_from, 'YYYY-MM-DD') AS valid_from, to_char(valid_to, 'YYYY-MM-DD') AS valid_to
        FROM chat.teacher_work_pattern WHERE teacher_id = ${teacher.id}::uuid
       ORDER BY valid_from DESC, created_at DESC LIMIT 1`;
    if (latest[0] && validFrom < latest[0].valid_from) {
      throw conflict(`a pattern begins on ${latest[0].valid_from}; a change can begin on or after that day`);
    }

    // PD-11 refuses bookable hours in a zone the teacher's weekly lessons do
    // not share: checked before anything is written.
    const availability = applyToAvailability
      ? await this.scheduling.checkAvailability(teacher.id, {
          timezone,
          windows: windows.map((w) => ({ weekday: w.weekday, start: hhmm(w.start), end: w.end === 1440 ? '24:00' : hhmm(w.end) })),
        })
      : null;

    // ONE transaction: the shift and its bookable hours commit together or not at all.
    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        // Serialize changes to one teacher's patterns.
        await tx.$executeRaw`SELECT 1 FROM chat.teacher WHERE id = ${teacher.id}::uuid FOR UPDATE`;
        const open = await tx.$queryRaw<Array<{ id: string; valid_from: string }>>`
          SELECT id::text AS id, to_char(valid_from, 'YYYY-MM-DD') AS valid_from
            FROM chat.teacher_work_pattern WHERE teacher_id = ${teacher.id}::uuid AND valid_to IS NULL`;
        for (const p of open) {
          if (validFrom < p.valid_from) throw conflict(`a pattern begins on ${p.valid_from}; a change can begin on or after that day`);
          await tx.$executeRaw`UPDATE chat.teacher_work_pattern SET valid_to = ${validFrom}::date WHERE id = ${p.id}::uuid`;
        }
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO chat.teacher_work_pattern (organization_id, teacher_id, category, timezone, valid_from, reason, created_by)
          VALUES (${teacher.organizationId}::uuid, ${teacher.id}::uuid, ${category}, ${timezone}, ${validFrom}::date,
                  ${reason}, ${actor.actorId}::uuid)
          RETURNING id::text AS id`;
        const patternId = inserted[0].id;
        for (const w of windows) {
          await tx.$executeRaw`
            INSERT INTO chat.teacher_work_window (organization_id, pattern_id, weekday, start_minute, end_minute)
            VALUES (${teacher.organizationId}::uuid, ${patternId}::uuid, ${w.weekday}::smallint, ${w.start}::int, ${w.end}::int)`;
        }
        if (availability) {
          await this.scheduling.writeAvailability(tx, actor.actorId, teacher, availability, 'bookable hours follow the shift (PD-38)');
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'teacher.work_pattern_set',
          entity: 'teacher',
          entityId: teacher.id,
          after: { patternId, category, timezone, validFrom, windows, applyToAvailability },
          reason: reason ?? 'work pattern set',
        });
      }),
    );
    return this.pattern(actorId, teacher.id);
  }

  /** An Operations supervisor's (or the Operations Manager's) calendar color; null clears it. */
  async setColor(actorId: string, staffId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const allowed = actor.staffRole === StaffRole.SUPER_ADMIN || (await this.calendar.managesDepartment(actor, 'operations'));
    if (!allowed) throw new CommError(CommErrorCode.LESSON_DENIED, 'supervisor colors are the Operations Manager\'s');
    const org = actor.organizationId as string;
    if (!isUuid(staffId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'supervisor not found');
    const target = (await this.calendar.supervisors(org)).find((s) => s.id === staffId);
    if (!target) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'supervisor not found');
    const colorKey = body.colorKey;
    if (colorKey !== null && !isPaletteKey(colorKey)) throw invalid('colorKey: a palette key, or null');

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        if (colorKey === null) {
          await tx.$executeRaw`DELETE FROM chat.staff_calendar_color WHERE staff_id = ${staffId}::uuid`;
        } else {
          await tx.$executeRaw`
            INSERT INTO chat.staff_calendar_color (staff_id, organization_id, color_key, set_by)
            VALUES (${staffId}::uuid, ${org}::uuid, ${colorKey}, ${actor.actorId}::uuid)
            ON CONFLICT (staff_id) DO UPDATE SET color_key = excluded.color_key, set_by = excluded.set_by, set_at = now()`;
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'staff.calendar_color_set',
          entity: 'staff',
          entityId: staffId,
          before: { colorKey: target.colorKey },
          after: { colorKey },
          reason: 'calendar color',
        });
      }),
    );
    return (await this.calendar.supervisors(org)).find((s) => s.id === staffId);
  }

  private async academyToday(): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ d: string }>>`
      SELECT to_char((now() AT TIME ZONE ${await this.calendar.zone()})::date, 'YYYY-MM-DD') AS d`;
    return rows[0]!.d;
  }

  private async requireShiftEditor(actor: Actor) {
    const allowed = actor.staffRole === StaffRole.SUPER_ADMIN || (await this.calendar.managesDepartment(actor, 'teachers'));
    if (!allowed || !actor.isActive) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'shifts are set by the Teachers Manager');
    }
  }

  private async orgTeacher(actor: Actor, teacherId: string) {
    if (!isUuid(teacherId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    const teacher = await this.prisma.teacher.findFirst({
      where: { id: teacherId, organizationId: actor.organizationId },
      select: { id: true, organizationId: true },
    });
    if (!teacher) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'teacher not found');
    return teacher;
  }
}
