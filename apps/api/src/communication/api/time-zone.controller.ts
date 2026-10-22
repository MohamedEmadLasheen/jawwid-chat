import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ActorId, CurrentActor } from './actor.decorator';
import { TimeZoneService } from '../../platform/time-zone.service';
import type { Actor } from '../../platform/types';

/**
 * PD-22: the caller's own time zone, like a phone's Date & time settings.
 *
 *   GET  /me/time-zone          the setting
 *   POST /me/time-zone/device   the phone's OS zone (launch, resume); kept only
 *                               while the setting is automatic
 *   PUT  /me/time-zone          { automatic, timeZone } -- the person's choice
 *
 * Every response is the stored setting, so the app adopts a manual choice made
 * on another device. Nobody reads or writes another person's zone here.
 */
@Controller('me/time-zone')
export class TimeZoneController {
  constructor(private readonly zones: TimeZoneService) {}

  @Get()
  mine(@ActorId() actorId: string) {
    return this.zones.get(actorId);
  }

  @Post('device')
  report(@CurrentActor() actor: Actor, @Body() body: { timeZone?: unknown }) {
    return this.zones.reportDevice(actor, body?.timeZone);
  }

  @Put()
  set(@CurrentActor() actor: Actor, @Body() body: { automatic?: unknown; timeZone?: unknown }) {
    return this.zones.set(actor, body ?? {});
  }
}
