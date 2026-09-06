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

@Injectable()
export class SqlCoverageService implements CoverageService {
  constructor(private readonly prisma: PrismaService) {}

  async onDuty(familyId: string, at: Date): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ on_duty: string | null }>>`
      SELECT chat.on_duty(${familyId}::uuid, ${at}::timestamptz) AS on_duty
    `;
    return rows[0]?.on_duty ?? null;
  }
}
