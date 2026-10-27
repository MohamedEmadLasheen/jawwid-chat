import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { TeacherEvaluationService } from './teacher-evaluation.service';

/**
 * PD-35: teacher evaluations and improvement plans. Behind the global bearer
 * guard; who may do what is decided in TeacherEvaluationService (the Teacher
 * File's access rules, narrowed by PD-35's scope). POST for every change.
 */
@Controller()
@UseFilters(CommErrorFilter)
export class TeacherEvaluationController {
  constructor(private readonly evaluations: TeacherEvaluationService) {}

  @Get('evaluation-criteria')
  criteria(@ActorId() actorId: string) {
    return this.evaluations.criteria(actorId);
  }

  /** { labelEn, labelAr } */
  @Post('evaluation-criteria')
  addCriterion(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.evaluations.addCriterion(actorId, body ?? {});
  }

  /** { labelEn?, labelAr?, position?, isActive? } */
  @Post('evaluation-criteria/:id')
  updateCriterion(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.evaluations.updateCriterion(actorId, id, body ?? {});
  }

  @Get('teachers/:teacherId/evaluations')
  forTeacher(@ActorId() actorId: string, @Param('teacherId') teacherId: string) {
    return this.evaluations.forTeacher(actorId, teacherId);
  }

  /** { periodFrom, periodTo, scores, notes?, recommendations?, supersedesId? } */
  @Post('teachers/:teacherId/evaluations')
  evaluate(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.evaluations.evaluate(actorId, teacherId, body ?? {});
  }

  @Post('evaluations/:id/share')
  shareEvaluation(@ActorId() actorId: string, @Param('id') id: string) {
    return this.evaluations.shareEvaluation(actorId, id);
  }

  /** { title, evaluationId?, goals: [{ body, dueOn? }] } */
  @Post('teachers/:teacherId/improvement-plans')
  plan(@ActorId() actorId: string, @Param('teacherId') teacherId: string, @Body() body: Record<string, unknown>) {
    return this.evaluations.plan(actorId, teacherId, body ?? {});
  }

  @Post('improvement-plans/:id/share')
  sharePlan(@ActorId() actorId: string, @Param('id') id: string) {
    return this.evaluations.sharePlan(actorId, id);
  }

  /** { status: open | met | missed | dropped, note? } */
  @Post('improvement-goals/:id/status')
  goalStatus(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.evaluations.goalStatus(actorId, id, body ?? {});
  }

  /** The teacher's own shared evaluations and plans. */
  @Get('me/evaluations')
  mine(@ActorId() actorId: string) {
    return this.evaluations.mine(actorId);
  }
}
