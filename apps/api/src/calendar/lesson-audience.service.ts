import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { IDENTITY_SERVICE } from '../platform/tokens';
import type { IdentityService } from '../platform/identity.service';
import { OutboxWorker, type LessonAudience } from '../communication/outbox/outbox.worker';
import { CalendarService, type CalendarScope } from './calendar.service';

/** How long a staff member's resolved scope is reused across signals. */
const SCOPE_TTL_MS = 10_000;

/**
 * PD-46 §3.3: who besides the teacher hears that a lesson changed -- the staff
 * whose calendar scope (CalendarService.scopeOf: PD-8 own learners, PD-35
 * named teachers, academy-wide roles) covers it. Decided AT DELIVERY, so a
 * scope that changed since the lesson did is respected. Registered with the
 * outbox worker at start (CalendarModule already depends on Communication, so
 * the worker cannot inject this without a module cycle).
 */
@Injectable()
export class LessonAudienceService implements LessonAudience, OnModuleInit {
  private readonly scopes = new Map<string, { scope: CalendarScope | null; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly worker: OutboxWorker,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
  ) {}

  onModuleInit(): void {
    this.worker.useLessonAudience(this);
  }

  /** The active staff of `organizationId` whose scope covers any of these lessons. */
  async staffFor(organizationId: string, lessons: ReadonlyArray<{ teacherId: string; learnerId: string | null }>): Promise<string[]> {
    // Active staff only. Whether each one's login is live is decided per socket
    // at delivery (RT-009): an actor room with nobody in it costs nothing.
    const staff = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id::text AS id
        FROM chat.staff s
       WHERE s.organization_id = ${organizationId}::uuid
         AND s.is_active AND s.left_at IS NULL`;
    const readers: string[] = [];
    for (const { id } of staff) {
      const scope = await this.scopeOf(id);
      if (scope && lessons.some((l) => covers(scope, l))) readers.push(id);
    }
    return readers;
  }

  private async scopeOf(staffId: string): Promise<CalendarScope | null> {
    const hit = this.scopes.get(staffId);
    if (hit && Date.now() - hit.at < SCOPE_TTL_MS) return hit.scope;
    const actor = await this.identity.resolveActor(staffId);
    const scope = actor ? await this.calendar.scopeOf(actor) : null;
    this.scopes.set(staffId, { scope, at: Date.now() });
    return scope;
  }
}

/** Whether a calendar scope shows this lesson -- the same bases CalendarService filters by. */
export function covers(scope: CalendarScope, lesson: { teacherId: string; learnerId: string | null }): boolean {
  if (scope.kind === 'academy') return true;
  if (scope.kind === 'teachers') return scope.teacherIds.has(lesson.teacherId);
  return scope.namedTeachers.has(lesson.teacherId) || (lesson.learnerId !== null && scope.ownLearners.has(lesson.learnerId));
}
