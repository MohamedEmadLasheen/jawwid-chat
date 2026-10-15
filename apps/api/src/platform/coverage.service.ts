import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PLATFORM SEAM - AI #1 OWNS THIS.
 *
 * The coverage engine is AI #1's chat.on_duty(family, at) SQL function. This
 * class is a thin call-through; the algorithm (shifts, coverage rules,
 * absences, backups) is NOT reimplemented here.
 *
 * A null result means Unattended - never a silent assignment.
 */
export interface CoverageService {
  onDuty(familyId: string, at: Date): Promise<string | null>;
}

/**
 * The coverage engine that can also LIST: what ConversationService needs (C2).
 * AuthorizationService asks only onDuty() and keeps depending on the narrower
 * CoverageService above.
 */
export interface CoverageListing extends CoverageService {
  /**
   * The families of ONE organization whose on-duty staff member, at `at`, is
   * `staffId` -- exactly { f in organization : onDuty(f, at) = staffId }. The
   * list form of onDuty, for ConversationService.listForActor: the same engine,
   * asked once per family of the organization, never a second algorithm.
   * Bounded to `organizationId` because chat.on_duty() itself is not (an open
   * finding): a family of another organization is never returned.
   */
  familiesOnDutyFor(staffId: string, organizationId: string, at: Date): Promise<string[]>;
}

/** The engine bound to COVERAGE_SERVICE in PlatformModule. */
@Injectable()
export class SqlCoverageService implements CoverageListing {
  constructor(private readonly prisma: PrismaService) {}

  async onDuty(familyId: string, at: Date): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ on_duty: string | null }>>`
      SELECT chat.on_duty(${familyId}::uuid, ${at}::timestamptz) AS on_duty
    `;
    return rows[0]?.on_duty ?? null;
  }

  async familiesOnDutyFor(staffId: string, organizationId: string, at: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT f.id::text AS id
        FROM chat.family f
       WHERE f.organization_id = ${organizationId}::uuid
         AND chat.on_duty(f.id, ${at}::timestamptz) = ${staffId}::uuid
    `;
    return rows.map((r) => r.id);
  }
}
