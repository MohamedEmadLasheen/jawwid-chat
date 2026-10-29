import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { Requires } from '../platform/permissions/route-access';
import { CertificateService } from './certificate.service';
import { CertificateTypeService } from './certificate-type.service';

/**
 * PD-41: the Certificates page. Each route names the key a staff caller needs
 * (PermissionGuard); who may do what to WHICH certificate is decided by
 * CertificateService on the locked row and re-decided by the database. POST
 * for every change: the shared Admin Web client has no PUT.
 *
 * The routes a Designer reaches are exactly those that accept
 * certificates.view or certificates.design (pd040-route-permissions.spec.ts).
 */
@Controller('certificates')
@UseFilters(CommErrorFilter)
export class CertificatesController {
  constructor(
    private readonly certificates: CertificateService,
    private readonly types: CertificateTypeService,
  ) {}

  // -- the page ------------------------------------------------------------

  @Requires('certificates.view')
  @Get('access')
  access(@ActorId() actorId: string) {
    return this.certificates.access(actorId);
  }

  @Requires('certificates.view')
  @Get('types')
  listTypes(@ActorId() actorId: string, @Query('category') category?: string, @Query('includeDisabled') includeDisabled?: string) {
    return this.types.list(actorId, { category, includeDisabled });
  }

  @Requires('certificates.types')
  @Post('types')
  createType(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.types.create(actorId, body ?? {});
  }

  @Requires('certificates.types')
  @Post('types/:id')
  updateType(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.types.update(actorId, id, body ?? {});
  }

  @Requires('certificates.request.student', 'certificates.request.teacher')
  @Get('recipients')
  recipients(@ActorId() actorId: string, @Query('category') category?: string, @Query('q') q?: string) {
    return this.certificates.recipients(actorId, { category, q });
  }

  @Requires('certificates.view')
  @Get()
  list(
    @ActorId() actorId: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.certificates.list(actorId, { category, status, q, cursor });
  }

  @Requires('certificates.request.student', 'certificates.request.teacher')
  @Post()
  create(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.certificates.create(actorId, body ?? {});
  }

  @Requires('certificates.view')
  @Get(':id')
  get(@ActorId() actorId: string, @Param('id') id: string) {
    return this.certificates.get(actorId, id);
  }

  // -- the requester -------------------------------------------------------

  @Requires('certificates.request.student', 'certificates.request.teacher')
  @Post(':id/edit')
  edit(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.edit(actorId, id, body ?? {});
  }

  @Requires('certificates.request.student', 'certificates.request.teacher')
  @Post(':id/resubmit')
  resubmit(@ActorId() actorId: string, @Param('id') id: string) {
    return this.certificates.resubmit(actorId, id);
  }

  @Requires('certificates.request.student', 'certificates.request.teacher', 'certificates.oversee')
  @Post(':id/cancel')
  cancel(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.cancel(actorId, id, body ?? {});
  }

  @Requires('certificates.request.student', 'certificates.request.teacher')
  @Post(':id/approve')
  approve(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.approve(actorId, id, body ?? {});
  }

  @Requires('certificates.request.student', 'certificates.request.teacher')
  @Post(':id/redesign')
  redesign(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.redesign(actorId, id, body ?? {});
  }

  @Requires('certificates.request.student', 'certificates.request.teacher')
  @Post(':id/withdraw-approval')
  withdrawApproval(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.withdrawApproval(actorId, id, body ?? {});
  }

  @Requires('certificates.request.student')
  @Post(':id/accept')
  accept(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.accept(actorId, id, body ?? {});
  }

  @Requires('certificates.request.student')
  @Post(':id/decline')
  decline(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.decline(actorId, id, body ?? {});
  }

  @Requires('certificates.deliver')
  @Get(':id/delivery')
  delivery(@ActorId() actorId: string, @Param('id') id: string) {
    return this.certificates.deliveryTarget(actorId, id);
  }

  @Requires('certificates.deliver')
  @Post(':id/send')
  send(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.send(actorId, id, body ?? {});
  }

  @Requires('certificates.story')
  @Post(':id/consent')
  consent(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.recordConsent(actorId, id, body ?? {});
  }

  @Requires('certificates.story')
  @Post(':id/story')
  story(@ActorId() actorId: string, @Param('id') id: string) {
    return this.certificates.publishStory(actorId, id);
  }

  // -- the Designer --------------------------------------------------------

  @Requires('certificates.design')
  @Post(':id/start')
  start(@ActorId() actorId: string, @Param('id') id: string) {
    return this.certificates.start(actorId, id);
  }

  @Requires('certificates.design')
  @Post(':id/return')
  returnForChanges(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.returnForChanges(actorId, id, body ?? {});
  }

  @Requires('certificates.design', 'certificates.oversee')
  @Post(':id/release')
  release(@ActorId() actorId: string, @Param('id') id: string) {
    return this.certificates.release(actorId, id);
  }

  @Requires('certificates.design')
  @Post(':id/files/upload')
  authorizeUpload(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.authorizeUpload(actorId, id, body ?? {});
  }

  @Requires('certificates.design')
  @Post(':id/files')
  confirmUpload(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.confirmUpload(actorId, id, body ?? {});
  }

  @Requires('certificates.view')
  @Get(':id/files/:fileId')
  file(@ActorId() actorId: string, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.certificates.fileUrl(actorId, id, fileId);
  }
}
