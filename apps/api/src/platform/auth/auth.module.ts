import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { SessionService } from './session.service';
import { ThrottleService } from './throttle.service';
import { AuthGuard } from './auth.guard';
import { AuthController, MeController } from './auth.controller';
import { ActorContextInterceptor } from './actor-context.interceptor';

/**
 * Authentication and session management.
 *
 * APP_GUARD makes AuthGuard global: every route is authenticated unless it
 * declares @Public(). Health endpoints are public because a load balancer has
 * no session; login, refresh and the password-reset pair are public because
 * they are how you get one.
 *
 * APP_INTERCEPTOR then runs every authenticated request inside its actor's
 * database context. Nest runs interceptors after guards, so the identity is
 * already verified; a public route has no actor and runs outside a context,
 * which is what lets login read chat.account before an organization is known.
 */
@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    AccountService,
    SessionService,
    ThrottleService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ActorContextInterceptor },
  ],
  exports: [AuthService, AccountService, SessionService, ThrottleService],
})
export class AuthModule {}
