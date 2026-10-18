import { Module } from '@nestjs/common';
import { OBJECT_STORAGE } from '../platform/tokens';
import { selectObjectStorage } from '../communication/attachments/storage.provider';
import { SupervisionModule } from '../supervision/supervision.module';
import { CommunicationModule } from '../communication/communication.module';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';

/**
 * PD-12 S1: student certificates. OBJECT_STORAGE is selected by the same factory
 * CommunicationModule uses, so a certificate lands in the same bucket, under the
 * same key rules, as every other attachment.
 */
@Module({
  imports: [CommunicationModule, SupervisionModule],
  controllers: [CertificateController],
  providers: [CertificateService, { provide: OBJECT_STORAGE, useFactory: () => selectObjectStorage().storage }],
})
export class CertificateModule {}
