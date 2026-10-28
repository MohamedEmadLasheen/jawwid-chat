import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires } from '../platform/permissions/route-access';
import { FamilyIntakeService } from './intake.service';

/**
 * PD-42: entering families by hand (the intake from Jawwid Core). Behind the
 * global bearer guard; who may enter what is decided in FamilyIntakeService
 * and again by the database -- never here. POST for every change.
 */
@Controller('family-intake')
@UseFilters(CommErrorFilter)
export class FamilyIntakeController {
  constructor(private readonly intake: FamilyIntakeService) {}

  /** Who the caller enters as, who they may enter for, the teachers. */
  @Requires('new_students.manage')
  @Get('options')
  options(@ActorId() actorId: string) {
    return this.intake.options(actorId);
  }

  /** { intakeId, parent: { name, email?, phone?, country? }, children: [...], payment?, onBehalfOf?, confirmOver? } */
  @Requires('new_students.manage')
  @Post()
  enter(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.intake.enter(actorId, body ?? {});
  }

  /** { intakeId, children: [...], confirmDuplicate?, confirmOver? } */
  @Requires('new_students.manage')
  @Post('families/:familyId/children')
  addChildren(@ActorId() actorId: string, @Param('familyId') familyId: string, @Body() body: Record<string, unknown>) {
    return this.intake.addChildren(actorId, familyId, body ?? {});
  }

  /** { email } */
  @Requires('new_students.manage')
  @Post('families/:familyId/sign-in-email')
  setSignInEmail(@ActorId() actorId: string, @Param('familyId') familyId: string, @Body() body: Record<string, unknown>) {
    return this.intake.setSignInEmail(actorId, familyId, body ?? {});
  }

  /** { total, completed, planMonths?, confirmOver? } */
  @Requires('subscriptions.carry_over')
  @Post('learners/:learnerId/carried-over')
  carryOver(@ActorId() actorId: string, @Param('learnerId') learnerId: string, @Body() body: Record<string, unknown>) {
    return this.intake.carryOver(actorId, learnerId, body ?? {});
  }

  /** { reason } */
  @Requires('subscriptions.carry_over')
  @Post('learners/:learnerId/carried-over/void')
  voidCarryOver(@ActorId() actorId: string, @Param('learnerId') learnerId: string, @Body() body: Record<string, unknown>) {
    return this.intake.voidCarryOver(actorId, learnerId, body ?? {});
  }
}
