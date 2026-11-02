import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { NotForStaff, Requires } from '../platform/permissions/route-access';
import { ActionScope, RateLimited } from '../platform/auth/action-throttle.guard';
import { GiveRewardInput, RewardService } from './reward.service';

/**
 * PD-55: a teacher's rewards during a lesson. A teacher's own surface: staff
 * are refused at the route, a parent in the service (the same 404 as an
 * unknown lesson). 404 throughout while rewards.enabled is off.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class RewardController {
  constructor(private readonly rewards: RewardService) {}

  /** The lessons on now, each with its learner and their stars: the tray's "For". */
  @NotForStaff()
  @Get('teacher/rewards/now')
  now(@ActorId() actorId: string) {
    return this.rewards.lessonsNow(actorId);
  }

  /**
   * PD-55 PR-5: one lesson's rewards for its learner (the report card's row).
   * Staff need lessons.view AND to supervise the lesson's teacher; a parent or
   * a teacher is decided in the service. Never more than one learner.
   */
  @Requires('lessons.view')
  @Get('lessons/:lessonId/rewards')
  forLesson(@ActorId() actorId: string, @Param('lessonId') lessonId: string) {
    return this.rewards.forLesson(actorId, lessonId);
  }

  @NotForStaff()
  @Post('learners/:learnerId/rewards')
  @HttpCode(201)
  @RateLimited(ActionScope.REWARD_GIVE)
  give(@ActorId() actorId: string, @Param('learnerId') learnerId: string, @Body() body: GiveRewardInput) {
    return this.rewards.give(actorId, learnerId, body ?? {});
  }

  @NotForStaff()
  @Post('learners/:learnerId/rewards/:eventId/undo')
  @HttpCode(201)
  @RateLimited(ActionScope.REWARD_GIVE)
  undo(@ActorId() actorId: string, @Param('learnerId') learnerId: string, @Param('eventId') eventId: string) {
    return this.rewards.undo(actorId, learnerId, eventId);
  }
}
