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

  /** New Students: the families entered by hand that the caller owns (PR-3). */
  @Requires('new_students.view')
  @Get('entered')
  entered(@ActorId() actorId: string) {
    return this.intake.entered(actorId);
  }

  /** The family as the Parent Profile reads it: sign-in, owners, what the caller may do. */
  @Requires('new_students.view')
  @Get('families/:familyId')
  family(@ActorId() actorId: string, @Param('familyId') familyId: string) {
    return this.intake.family(actorId, familyId);
  }

  /** S4: the family's history -- who entered it, owns it, placed it; its packages. */
  @Requires('new_students.view')
  @Get('families/:familyId/history')
  history(@ActorId() actorId: string, @Param('familyId') familyId: string) {
    return this.intake.history(actorId, familyId);
  }

  /** { supervisorId } -- the Operations manager places a family waiting for its Operations supervisor. */
  @Requires('org.manage')
  @Post('families/:familyId/operations-supervisor')
  assignOperationsSupervisor(@ActorId() actorId: string, @Param('familyId') familyId: string, @Body() body: Record<string, unknown>) {
    return this.intake.assignOperationsSupervisor(actorId, familyId, body ?? {});
  }

  /** { supervisorId } -- the family's Sales owner suggests one (D1). */
  @Requires('new_students.manage')
  @Post('families/:familyId/supervisor-suggestion')
  suggestSupervisor(@ActorId() actorId: string, @Param('familyId') familyId: string, @Body() body: Record<string, unknown>) {
    return this.intake.suggestSupervisor(actorId, familyId, body ?? {});
  }

  /** { staffId, reason } -- the Sales manager sets or changes the family's Sales owner. */
  @Requires('org.manage')
  @Post('families/:familyId/sales-owner')
  changeSalesOwner(@ActorId() actorId: string, @Param('familyId') familyId: string, @Body() body: Record<string, unknown>) {
    return this.intake.changeSalesOwner(actorId, familyId, body ?? {});
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

  /** The Student Profile's "Current package": the carried-over row, the balance, what the caller may do. */
  @Requires('subscriptions.carry_over')
  @Get('learners/:learnerId/carried-over')
  carriedOverOf(@ActorId() actorId: string, @Param('learnerId') learnerId: string) {
    return this.intake.carriedOverOf(actorId, learnerId);
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
