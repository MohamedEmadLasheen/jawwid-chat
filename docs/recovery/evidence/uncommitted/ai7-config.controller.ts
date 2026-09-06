import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CurrentActor } from '../communication/api/actor.decorator';
import type { Actor } from './types';
import { ActorKind } from '../communication/contracts/vocab';

/**
 * GET /config — every operational constant, read from chat.config.
 *
 * PRD §4 and §12: every threshold, weight and window is a config default, not a
 * constant. The admin panel must therefore render bucket labels, SLA windows
 * and workload thresholds from the server. A client that hardcodes one of these
 * numbers is wrong the moment a manager changes it.
 *
 * Implemented here because it is the smallest endpoint the PRD unambiguously
 * requires that Admin Web cannot work without, and it needs no new domain
 * logic -- chat.config already exists and is already populated by migration.
 * The rest of the admin surface (inbox, families, dashboard, tasks, coverage,
 * staff) is specified in docs/infrastructure/api-contract-reconciliation.md and
 * is AI #1's to build; it is deliberately NOT stubbed here.
 */
@Controller('config')
export class ConfigController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async all(@CurrentActor() actor: Actor) {
    // Staff-only. These values describe how the operation is run -- coverage
    // windows, workload thresholds, approval policy. A parent or teacher has no
    // reason to read them and some of them are commercially sensitive.
    if (actor.kind !== ActorKind.STAFF) {
      throw new ForbiddenException({
        error: { code: 'AUTH.FORBIDDEN', message: 'staff only' },
      });
    }

    // Only key and value: the Prisma model does not expose scope or description.
    const rows = await this.prisma.config.findMany({
      select: { key: true, value: true },
      orderBy: { key: 'asc' },
    });

    // Returned as a map rather than a list: every caller wants config['x'].
    const values: Record<string, unknown> = {};
    for (const row of rows) values[row.key] = row.value;

    return { config: values, count: rows.length };
  }
}
