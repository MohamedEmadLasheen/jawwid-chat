import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AuthController, MeController } from './auth.controller';

/**
 * Authentication (D-6). Owner: AI #1's domain, implemented by AI #7.
 *
 * APP_GUARD makes AuthGuard global: every route is authenticated unless it
 * declares @Public(). Health endpoints are public because a load balancer has
 * no session; login and refresh are public because they are how you get one.
 */
@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
