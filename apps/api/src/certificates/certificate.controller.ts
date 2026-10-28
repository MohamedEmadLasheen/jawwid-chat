import { Body, Controller, Get, Post, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../communication/api/actor.decorator';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { CertificateService } from './certificate.service';
import { NotForStaff } from '../platform/permissions/route-access';

/**
 * PD-12's teacher surface, kept for the app: a teacher suggests a certificate
 * for one of their learners and reads what became of their suggestions. Since
 * PD-41 the staff side is the Certificates page (/certificates); the learner's
 * Operations supervisor decides each suggestion there.
 */
@Controller('learner-certificates')
@UseFilters(CommErrorFilter)
export class CertificateController {
  constructor(private readonly certificates: CertificateService) {}

  /** A teacher's own suggestions. */
  @NotForStaff()
  @Get()
  list(@ActorId() actorId: string, @Query('state') state?: string) {
    return this.certificates.listOwnSuggestions(actorId, { state });
  }

  /** The teacher's Certificate ticket: a suggestion. */
  @NotForStaff()
  @Post()
  request(@ActorId() actorId: string, @Body() body: Record<string, unknown>) {
    return this.certificates.suggest(actorId, body ?? {});
  }
}
