import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaIdentityService } from './identity.service';
import { SqlCoverageService } from './coverage.service';
import { PrismaAuditService } from './audit.service';
import { AuthorizationService } from './authorization.service';
import { AppConfigService } from './app-config.service';
import { PrismaRelationshipService } from './relationship.service';
import { RealtimeRevocationHub } from './realtime-revocation';
import { SqlStaffScope } from './staff-scope';
import { TimeZoneService } from './time-zone.service';
import { SqlSubscriptionLock } from './subscription-lock';
import { TeacherScopeService } from './teacher-scope';
import {
  AUDIT_SERVICE,
  COVERAGE_SERVICE,
  IDENTITY_SERVICE,
  REALTIME_REVOCATION,
  RELATIONSHIP_SERVICE,
  STAFF_SCOPE,
  SUBSCRIPTION_LOCK,
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
    // PD-35: which teachers a Teachers-department member works on (and the switch).
    TeacherScopeService,
    PrismaService,
    AppConfigService,
    AuthorizationService,
    // PD-22. Each person's zone; read by notifications, cards and Admin Web views.
    TimeZoneService,
    { provide: IDENTITY_SERVICE, useClass: PrismaIdentityService },
    { provide: COVERAGE_SERVICE, useClass: SqlCoverageService },
    { provide: AUDIT_SERVICE, useClass: PrismaAuditService },
    // PD-8. The staff conversation scope; the rule itself is SQL.
    { provide: STAFF_SCOPE, useClass: SqlStaffScope },
    // PD-30. Whether a child's group is locked for payment; the state is SQL.
    { provide: SUBSCRIPTION_LOCK, useClass: SqlSubscriptionLock },
    // PD-6. The ONE place the teacher<->parent relationship is resolved.
    // ConversationService, MessageService and CallService read it through this
    // token and hand the resolved boolean to AuthorizationService, which stays
    // database-free. Nothing else may answer this question.
    { provide: RELATIONSHIP_SERVICE, useClass: PrismaRelationshipService },
    // RT-009. One hub per process: services push revocations into it, and the
    // RealtimeGateway (API process only) attaches itself to carry them out.
    RealtimeRevocationHub,
    { provide: REALTIME_REVOCATION, useExisting: RealtimeRevocationHub },
  ],
  exports: [
    TeacherScopeService,
    PrismaService,
    AppConfigService,
    AuthorizationService,
    TimeZoneService,
    IDENTITY_SERVICE,
    COVERAGE_SERVICE,
    AUDIT_SERVICE,
    RELATIONSHIP_SERVICE,
    STAFF_SCOPE,
    SUBSCRIPTION_LOCK,
    RealtimeRevocationHub,
    REALTIME_REVOCATION,
  ],
})
export class PlatformModule {}
