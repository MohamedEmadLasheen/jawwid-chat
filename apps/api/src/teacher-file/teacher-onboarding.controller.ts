import { Body, Controller, Get, Header, Param, Patch, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires } from '../platform/permissions/route-access';
import { TeacherOnboardingService } from './teacher-onboarding.service';

/**
 * PD-43: adding a teacher, and (PR-1b) offboarding and reactivating one. Who
 * may is decided in TeacherOnboardingService and again in the database
 * (chat.create_teacher, chat.offboard_teacher, chat.reactivate_teacher). An
 * answer that carries a first sign-in code is never cached.
 */
@Controller('teachers')
@UseFilters(CommErrorFilter)
export class TeacherOnboardingController {
  constructor(private readonly onboarding: TeacherOnboardingService) {}

  /** { id, name, email, phone?, joinedOn?, teachingMarket?, supervisorId?: uuid | 'self' | null, note? } */
  @Requires('teachers.create')
  @Post()
  @Header('Cache-Control', 'no-store')
  add(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.add(actorId, body ?? {});
  }

  /** Give sign-in: a login, and its first code, for a teacher who exists but has none. { email, reason? } */
  @Requires('teachers.create')
  @Post(':teacherId/sign-in')
  @Header('Cache-Control', 'no-store')
  giveSignIn(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.giveSignIn(actorId, teacherId, body ?? {});
  }

  /**
   * A new sign-in e-mail. { email, reason? } While the login waits: the reissue
   * rule, and a new first sign-in code to the new address; once used: the
   * super admin only, and every session ends.
   */
  @Requires('teachers.create')
  @Patch(':teacherId/sign-in')
  @Header('Cache-Control', 'no-store')
  changeSignIn(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.changeSignIn(actorId, teacherId, body ?? {});
  }

  /** A new first sign-in code while the teacher has not signed in; the old one dies. { reason? } */
  @Requires('teachers.create')
  @Post(':teacherId/first-login-code')
  @Header('Cache-Control', 'no-store')
  reissue(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.reissue(actorId, teacherId, body ?? {});
  }

  /** The students still assigned and the lessons ahead: what offboarding would meet. */
  @Requires('teachers.offboard')
  @Get(':teacherId/offboard-preview')
  offboardPreview(@ActorId() actorId: string, @Param('teacherId') teacherId: string) {
    return this.onboarding.offboardPreview(actorId, teacherId);
  }

  /** { reason, cancelOpenLessons? }. Refused while a student remains. */
  @Requires('teachers.offboard')
  @Post(':teacherId/offboard')
  offboard(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.offboard(actorId, teacherId, body ?? {});
  }

  /** { reason }. The super admin only (Layer 2); answers a new first sign-in code. */
  @Requires('teachers.offboard')
  @Post(':teacherId/reactivate')
  @Header('Cache-Control', 'no-store')
  reactivate(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.reactivate(actorId, teacherId, body ?? {});
  }
}
