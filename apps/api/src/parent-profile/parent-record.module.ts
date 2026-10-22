import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { ParentRecordController } from './parent-record.controller';
import { ParentRecordService } from './parent-record.service';
import { ParentPhoneDirectory } from './parent-phone-directory';

/**
 * PD-17: the Parent Profile (`/parent-profiles`), administration only. The only
 * module that may name chat.parent_file (parent-file-confinement.spec.ts).
 */
@Module({
  imports: [CommunicationModule],
  controllers: [ParentRecordController],
  // PD-25: the forgot-e-mail flow finds a parent by the phone on file, here.
  providers: [ParentRecordService, ParentPhoneDirectory],
  exports: [ParentPhoneDirectory],
})
export class ParentRecordModule {}
