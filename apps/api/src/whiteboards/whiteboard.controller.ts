import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { CurrentActor } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ActionScope, RateLimited } from '../platform/auth/action-throttle.guard';
import { NotForStaff, Requires } from '../platform/permissions/route-access';
import type { Actor } from '../platform/types';
import { WhiteboardService } from './whiteboard.service';

/**
 * PD-39: a teacher's own boards (docs/product/pd039-whiteboard-design.md §4.5,
 * §10). Every route is the teacher's own surface: staff are refused by
 * PermissionGuard before the service runs, and the service refuses anyone but
 * the owning teacher (and every write in a support session). POST for every
 * change; every write names the board revision it was made against.
 *
 * Fixed paths (trash, pages/order) are declared before their `:id` siblings.
 */
@Controller('whiteboards')
@UseFilters(CommErrorFilter)
export class WhiteboardController {
  constructor(private readonly boards: WhiteboardService) {}

  @NotForStaff()
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentActor() actor: Actor) {
    return this.boards.list(actor);
  }

  /** Deleted boards, restorable for 30 days. */
  @NotForStaff()
  @Get('trash')
  @Header('Cache-Control', 'private, no-store')
  trash(@CurrentActor() actor: Actor) {
    return this.boards.trash(actor);
  }

  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post()
  @HttpCode(201)
  create(@Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.boards.create(body ?? {}, actor);
  }

  @NotForStaff()
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  open(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.boards.open(id, actor);
  }

  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/rename')
  @HttpCode(200)
  rename(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.boards.rename(id, body ?? {}, actor);
  }

  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/duplicate')
  @HttpCode(201)
  duplicate(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.boards.duplicate(id, actor);
  }

  /** To Deleted boards for 30 days; there is no permanent delete (§10 5b). */
  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/trash')
  @HttpCode(200)
  moveToTrash(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.boards.moveToTrash(id, body ?? {}, actor);
  }

  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.boards.restore(id, actor);
  }

  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/pages/order')
  @HttpCode(200)
  reorderPages(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.boards.reorderPages(id, body ?? {}, actor);
  }

  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/pages')
  @HttpCode(201)
  addPage(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.boards.addPage(id, body ?? {}, actor);
  }

  /** The autosave: one page's drawing. */
  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/pages/:pageId')
  @HttpCode(200)
  savePage(@Param('id') id: string, @Param('pageId') pageId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.boards.savePage(id, pageId, body ?? {}, actor);
  }

  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/pages/:pageId/duplicate')
  @HttpCode(201)
  duplicatePage(@Param('id') id: string, @Param('pageId') pageId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.boards.duplicatePage(id, pageId, body ?? {}, actor);
  }

  @NotForStaff()
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/pages/:pageId/delete')
  @HttpCode(200)
  deletePage(@Param('id') id: string, @Param('pageId') pageId: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor) {
    return this.boards.deletePage(id, pageId, body ?? {}, actor);
  }
}

/**
 * PD-39 §10 1b, 4a: teachers' boards for staff, read-only. The key is necessary,
 * never sufficient: the service answers 404 unless the caller is the teacher's
 * assigned supervisor, their active backup, the Teachers Manager or the super
 * admin. Every open is logged. The one write is the Teachers Manager's copy of
 * a departed teacher's board to another teacher; the original is unchanged.
 */
@Controller('teacher-boards')
@UseFilters(CommErrorFilter)
export class TeacherBoardsController {
  constructor(private readonly boards: WhiteboardService) {}

  @Requires('whiteboards.view', 'whiteboards.retention')
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query('teacherId') teacherId: string, @CurrentActor() actor: Actor) {
    return this.boards.teacherBoards(teacherId, actor);
  }

  @Requires('whiteboards.view', 'whiteboards.retention')
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  review(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.boards.review(id, actor);
  }

  @Requires('whiteboards.retention')
  @Get(':id/access-log')
  @Header('Cache-Control', 'private, no-store')
  accessLog(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.boards.accessLog(id, actor);
  }

  @Requires('whiteboards.retention')
  @RateLimited(ActionScope.WHITEBOARD_WRITE)
  @Post(':id/copy')
  @HttpCode(201)
  copy(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentActor() actor: Actor, @Headers('idempotency-key') key?: string) {
    return this.boards.copyToTeacher(id, body ?? {}, actor, key);
  }
}
