import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module';
import { ParentRecordController } from './parent-record.controller';
import { ParentRecordService } from './parent-record.service';

/**
 * PD-17: the Parent Profile (`/parent-profiles`), administration only. The only
 * module that may name chat.parent_file (parent-file-confinement.spec.ts).
 */
@Module({
  imports: [CommunicationModule],
  controllers: [ParentRecordController],
  providers: [ParentRecordService],
})
export class ParentRecordModule {}
