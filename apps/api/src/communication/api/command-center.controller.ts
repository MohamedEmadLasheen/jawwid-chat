import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { CommandCenterService } from '../command-center/command-center.service';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from './http-exception.filter';

/**
 * The Manager Command Center.
 *
 * Three reads, and every one of them is authorized inside
 * CommandCenterService -- which matters more here than usual, because the SQL
 * behind these routes is SECURITY DEFINER. It has to be: the figures are
 * organization-wide by definition and the connection is under RLS, so an
 * invoker-rights function would silently narrow every total to whatever the
 * connection could read. That makes the service the boundary, and it checks
 * for an organization-wide role plus `conversations.read` before it calls.
 */
@Controller('command-center')
@UseFilters(CommErrorFilter)
export class CommandCenterController {
  constructor(private readonly commandCenter: CommandCenterService) {}

  /**
   * The header: eight KPIs plus the two figures that make them legible --
   * the window the call counts cover, and when they were computed.
   *
   * The overloaded-supervisor count is served from the supervisor query rather
   * than duplicated here, so the tile and the table can never disagree.
   */
  @Get('kpis')
  async kpis(@ActorId() actorId: string) {
    const [kpis, overloadedSupervisors, thresholds] = await Promise.all([
      this.commandCenter.kpis(actorId),
      this.commandCenter.overloadedCount(actorId),
      this.commandCenter.thresholds(),
    ]);
    return { kpis: { ...kpis, overloadedSupervisors }, thresholds };
  }

  /** One row per supervisor, worst first, each carrying why it says what it says. */
  @Get('supervisors')
  async supervisors(@ActorId() actorId: string) {
    const [supervisors, thresholds] = await Promise.all([
      this.commandCenter.supervisors(actorId),
      this.commandCenter.thresholds(),
    ]);
    return { supervisors, thresholds };
  }

  /**
   * THE DRILL-DOWN: the actual conversations behind the unanswered number,
   * longest wait first, optionally narrowed to one supervisor.
   *
   * This is what stops the tiles above being vanity metrics.
   */
  @Get('attention')
  async attention(
    @ActorId() actorId: string,
    @Query('staffId') staffId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number(limit);
    const items = await this.commandCenter.attention(
      actorId,
      staffId,
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50,
    );
    return { items };
  }
}
