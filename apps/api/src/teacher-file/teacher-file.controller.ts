import { Body, Controller, Get, Header, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { TeacherFileService } from './teacher-file.service';
import { TeacherPayrollService } from './teacher-payroll.service';
import { Requires } from '../platform/permissions/route-access';

/**
 * PD-10 Teacher File, administration only. Every route is behind the global
 * bearer guard; who may do what is decided in TeacherFileService ->
 * AuthorizationService.teacherFileAccess, never here. POST for updates: the
 * shared admin-web client has no PUT.
 */
@Controller('teacher-files')
@UseFilters(CommErrorFilter)
export class TeacherFileController {
  constructor(
    private readonly files: TeacherFileService,
    private readonly payroll: TeacherPayrollService,
  ) {}

  @Requires('teacher_files.view')
  @Get()
  list(@ActorId() actorId: string) {
    return this.files.list(actorId);
  }

  // PD-26: declared before ':teacherId', which would otherwise match them.

  /** Every complaint, newest first: by source (management | parent) and status. */
  @Requires('teacher_files.view')
  @Get('complaints')
  complaints(@ActorId() actorId: string, @Query('from') from?: string, @Query('status') status?: string) {
    return this.files.complaints(actorId, { from, status });
  }

  /** Every recorded reward, newest first; amounts for the super admin only. */
  @Requires('teacher_files.view')
  @Get('rewards')
  @Header('Cache-Control', 'no-store')
  rewards(@ActorId() actorId: string, @Query('month') month?: string) {
    return this.payroll.rewards(actorId, month);
  }

  /** The default amount of a first and second deduction, per currency (super admin). */
  @Requires('teacher_files.finance')
  @Get('finance/deduction-defaults')
  @Header('Cache-Control', 'no-store')
  deductionDefaults(@ActorId() actorId: string) {
    return this.payroll.deductionDefaults(actorId);
  }

  @Requires('teacher_files.finance')
  @Post('finance/deduction-defaults')
  setDeductionDefault(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.payroll.setDeductionDefault(actorId, body ?? {});
  }

  @Requires('teacher_files.view')
  @Get(':teacherId')
  detail(@ActorId() actorId: string, @Param('teacherId') teacherId: string) {
    return this.files.detail(actorId, teacherId);
  }

  @Requires('teacher_files.edit')
  @Post(':teacherId/personal')
  updatePersonal(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.files.updatePersonal(actorId, teacherId, body ?? {});
  }

  @Requires('teacher_files.supervise')
  @Post(':teacherId/entries')
  addEntry(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.files.addEntry(actorId, teacherId, body ?? {});
  }

  // PD-18 payroll: super admin only, decided in TeacherPayrollService.

  @Requires('teacher_files.finance')
  @Get(':teacherId/finance')
  @Header('Cache-Control', 'no-store')
  finance(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Query('month') month?: string) {
    return this.payroll.finance(actorId, teacherId, month);
  }

  @Requires('teacher_files.finance')
  @Post(':teacherId/finance/terms')
  setTerms(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.payroll.setTerms(actorId, teacherId, body ?? {});
  }

  @Requires('teacher_files.finance')
  @Post(':teacherId/finance/payout-account')
  setPayoutAccount(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.payroll.setPayoutAccount(actorId, teacherId, body ?? {});
  }

  /** The details in clear. Audited with its reason; never cached. */
  @Requires('teacher_files.finance')
  @Post(':teacherId/finance/payout-account/reveal')
  @Header('Cache-Control', 'no-store')
  revealPayoutAccount(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.payroll.revealPayoutAccount(actorId, teacherId, body ?? {});
  }

  /** PD-26: a reward and its amount in one transaction (super admin). */
  @Requires('teacher_files.supervise')
  @Post(':teacherId/rewards')
  recordReward(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.payroll.recordReward(actorId, teacherId, body ?? {});
  }

  @Requires('teacher_files.finance')
  @Post(':teacherId/finance/adjustments')
  addAdjustment(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.payroll.addAdjustment(actorId, teacherId, body ?? {});
  }
}
