import { Body, Controller, Get, Header, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommError, CommErrorCode } from '../platform/errors';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { manifestTemplate } from './manifest';
import { MaterialsAdminService } from './materials-admin.service';
import { MaterialsReaderService } from './materials-reader.service';
import { Requires, SelfService } from '../platform/permissions/route-access';

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
  @SelfService()
  @Get('materials/admin/access')
  access(@ActorId() actorId: string) {
    return this.admin.access(actorId);
  }

  @Requires('materials.manage')
  @Get('materials/admin/items')
  list(@ActorId() actorId: string, @Query() query: Record<string, unknown>) {
    return this.admin.list(actorId, query ?? {});
  }

  @Requires('materials.manage')
  @Post('materials/admin/items')
  create(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.admin.create(actorId, body ?? {});
  }

  @Requires('materials.manage')
  @Get('materials/admin/items/:id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.admin.get(actorId, id);
  }

  @Requires('materials.manage')
  @Post('materials/admin/items/:id')
  update(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.admin.update(actorId, id, body ?? {});
  }

  @Requires('materials.manage')
  @Post('materials/admin/uploads')
  uploads(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.admin.uploads(actorId, body ?? {});
  }

  @Requires('materials.manage')
  @Post('materials/admin/import')
  import(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.admin.import(actorId, body ?? {});
  }

  @Requires('materials.manage')
  @Get('materials/admin/import/template.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="materials-manifest.csv"')
  async template(@ActorId() actorId: string) {
    await this.admin.requireManager(actorId);
    return manifestTemplate();
  }

  @Requires('materials.manage')
  @Get('materials/admin/recitations')
  recitations(@ActorId() actorId: string) {
    return this.admin.recitations(actorId);
  }

  @Requires('materials.manage')
  @Post('materials/admin/recitations/sources')
  createSource(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.admin.createSource(actorId, body ?? {});
  }

  @Requires('materials.manage')
  @Post('materials/admin/recitations/sources/:id')
  updateSource(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.admin.updateSource(actorId, id, body ?? {});
  }

  @Requires('materials.manage')
  @Post('materials/admin/recitations/sources/:id/surahs/:surah')
  setTrack(@ActorId() actorId: string, @Param('id') id: string, @Param('surah') surah: string, @Body() body: Record<string, unknown>) {
    return this.admin.setTrack(actorId, id, surah, body ?? {});
  }

  // --- Reading ---

  @Requires('materials.view')
  @Get('materials/quran/surahs')
  surahs() {
    return this.reader.surahs();
  }

  /** Published items, for a teacher attaching practice to a report. */
  @Requires('materials.view')
  @Get('materials/items')
  picker(@ActorId() actorId: string, @Query() query: Record<string, unknown>) {
    return this.reader.picker(actorId, query ?? {});
  }

  /** The access decision: a signed URL to play one item. */
  @Requires('materials.view')
  @Post('materials/items/:id/open')
  open(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.reader.open(actorId, id, body ?? {});
  }

  @Requires('materials.view')
  @Post('materials/recitations/:surah/open')
  openRecitation(@ActorId() actorId: string, @Param('surah') surah: string) {
    return this.reader.openRecitation(actorId, surah);
  }

  @Requires('materials.view')
  @Get('learners/:id/materials/library')
  library(@ActorId() actorId: string, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.reader.library(actorId, id, query ?? {});
  }

  @Requires('materials.view')
  @Get('learners/:id/materials/practice')
  practice(@ActorId() actorId: string, @Param('id') id: string) {
    return this.reader.practice(actorId, id);
  }

  /** PD-29 amendment: what was opened for this child this academy week (Saturday to Friday). */
  @Requires('materials.view')
  @Get('learners/:id/materials/opened')
  opened(@ActorId() actorId: string, @Param('id') id: string) {
    return this.reader.opened(actorId, id);
  }

  /**
   * PD-29 amendment (2026-10-26): the memorization map left the product. Its
   * routes answer 410 Gone to every caller; its data (chat.memorization_mark)
   * is kept, append-only.
   */
  @Requires('materials.view')
  @Get('learners/:id/materials/progress')
  progress() {
    return retired();
  }

  @Requires('materials.view')
  @Get('learners/:id/materials/progress/:surah')
  history() {
    return retired();
  }

  @Requires('materials.view')
  @Post('learners/:id/materials/progress/:surah/correct')
  correct() {
    return retired();
  }
}

function retired(): never {
  throw new CommError(CommErrorCode.MATERIAL_RETIRED, 'the memorization map was retired', 410);
}
