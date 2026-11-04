import { Body, Controller, Get, Post, Put, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ActionScope, RateLimited } from '../platform/auth/action-throttle.guard';
import { NotForStaff } from '../platform/permissions/route-access';
import { MyLocationService } from './my-location.service';

/**
 * PD-45 PR-4 (plan §5.4): the signed-in parent's own family location, for the
 * app's profile row and its one-time prompt. No route takes an owner id: the
 * family is the caller's own (MyLocationService). Staff use the Parent Profile
 * (`/parent-profiles`), which the app never calls.
 *
 *   GET  /me/location         { countryCode, subdivisionCode, location: {ar, en} | null, prompt, suggestedCountryCode? }
 *   PUT  /me/location         { countryCode, subdivisionCode? } -> the same view; answers the prompt 'saved'
 *   POST /me/location/later   no body -> the same view; answers the prompt 'later'
 */
@Controller('me/location')
@UseFilters(CommErrorFilter)
export class MyLocationController {
  constructor(private readonly location: MyLocationService) {}

  @NotForStaff()
  @Get()
  read(@ActorId() actorId: string) {
    return this.location.read(actorId);
  }

  @NotForStaff()
  @RateLimited(ActionScope.LOCATION_WRITE)
  @Put()
  save(@ActorId() actorId: string, @Body() body: unknown) {
    return this.location.save(actorId, body);
  }

  @NotForStaff()
  @RateLimited(ActionScope.LOCATION_WRITE)
  @Post('later')
  later(@ActorId() actorId: string) {
    return this.location.later(actorId);
  }
}
