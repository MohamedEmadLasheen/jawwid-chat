import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PLATFORM SEAM - AI #1 OWNS THIS.
 *
 * Brief section 4 defines on_duty(family, now) over shift / coverage_rule /
 * absence tables. Those tables are AI #1's; this engine does not create them and
 * does not reimplement the algorithm.
 *
 * Brief section 12 non-negotiable: "No code path assigns a message/family to a
 * staff member other than via on_duty() (+ stickiness, assist, escalation - all
 * logged with reason)." The communication engine honours that by never choosing
 * a handler itself: it calls onDuty() and applies thread stickiness on top.
 *
 * Returning null is meaningful: it means Unattended (never silently assigned).
 */
export interface CoverageService {
  onDuty(familyId: string, at: Date): Promise<string | null>;
}

/**
 * Reference implementation ONLY, so the communication engine is runnable and
 * testable before AI #1 lands the coverage engine.
 *
 * It resolves to the family's permanent Primary Owner when that owner is active,
 * and null otherwise. It deliberately implements NO shift, coverage-rule or
 * absence logic - inventing that here would duplicate AI #1's domain and would
 * silently diverge from the brief.
 */
@Injectable()
export class ReferenceCoverageService implements CoverageService {
  constructor(private readonly prisma: PrismaService) {}

  async onDuty(familyId: string, _at: Date): Promise<string | null> {
    const family = await this.prisma.family.findUnique({
      where: { id: familyId },
      include: { owner: true },
    });
    if (!family || !family.owner.isActive) return null;
    return family.owner.id;
  }
}
