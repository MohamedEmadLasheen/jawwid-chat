import { Global, Module } from '@nestjs/common';
import { PrismaService, withRequestScopedTransaction } from './prisma.service';
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
    // The client every service injects is the request-scoped PROXY: inside a
    // request its queries land on that request's transaction, and therefore
    // inside the actor context RLS reads. Outside one -- the worker, a
    // migration, a unit test -- every call goes straight to the real client and
    // nothing about those paths changes.
    //
    // runWithActor is always bound to the real client, so the interceptor
    // opening a transaction through the proxy does not flatten it into itself.
    {
      provide: PrismaService,
      useFactory: () => withRequestScopedTransaction(new PrismaService()),
    },
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
