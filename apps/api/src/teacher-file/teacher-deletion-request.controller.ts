import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { CommError, CommErrorCode } from '../platform/errors';
import { Requires } from '../platform/permissions/route-access';
import { PrismaService } from '../platform/prisma.service';
import { TeacherDeletionRequestService } from '../account-deletion/teacher-deletion-request.service';
import { TeacherFileService } from './teacher-file.service';

const COMPLETE_REFUSAL = 'only the Teachers manager or the super admin closes and deletes a teacher’s account';

/**
 * PD-56 O-3 on the Teacher File: the teacher asked to delete their account
 * while lessons, students or payroll were open.
 *
 *   GET  /teacher-files/:teacherId/deletion-request           the banner: the
 *        request, its deadline, what is still open, and whether this reader
 *        may complete it. Whoever may read the Teacher File (PD-10), for a
 *        teacher in their scope (PD-35, requireTeacher).
 *   POST /teacher-files/:teacherId/deletion-request/complete  {confirm: true}
 *        "Close and delete account": the request is completed and the
 *        erasure runs. PD-43's offboarding rule -- the super admin, or the
 *        Teachers manager -- for a teacher in their scope.
 */
@Controller('teacher-files/:teacherId/deletion-request')
@UseFilters(CommErrorFilter)
export class TeacherDeletionRequestController {
  constructor(
    private readonly files: TeacherFileService,
    private readonly requests: TeacherDeletionRequestService,
    private readonly prisma: PrismaService,
  ) {}

  @Requires('teacher_files.view')
  @Get()
  async read(@ActorId() actorId: string, @Param('teacherId') teacherId: string) {
    const { actor } = await this.files.gate(actorId, (a) => a.canView);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    const { onboarding } = await this.files.onboardingGate(actorId, () => true);
    return this.requests.forTeacher(teacher.id, onboarding.canOffboard);
  }

  @Requires('teachers.offboard')
  @Post('complete')
  @HttpCode(200)
  async complete(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    const { actor } = await this.files.onboardingGate(actorId, (o) => o.canOffboard, COMPLETE_REFUSAL);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    if ((body ?? {}).confirm !== true) {
      throw new CommError(CommErrorCode.VALIDATION, 'confirm: must be true: closing and deleting an account cannot be undone', 400);
    }
    const staff = await this.prisma.staff.findUnique({ where: { id: actor.actorId }, select: { accountId: true } });
    return this.requests.complete(teacher.id, { staffId: actor.actorId, staffAccountId: staff?.accountId ?? null });
  }
}
