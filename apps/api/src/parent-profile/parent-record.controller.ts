import { Body, Controller, Delete, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ParentRecordService } from './parent-record.service';

/**
 * PD-17 Parent Profile, administration only. Every route is behind the global
 * bearer guard; who may do what is decided in ParentRecordService (the
 * Instalment Payments rule), never here -- a teacher is refused by every route.
 * The parent's own profile stays `/me/profile`. POST for updates: the shared
 * admin-web client has no PUT.
 */
@Controller('parent-profiles')
@UseFilters(CommErrorFilter)
export class ParentRecordController {
  constructor(private readonly parents: ParentRecordService) {}

  /** ?q= -- the parents this staff member may open. */
  @Get()
  list(@ActorId() actorId: string, @Query('q') q?: string) {
    return this.parents.list(actorId, q);
  }

  @Get(':contactId')
  detail(@ActorId() actorId: string, @Param('contactId') contactId: string) {
    return this.parents.detail(actorId, contactId);
  }

  /** { name?, phone?, email?, countryCode?, region?, adminNote? } -- partial; null clears. */
  @Post(':contactId')
  update(@ActorId() actorId: string, @Param('contactId') contactId: string, @Body() body: Record<string, unknown>) {
    return this.parents.update(actorId, contactId, body ?? {});
  }

  /** Step 1 of a photo change: { mimeType, byteSize } -> a short-lived PUT URL. */
  @Post(':contactId/avatar/upload')
  authorizePhotoUpload(@ActorId() actorId: string, @Param('contactId') contactId: string, @Body() body: Record<string, unknown>) {
    return this.parents.authorizePhotoUpload(actorId, contactId, body ?? {});
  }

  /** Step 2: { objectKey } -- the stored bytes are judged before the photo changes. */
  @Post(':contactId/avatar')
  commitPhoto(@ActorId() actorId: string, @Param('contactId') contactId: string, @Body() body: Record<string, unknown>) {
    return this.parents.commitPhoto(actorId, contactId, body ?? {});
  }

  @Delete(':contactId/avatar')
  removePhoto(@ActorId() actorId: string, @Param('contactId') contactId: string) {
    return this.parents.removePhoto(actorId, contactId);
  }
}
