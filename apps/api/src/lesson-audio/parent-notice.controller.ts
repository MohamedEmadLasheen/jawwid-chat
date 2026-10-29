import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { NotForStaff } from '../platform/permissions/route-access';
import type { Actor } from '../platform/types';
import { ParentNoticeService } from './parent-notice.service';

/**
 * PD-48: a parent's notices (the lesson-audio notice, owner 2026-10-29). The
 * contact is always the token's actor; no route takes a contact id.
 */
@Controller('parent-notices')
@UseFilters(CommErrorFilter)
export class ParentNoticeController {
  constructor(private readonly notices: ParentNoticeService) {}

  /** Each notice at its current version, and whether this parent acknowledged it. */
  @NotForStaff()
  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.notices.list(actor);
  }

  /** `{ version }`: the version shown. Idempotent: a second acknowledgement adds nothing. */
  @NotForStaff()
  @Post(':key/acknowledge')
  @HttpCode(200)
  acknowledge(@Param('key') key: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.notices.acknowledge(actor, key, body ?? {});
  }
}
