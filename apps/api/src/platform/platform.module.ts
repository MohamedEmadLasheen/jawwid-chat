import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaIdentityService } from './identity.service';
import { SqlCoverageService } from './coverage.service';
import { PrismaAuditService } from './audit.service';
import { AuthorizationService } from './authorization.service';
import { AppConfigService } from './app-config.service';
import { ScopeService } from './scope.service';
import { AUDIT_SERVICE, COVERAGE_SERVICE, IDENTITY_SERVICE } from './tokens';

/**
 * Every provider here is an AI #1 seam, except AuthorizationService, whose
 * communication matrix AI #2 owns.
 *
 * To swap in AI #1's real implementations, change only the `useClass` entries.
 * No file under src/communication imports a concrete platform class.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    AppConfigService,
    ScopeService,
    AuthorizationService,
    { provide: IDENTITY_SERVICE, useClass: PrismaIdentityService },
    { provide: COVERAGE_SERVICE, useClass: SqlCoverageService },
    { provide: AUDIT_SERVICE, useClass: PrismaAuditService },
  ],
  exports: [
    PrismaService,
    AppConfigService,
    ScopeService,
    AuthorizationService,
    IDENTITY_SERVICE,
    COVERAGE_SERVICE,
    AUDIT_SERVICE,
  ],
})
export class PlatformModule {}
