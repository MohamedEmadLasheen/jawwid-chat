import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { CertificateService } from './certificate.service';
import { NotForStaff, Requires } from '../platform/permissions/route-access';

/**
 * PD-12 student certificates. Behind the global bearer guard; who may do what is
 * decided in CertificateService (pd012-policy), never here. POST for every
 * change: the shared admin-web client has no PUT.
 */
@Controller('learner-certificates')
@UseFilters(CommErrorFilter)
export class CertificateController {
  constructor(private readonly certificates: CertificateService) {}

  @Requires('certificates.view')
  @Get()
  list(@ActorId() actorId: string, @Query('state') state?: string) {
    return this.certificates.list(actorId, { state });
  }

  /** The teacher's Certificate ticket. */
  @NotForStaff()
  @Post()
  request(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.certificates.request(actorId, body ?? {});
  }

  @Requires('certificates.deliver')
  @Post(':id/upload')
  authorizeUpload(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.authorizeUpload(actorId, id, body ?? {});
  }

  @Requires('certificates.deliver')
  @Post(':id/issue')
  issue(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.issue(actorId, id, body ?? {});
  }

  @Requires('certificates.decline')
  @Post(':id/decline')
  decline(@ActorId() actorId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.certificates.decline(actorId, id, body ?? {});
  }
}
