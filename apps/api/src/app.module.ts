import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
import { AuthModule } from './platform/auth/auth.module';
import { CommunicationModule } from './communication/communication.module';
import { HealthModule } from './infra/health/health.module';
import { AdminModule } from './admin/admin.module';
import { StaffProfileModule } from './staff-profile/staff-profile.module';

/**
 * The root module. Composition only -- it declares no provider and no
 * controller of its own.
 *
 * PlatformModule (AI #1) is @Global and supplies identity, authorization,
 * coverage, audit and Prisma. CommunicationModule (AI #2) owns every HTTP
 * controller, the realtime gateway and the outbox worker. HealthModule (AI #7)
 * adds the probes the runtime needs. AdminModule is the Admin Portal's
 * read-only `/admin` inspection surface (super admin only).
 * StaffProfileModule serves `/staff-profiles` (profiles, responsibilities,
 * teams, the super admin's organization overview).
 *
 * AuthModule (PR-B) registers the global AuthenticatedGuard, so importing it
 * here protects EVERY route in every other module at once. That is deliberate:
 * a guard opted into per-controller leaves the next controller unauthenticated
 * until somebody remembers.
 *
 * Adding a feature means adding its module here, not adding code here.
 */
@Module({
  imports: [PlatformModule, AuthModule, CommunicationModule, HealthModule, AdminModule, StaffProfileModule],
})
export class AppModule {}
