import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { PrismaIdentityService } from './identity.service';
import { SqlCoverageService } from './coverage.service';
import { PrismaAuditService } from './audit.service';
import { AuthorizationService } from './authorization.service';
import { AppConfigService } from './app-config.service';
import { AUDIT_SERVICE, COVERAGE_SERVICE, IDENTITY_SERVICE } from './tokens';
import { AuthenticationService } from './auth/authentication.service';
import { AuthenticatedGuard } from './auth/authenticated.guard';

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
    AuthenticationService,
    // Registered globally: every controller is authenticated unless it is a
    // /health probe or explicitly @Public(). Opting a route in cannot be
    // forgotten, because nothing has to be added per controller.
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
    { provide: IDENTITY_SERVICE, useClass: PrismaIdentityService },
    { provide: COVERAGE_SERVICE, useClass: SqlCoverageService },
    { provide: AUDIT_SERVICE, useClass: PrismaAuditService },
  ],
  exports: [
    PrismaService,
    AppConfigService,
    AuthorizationService,
    AuthenticationService,
    IDENTITY_SERVICE,
    COVERAGE_SERVICE,
    AUDIT_SERVICE,
  ],
})
export class PlatformModule {}
