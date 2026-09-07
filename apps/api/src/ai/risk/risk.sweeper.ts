import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { AttentionService } from './attention.service';

/**
 * The periodic risk sweep, run by the worker.
 *
 * ## Why a sweep rather than an event on every message
 *
 * Classifying on every inbound message would classify the same conversation
 * five times during one burst of typing, and the risk being detected -- a
 * pattern of frustration, a hint about leaving -- is not a property of a single
 * message. A sweep sees a settled conversation once.
 *
 * ## Why it is safe to run on several replicas
 *
 * It claims nothing and leases nothing, because it needs neither: the only
 * write is an attention flag, and the partial unique index makes a duplicate
 * raise impossible rather than unlikely. Two replicas sweeping the same
 * conversation cost one wasted classification and produce one flag. That is a
 * better trade than a lease, which would add a failure mode (a crashed holder
 * blocking a conversation until its claim expires) to buy a saving that does
 * not matter at this cadence.
 */
@Injectable()
export class RiskSweeper {
  private readonly log = new Logger(RiskSweeper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attention: AttentionService,
    private readonly config: AppConfigService,
  ) {}

  /** Returns how many flags were raised. */
  async sweep(now = new Date()): Promise<number> {
    const batch = Number(await this.config.get('attention.sweep_batch'));
    const warnHours = Number(await this.config.get('attention.unanswered_hours'));

    // The candidate filter is deterministic and cheap, and it is what keeps the
    // classifier off conversations that do not need it: a thread whose last
    // word came from staff is being handled, and the assistant has no business
    // spending a request on it.
    const candidates = await this.prisma.conversation.findMany({
      where: {
        lastCustomerMessageAt: { not: null },
        OR: [
          { lastStaffMessageAt: null },
          { lastStaffMessageAt: { lt: this.prisma.conversation.fields.lastCustomerMessageAt } },
        ],
      },
      select: { id: true },
      orderBy: { lastActivityAt: 'asc' },
      take: Math.max(1, batch),
    });

    let raised = 0;
    for (const c of candidates) {
      try {
        raised += (await this.attention.assess(c.id, now)).length;
      } catch (error) {
        // One bad conversation must not stop the sweep. The same reasoning the
        // outbox drain uses: a worker that dies on one row stops serving every
        // other row.
        this.log.error(
          `assessment failed for ${c.id}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
    if (raised > 0) this.log.log(`risk sweep raised ${raised} attention flag(s)`);
    return raised;
  }
}
