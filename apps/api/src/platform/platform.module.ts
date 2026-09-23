import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaIdentityService } from './identity.service';
import { SqlCoverageService } from './coverage.service';
import { PrismaAuditService } from './audit.service';
import { AuthorizationService } from './authorization.service';
import { AppConfigService } from './app-config.service';
import { PrismaRelationshipService } from './relationship.service';
import {
  AUDIT_SERVICE,
  COVERAGE_SERVICE,
  IDENTITY_SERVICE,
  RELATIONSHIP_SERVICE,
} from './tokens';

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
    AuthorizationService,
    { provide: IDENTITY_SERVICE, useClass: PrismaIdentityService },
    { provide: COVERAGE_SERVICE, useClass: SqlCoverageService },
    { provide: AUDIT_SERVICE, useClass: PrismaAuditService },
    // PD-6. Registered now and consumed by nobody yet: the authorization switch
    // that reads it lands in the next phase, once this predicate is proven.
    { provide: RELATIONSHIP_SERVICE, useClass: PrismaRelationshipService },
  ],
  exports: [
    PrismaService,
    AppConfigService,
    AuthorizationService,
    IDENTITY_SERVICE,
    COVERAGE_SERVICE,
    AUDIT_SERVICE,
    RELATIONSHIP_SERVICE,
  ],
})
export class PlatformModule {}
