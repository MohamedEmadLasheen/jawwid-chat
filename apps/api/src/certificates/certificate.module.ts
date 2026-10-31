import { Module } from '@nestjs/common';
import { OBJECT_STORAGE } from '../platform/tokens';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { AuthModule } from '../platform/auth/auth.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { CommunicationModule } from '../communication/communication.module';
import { CertificateController } from './certificate.controller';
import { CertificatesController } from './certificates.controller';
import { CertificateService } from './certificate.service';
import { CertificateTypeService } from './certificate-type.service';

/**
 * PD-12 / PD-41: appreciation certificates. OBJECT_STORAGE is selected by the
 * same factory CommunicationModule uses, so a certificate lands in the same
 * bucket, under the same key rules, as every other attachment. AuthModule
 * gives PermissionService (PD-40), the one answer to "what does this staff
 * member hold".
 */
@Module({
  imports: [CommunicationModule, SupervisionModule, AuthModule],
  controllers: [CertificateController, CertificatesController],
  providers: [CertificateService, CertificateTypeService, { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage }],
  // PD-44: the Dashboard's Teachers section counts this page's list.
  exports: [CertificateService],
})
export class CertificateModule {}
