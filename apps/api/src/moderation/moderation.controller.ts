import { Body, Controller, createParamDecorator, ExecutionContext, Get, Headers, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires } from '../platform/permissions/route-access';
import { parseIdempotencyKey } from './dto';
import { ModerationService } from './moderation.service';

/** The caller's own account id (AuthenticatedGuard writes it), for a suspension's `deactivated_by`. */
const CallerAccountId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => ctx.switchToHttp().getRequest<{ accountId?: string }>().accountId,
);

/**
 * PD-57 WP-1 (roadmap 2026-11-03 §5.4): the staff moderation queue. The keys
 * are declared here for PermissionGuard and checked again in
 * ModerationService (PD-40 still runs in shadow mode). No route takes an
 * organization: the caller's own is the only one.
 */
@Controller('moderation/reports')
@UseFilters(CommErrorFilter)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  /** `?status=open|in_review|actioned|dismissed &priority=urgent|normal &overdue=true|false`. A JSON array. */
  @Requires('moderation.view')
  @Get()
  list(@ActorId() actorId: string, @Query('status') status?: string, @Query('priority') priority?: string, @Query('overdue') overdue?: string) {
    return this.moderation.list(actorId, { status, priority, overdue });
  }

  /** One report with its evidence; writes the audit row `report.viewed`. */
  @Requires('moderation.view')
  @Get(':id')
  detail(@ActorId() actorId: string, @Param('id') id: string) {
    return this.moderation.detail(actorId, id);
  }

  @Requires('moderation.act')
  @Post(':id/take')
  @HttpCode(200)
  take(
    @ActorId() actorId: string,
    @Param('id') id: string,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') xKey?: string,
  ) {
    return this.moderation.take(actorId, id, parseIdempotencyKey(key, xKey));
  }

  /** `{resolution, note?, answer}`; the answer to the reporter is required. */
  @Requires('moderation.act')
  @Post(':id/resolve')
  @HttpCode(200)
  resolve(
    @ActorId() actorId: string,
    @CallerAccountId() accountId: string | undefined,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') xKey?: string,
  ) {
    return this.moderation.resolve(actorId, accountId, id, body ?? {}, parseIdempotencyKey(key, xKey));
  }
}
