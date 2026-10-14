import { Module } from '@nestjs/common';
import { OBJECT_STORAGE } from '../platform/tokens';
import { PrismaService } from '../platform/prisma.service';
import { ActorScopedDatabase } from '../platform/actor-database';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { StaffProfileController } from './staff-profile.controller';
import { StaffProfileService } from './staff-profile.service';
import { StaffWorkloadService } from './staff-workload.service';

/**
 * Staff profiles. PlatformModule is @Global, so Prisma, AuthorizationService
 * and the audit seam arrive without an import; AuthModule's global guard
 * already protects every route declared here.
 *
 * OBJECT_STORAGE is selected by the same factory CommunicationModule uses, so
 * this module writes to exactly the bucket (or local root) attachments and
 * stories use -- one storage, one set of signing rules, no second pipeline.
 *
 * ActorScopedDatabase is the restricted runtime path: with DATABASE_APP_URL set,
 * every profile request runs on chat_app inside a trusted actor context;
 * without it, on the owner connection as the rest of the API does.
 */
@Module({
  controllers: [StaffProfileController],
  providers: [
    StaffProfileService,
    StaffWorkloadService,
    { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage },
    { provide: ActorScopedDatabase, useFactory: (prisma: PrismaService) => new ActorScopedDatabase(prisma), inject: [PrismaService] },
  ],
})
export class StaffProfileModule {}
