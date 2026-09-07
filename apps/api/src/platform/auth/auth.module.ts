import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { SessionService } from './session.service';
import { ThrottleService } from './throttle.service';
import { AuthGuard } from './auth.guard';
import { ActionThrottleGuard } from './action-throttle.guard';
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
 * ActionThrottleGuard follows it, opt-in per route: authentication must be
 * default-on because a route nobody protected is a hole, and rate limiting must
 * be default-off because it costs a database round trip that paging through
 * message history should not pay.
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
    // AFTER AuthGuard, and the order is load-bearing: Nest runs APP_GUARDs in
    // registration order, so this one sees an actor the signed token already
    // established. Registered first it would count against an identity nothing
    // had verified -- which the caller picks, making the counter worthless.
    { provide: APP_GUARD, useClass: ActionThrottleGuard },
    { provide: APP_INTERCEPTOR, useClass: ActorContextInterceptor },
  ],
  exports: [AuthService, AccountService, SessionService, ThrottleService],
})
export class AuthModule {}
