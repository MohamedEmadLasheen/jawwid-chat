import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CommError, CommErrorCode } from './errors';
import type { Actor } from './types';
import { ACADEMY_ZONE, canonicalZone } from './time-zone';

/** What the app shows on Settings -> Date & time. */
export interface TimeZoneSetting {
  /** The IANA zone, or null before the phone has reported one. */
  readonly timeZone: string | null;
  /** True: follows the phone. False: picked by hand. */
  readonly automatic: boolean;
  readonly updatedAt: string | null;
}

const invalid = (why: string) => new CommError(CommErrorCode.VALIDATION, `timeZone: ${why}`, 400);

/**
 * PD-22: each person's time zone (chat.actor_time_zone).
 *
 * The phone is the source, as on a phone: the app reports its OS zone on launch
 * and whenever it returns to the foreground, so travelling updates it with no
 * action. Location is never read. A person may turn "Set automatically" off and
 * pick a zone; device reports are then ignored until they turn it back on.
 *
 * The zone decides how a time is WORDED for that person (push text, quiet
 * hours, Admin Web's "family's local time"). It never moves a lesson: weekly
 * lessons stay anchored in the teacher's zone (PD-11 T2, kept by PD-22).
 */
@Injectable()
export class TimeZoneService {
  constructor(private readonly prisma: PrismaService) {}

  async get(actorId: string): Promise<TimeZoneSetting> {
    const row = await this.prisma.actorTimeZone.findUnique({ where: { actorId } });
    return row
      ? { timeZone: row.timeZone, automatic: row.automatic, updatedAt: row.updatedAt.toISOString() }
      : { timeZone: null, automatic: true, updatedAt: null };
  }

  /**
   * The phone's OS zone, reported by the app. Recorded only while the person's
   * setting is automatic; otherwise the manual choice stands and is returned,
   * so the app adopts it.
   */
  async reportDevice(actor: Actor, raw: unknown): Promise<TimeZoneSetting> {
    const zone = canonicalZone(raw);
    if (!zone) throw invalid('an IANA time zone, e.g. Asia/Kuwait');
    const org = this.organizationOf(actor);
    const current = await this.prisma.actorTimeZone.findUnique({ where: { actorId: actor.actorId } });
    if (current && !current.automatic) return this.get(actor.actorId);
    if (current?.timeZone === zone) return this.get(actor.actorId);
    await this.prisma.actorTimeZone.upsert({
      where: { actorId: actor.actorId },
      create: { actorId: actor.actorId, organizationId: org, timeZone: zone, automatic: true },
      update: { timeZone: zone },
    });
    return this.get(actor.actorId);
  }

  /**
   * The person's own choice. `automatic: true` with the phone's zone turns
   * "Set automatically" back on; `automatic: false` pins `timeZone`.
   */
  async set(actor: Actor, body: { automatic?: unknown; timeZone?: unknown }): Promise<TimeZoneSetting> {
    if (typeof body.automatic !== 'boolean') throw new CommError(CommErrorCode.VALIDATION, 'automatic: must be a boolean', 400);
    const zone = canonicalZone(body.timeZone);
    if (!zone) throw invalid('an IANA time zone, e.g. Asia/Kuwait');
    const org = this.organizationOf(actor);
    await this.prisma.actorTimeZone.upsert({
      where: { actorId: actor.actorId },
      create: { actorId: actor.actorId, organizationId: org, timeZone: zone, automatic: body.automatic },
      update: { timeZone: zone, automatic: body.automatic },
    });
    return this.get(actor.actorId);
  }

  /** Each known person's zone. A person who never opened the app is absent. */
  zonesOf(actorIds: readonly string[]): Promise<Map<string, string>> {
    return zonesOf(this.prisma, actorIds);
  }

  /**
   * A family's local zone: the most recently updated zone of its parents. Two
   * parents in two countries is possible; the one who used the app last wins,
   * which is what "the family's local time" means to the supervisor.
   */
  familyZones(familyIds: readonly string[]): Promise<Map<string, string>> {
    return familyZonesOf(this.prisma, familyIds);
  }

  /** The academy's zone (schedule.timezone), for staff views and text read by many. */
  async academyZone(): Promise<string> {
    const row = await this.prisma.config.findUnique({ where: { key: 'schedule.timezone' } });
    return canonicalZone(row?.value) ?? ACADEMY_ZONE;
  }

  private organizationOf(actor: Actor): string {
    if (!actor.organizationId) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'no organization', 403);
    return actor.organizationId;
  }
}

/** {@link TimeZoneService.zonesOf}, for services constructed without it. */
export async function zonesOf(prisma: PrismaService, actorIds: readonly string[]): Promise<Map<string, string>> {
  if (actorIds.length === 0) return new Map();
  const rows = await prisma.actorTimeZone.findMany({
    where: { actorId: { in: [...new Set(actorIds)] } },
    select: { actorId: true, timeZone: true },
  });
  return new Map(rows.map((r) => [r.actorId, r.timeZone]));
}

/** {@link TimeZoneService.familyZones}, for services constructed without it. */
export async function familyZonesOf(prisma: PrismaService, familyIds: readonly string[]): Promise<Map<string, string>> {
  if (familyIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ family_id: string; time_zone: string }>>`
    SELECT DISTINCT ON (c.family_id) c.family_id::text AS family_id, z.time_zone
      FROM chat.contact c
      JOIN chat.actor_time_zone z ON z.actor_id = c.id
     WHERE c.family_id = ANY(${[...new Set(familyIds)]}::uuid[])
     ORDER BY c.family_id, z.updated_at DESC`;
  return new Map(rows.map((r) => [r.family_id, r.time_zone]));
}
