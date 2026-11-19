import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import type { AuthenticatedRequest } from '../platform/auth/auth.guard';
import { LegalService, type LegalStatus } from './legal.service';
import { REQUIRES_LEGAL, REQUIRES_LEGAL_EXCEPT, isExempt, type LegalExemption } from './requires-legal.decorator';

/** The status, computed once per request and kept on it. */
interface LegalRequest extends AuthenticatedRequest {
  legalStatus?: LegalStatus | null;
  /** The parsed JSON body (Express parses it before any guard runs). */
  body?: unknown;
}

/**
 * PD-58 (roadmap §7.4): the Terms of Use gate. Global (AuthModule), registered
 * AFTER AuthenticatedGuard -- it reads the account that guard attached -- and
 * after PermissionGuard, BEFORE ActionThrottleGuard, so a refused request
 * spends no action budget. Only routes marked `@RequiresLegal()` are checked;
 * everything else passes untouched.
 *
 * Exemption (LD-11): a route marked `@RequiresLegal({ except:
 * 'child_safety_report' })` lets a child-safety report through.
 *
 * Fail closed: a gated route with no authenticated account is 401, an
 * unknown account or an undecidable configuration refuses (LegalService).
 */
@Injectable()
export class LegalGuard implements CanActivate {
  constructor(
    private readonly legal: LegalService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const gated = this.reflector.getAllAndOverride<boolean>(REQUIRES_LEGAL, [context.getHandler(), context.getClass()]);
    if (!gated) return true;

    const request = context.switchToHttp().getRequest<LegalRequest>();
    if (!request.accountId) throw new AuthError(AuthErrorCode.UNAUTHENTICATED);
    // LD-11: a child-safety report goes through without acceptance (the body
    // is parsed before guards run; the service still validates all of it).
    const exemption = this.reflector.getAllAndOverride<LegalExemption | undefined>(REQUIRES_LEGAL_EXCEPT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExempt(exemption, request.body)) return true;
    if (request.legalStatus === undefined) request.legalStatus = await this.legal.statusOf(request.accountId);
    this.legal.assertAccepted(request.legalStatus);
    return true;
  }
}
