import { Body, Controller, Get, Headers, Post, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { SelfService } from '../platform/permissions/route-access';
import { parseIdempotencyKey } from './dto';
import { ReportsService } from './reports.service';

/**
 * PD-57 WP-1 (roadmap 2026-11-03 §5.4): the reporter's routes. Any signed-in
 * parent, teacher or staff member files a report about someone else (staff
 * included: §6.1 rule 5); who and what may be reported is decided in
 * ReportsService. Not on the support-session allowlist (§5.5 rule 4), so a
 * support session is refused before the handler runs.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * `{targetKind: 'message', messageId, reason, note?}` or
   * `{targetKind: 'person', subject: {kind, id}, reason, note?}`.
   * 201 `{id, status, dueAt}`; 200 with the same shape when the reporter's
   * report of this target is still open. Idempotency-Key (or X-Idempotency-Key):
   * a replay answers what the first request did.
   */
  @SelfService()
  @Post('reports')
  async file(
    @ActorId() actorId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key?: string,
    @Headers('x-idempotency-key') xKey?: string,
  ) {
    // TODO(ENG-10): apply ENG-10's reusable terms-accepted guard to this route
    // (COMM.TERMS_NOT_ACCEPTED, 403, roadmap §5.4 "after WP-3") once it lands.
    // Deliberately not built here.
    const filed = await this.reports.file(actorId, body ?? {}, parseIdempotencyKey(key, xKey));
    res.status(filed.status);
    return filed.body;
  }

  /** The caller's own reports: `[{id, targetKind, reason, status, createdAt, answer?: {text, at}}]`. */
  @SelfService()
  @Get('me/reports')
  mine(@ActorId() actorId: string) {
    return this.reports.mine(actorId);
  }
}
