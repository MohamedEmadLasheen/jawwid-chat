import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthenticatedGuard } from './auth.guard';
import { AuthController, MeController } from './auth.controller';
import { AuthErrorFilter } from './auth.errors';

/**
 * Runtime authentication (PR-B).
 *
 * The guard is registered as APP_GUARD, which is the whole security posture in
 * one line: every route in every module is protected unless it declares
 * `@Public()`. Registering it per-controller would leave the next controller
 * somebody adds unauthenticated, and "remember to add the guard" is not a
 * control.
 *
 * PlatformModule is @Global, so PrismaService and IDENTITY_SERVICE are
 * available here without an import cycle.
 */
@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: AuthenticatedGuard },
    { provide: APP_FILTER, useClass: AuthErrorFilter },
  ],
  exports: [AuthService],
})
export class AuthModule {}
