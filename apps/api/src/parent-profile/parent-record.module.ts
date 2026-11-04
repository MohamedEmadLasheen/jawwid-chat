import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { ParentRecordController } from './parent-record.controller';
import { ParentRecordService } from './parent-record.service';
import { ParentPhoneDirectory } from './parent-phone-directory';
import { MyLocationController } from './my-location.controller';
import { MyLocationService } from './my-location.service';

/**
 * PD-17: the Parent Profile (`/parent-profiles`), administration only. The only
 * module that may name chat.parent_file (parent-file-confinement.spec.ts).
 * PD-45 PR-4: and the parent's own family location (`/me/location`), which reads
 * the parent's number here only to suggest a country.
 */
@Module({
  imports: [CommunicationModule],
  controllers: [ParentRecordController, MyLocationController],
  // PD-25: the forgot-e-mail flow finds a parent by the phone on file, here.
  providers: [ParentRecordService, ParentPhoneDirectory, MyLocationService],
  // PD-44: the Dashboard's Payments section counts the Parents list's filters.
  exports: [ParentPhoneDirectory, ParentRecordService],
})
export class ParentRecordModule {}
