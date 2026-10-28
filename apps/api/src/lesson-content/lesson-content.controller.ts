import { Body, Controller, Get, Param, Post, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires } from '../platform/permissions/route-access';
import type { Actor } from '../platform/types';
import { LessonContentService } from './lesson-content.service';

const ANY = ['lesson_content.view', 'lesson_content.check', 'lesson_content.review_teacher', 'lesson_content.review_scholar'] as const;
const SIGNS = ['lesson_content.check', 'lesson_content.review_teacher', 'lesson_content.review_scholar'] as const;

/**
 * PD-49: the review of children's Quran content and of game mechanics
 * (docs/product/pd049-children-quran-experience-plan.md §F.2-§F.4). Items are
 * named by scope (quran-NNN or play) and their own ids; nothing here is a
 * child's or a family's data. POST for every change: the shared Admin Web
 * client has no PUT.
 */
@Controller('lesson-content')
@UseFilters(CommErrorFilter)
export class LessonContentController {
  constructor(private readonly content: LessonContentService) {}

  @Requires(...ANY)
  @Get('access')
  access(@CurrentActor() actor: Actor) {
    return this.content.access(actor);
  }

  @Requires(...ANY)
  @Get('review/:scope')
  list(@Param('scope') scope: string, @CurrentActor() actor: Actor) {
    return this.content.list(scope, actor);
  }

  /** What may reach children: every item of the scope whose current text has every step it needs. */
  @Requires(...ANY)
  @Get('approvals/:scope')
  export(@Param('scope') scope: string, @CurrentActor() actor: Actor) {
    return this.content.export(scope, actor);
  }

  @Requires(...SIGNS)
  @Post('review/:scope/:itemId/approve')
  approve(@Param('scope') scope: string, @Param('itemId') itemId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.content.review(scope, itemId, 'approve', body ?? {}, actor);
  }

  @Requires(...SIGNS)
  @Post('review/:scope/:itemId/reject')
  reject(@Param('scope') scope: string, @Param('itemId') itemId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.content.review(scope, itemId, 'reject', body ?? {}, actor);
  }

  @Requires(...SIGNS)
  @Post('review/:scope/:itemId/withdraw')
  withdraw(@Param('scope') scope: string, @Param('itemId') itemId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.content.review(scope, itemId, 'withdraw', body ?? {}, actor);
  }
}
