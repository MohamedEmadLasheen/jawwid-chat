import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaIdentityService } from './identity.service';
import { ReferenceCoverageService } from './coverage.service';
import { PrismaAuditService } from './audit.service';
import { AuthorizationService } from './authorization.service';
import { AppConfigService } from './app-config.service';
import { AUDIT_SERVICE, COVERAGE_SERVICE, IDENTITY_SERVICE } from './tokens';

/**
 * Everything in this module is an AI #1 seam except AuthorizationService's
 * communication matrix, which AI #2 owns until AI #1 provides a superset.
 *
 * To swap in AI #1's real implementations, change only the `useClass` entries.
 * No communication-domain file imports a concrete platform class.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    AppConfigService,
    AuthorizationService,
    { provide: IDENTITY_SERVICE, useClass: PrismaIdentityService },
    { provide: COVERAGE_SERVICE, useClass: ReferenceCoverageService },
    { provide: AUDIT_SERVICE, useClass: PrismaAuditService },
  ],
  exports: [
    PrismaService,
    AppConfigService,
    AuthorizationService,
    IDENTITY_SERVICE,
    COVERAGE_SERVICE,
    AUDIT_SERVICE,
  ],
})
export class PlatformModule {}
