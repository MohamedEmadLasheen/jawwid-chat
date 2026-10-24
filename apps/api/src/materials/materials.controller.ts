import { Body, Controller, Get, Header, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { manifestTemplate } from './manifest';
import { MaterialsAdminService } from './materials-admin.service';
import { MaterialsReaderService } from './materials-reader.service';

/**
 * PD-29: Materials. Behind the global bearer guard; who may do what is decided
 * in the services, never here. POST for every change (the admin-web client has
 * no PUT/PATCH).
 */
@Controller()
@UseFilters(CommErrorFilter)
export class MaterialsController {
  constructor(
    private readonly admin: MaterialsAdminService,
    private readonly reader: MaterialsReaderService,
  ) {}

  // --- Managing the library (super admin, Teachers manager) ---

  /** Whether to offer the Materials page (navigation UX; every route decides again). */
  @Get('materials/admin/access')
  access(@ActorId() actorId: string) {
    return this.admin.access(actorId);
  }

  @Get('materials/admin/items')
  list(@ActorId() actorId: string, @Query() query: Record<string, unknown>) {
    return this.admin.list(actorId, query ?? {});
  }

  @Post('materials/admin/items')
  create(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.admin.create(actorId, body ?? {});
  }

  @Get('materials/admin/items/:id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.admin.get(actorId, id);
  }

  @Post('materials/admin/items/:id')
  update(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.admin.update(actorId, id, body ?? {});
  }

  @Post('materials/admin/uploads')
  uploads(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.admin.uploads(actorId, body ?? {});
  }

  @Post('materials/admin/import')
  import(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.admin.import(actorId, body ?? {});
  }

  @Get('materials/admin/import/template.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="materials-manifest.csv"')
  async template(@ActorId() actorId: string) {
    await this.admin.requireManager(actorId);
    return manifestTemplate();
  }

  @Get('materials/admin/recitations')
  recitations(@ActorId() actorId: string) {
    return this.admin.recitations(actorId);
  }

  @Post('materials/admin/recitations/sources')
  createSource(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.admin.createSource(actorId, body ?? {});
  }

  @Post('materials/admin/recitations/sources/:id')
  updateSource(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.admin.updateSource(actorId, id, body ?? {});
  }

  @Post('materials/admin/recitations/sources/:id/surahs/:surah')
  setTrack(@ActorId() actorId: string, @Param('id') id: string, @Param('surah') surah: string, @Body() body: Record<string, unknown>) {
    return this.admin.setTrack(actorId, id, surah, body ?? {});
  }

  // --- Reading ---

  @Get('materials/quran/surahs')
  surahs() {
    return this.reader.surahs();
  }

  /** Published items, for a teacher attaching practice to a report. */
  @Get('materials/items')
  picker(@ActorId() actorId: string, @Query() query: Record<string, unknown>) {
    return this.reader.picker(actorId, query ?? {});
  }

  /** The access decision: a signed URL to play one item. */
  @Post('materials/items/:id/open')
  open(@ActorId() actorId: string, @Param('id') id: string) {
    return this.reader.open(actorId, id);
  }

  @Post('materials/recitations/:surah/open')
  openRecitation(@ActorId() actorId: string, @Param('surah') surah: string) {
    return this.reader.openRecitation(actorId, surah);
  }

  @Get('learners/:id/materials/library')
  library(@ActorId() actorId: string, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.reader.library(actorId, id, query ?? {});
  }

  @Get('learners/:id/materials/practice')
  practice(@ActorId() actorId: string, @Param('id') id: string) {
    return this.reader.practice(actorId, id);
  }

  @Get('learners/:id/materials/progress')
  progress(@ActorId() actorId: string, @Param('id') id: string) {
    return this.reader.progress(actorId, id);
  }

  @Get('learners/:id/materials/progress/:surah')
  history(@ActorId() actorId: string, @Param('id') id: string, @Param('surah') surah: string) {
    return this.reader.history(actorId, id, surah);
  }

  @Post('learners/:id/materials/progress/:surah/correct')
  correct(@ActorId() actorId: string, @Param('id') id: string, @Param('surah') surah: string, @Body() body: Record<string, unknown>) {
    return this.reader.correct(actorId, id, surah, body ?? {});
  }
}
