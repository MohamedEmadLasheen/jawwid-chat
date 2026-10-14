import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import type { Actor } from '../platform/types';
import { AdminInspectionService } from './admin-inspection.service';

/**
 * `/admin` -- the Admin Portal's read-only inspection surface.
 *
 * Protected twice, and neither depends on the other:
 *   1. the global AuthenticatedGuard: no verified bearer token, no request;
 *   2. AdminInspectionService asks AuthorizationService.canInspectOrganization
 *      before its first query: anyone but the super admin gets
 *      COMM.ADMIN_INSPECTION_DENIED (403).
 *
 * The actor is `request.actor`, written only by the guard. No route takes an
 * organization, an actor id or a role from the request, so there is nothing a
 * caller can send to widen what they see.
 */
@Controller('admin')
@UseFilters(CommErrorFilter)
export class AdminController {
  constructor(private readonly inspection: AdminInspectionService) {}

  @Get('overview')
  overview(@CurrentActor() actor: Actor) {
    return this.inspection.overview(actor);
  }

  @Get('users')
  users(@CurrentActor() actor: Actor) {
    return this.inspection.users(actor);
  }

  @Get('conversations')
  conversations(@CurrentActor() actor: Actor) {
    return this.inspection.conversations(actor);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.inspection.messages(actor, id);
  }

  @Get('stories')
  stories(@CurrentActor() actor: Actor) {
    return this.inspection.stories(actor);
  }
}
