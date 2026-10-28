import { Body, Controller, Header, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires } from '../platform/permissions/route-access';
import { TeacherOnboardingService } from './teacher-onboarding.service';

/**
 * PD-43: adding a teacher. Who may, and which supervisor they may name, is
 * decided in TeacherOnboardingService and again in chat.create_teacher. Both
 * answers carry a first sign-in code exactly once: never cached.
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

  /** A new first sign-in code while the teacher has not signed in; the old one dies. { reason? } */
  @Requires('teachers.create')
  @Post(':teacherId/first-login-code')
  @Header('Cache-Control', 'no-store')
  reissue(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.onboarding.reissue(actorId, teacherId, body ?? {});
  }
}
