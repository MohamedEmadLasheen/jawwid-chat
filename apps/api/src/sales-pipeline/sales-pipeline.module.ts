import { Module } from '@nestjs/common';
import { SalesPipelineController } from './sales-pipeline.controller';
import { SalesPipelineService } from './sales-pipeline.service';

/**
 * PD-59: the Sales pipeline. The ONLY module that may read chat.sales_lead_contact,
 * which holds a prospective parent's phone, WhatsApp number and e-mail (G-07;
 * sales-pipeline-confinement.spec.ts). PlatformModule is @Global (Prisma, audit,
 * config).
 */
@Module({
  controllers: [SalesPipelineController],
  providers: [SalesPipelineService],
})
export class SalesPipelineModule {}
