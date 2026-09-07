import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { AuthController, MeController } from './auth.controller';

/**
 * Authentication and session management.
 *
 * APP_GUARD makes AuthGuard global: every route is authenticated unless it
 * declares @Public(). Health endpoints are public because a load balancer has
 * no session; login, refresh and the password-reset pair are public because
 * they are how you get one.
 */
@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, AccountService, SessionService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, AccountService, SessionService],
})
export class AuthModule {}
