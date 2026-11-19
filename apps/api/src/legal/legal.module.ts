import { Module } from '@nestjs/common';
import { LegalController, SignupLegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * PD-58 Terms of Use (owner decision A-3; roadmap 2026-11-03 §7). Imported by
 * AuthModule, which registers LegalGuard globally in its guard order and hands
 * LegalService to /me, login, refresh and the PD-16 sign-up.
 */
@Module({
  controllers: [LegalController, SignupLegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
