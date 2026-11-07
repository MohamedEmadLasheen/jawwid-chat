/**
 * PD-58 (roadmap §7.4): LegalGuard -- where it sits among the global guards,
 * and what it decides. The decisions themselves (which documents, which
 * versions) run against the real database in pd058-legal.spec.ts.
 */
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { MODULE_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthenticatedGuard } from '@platform/auth/auth.guard';
import { PermissionGuard } from '@platform/permissions/permission.guard';
import { ActionThrottleGuard } from '@platform/auth/action-throttle.guard';
import { AuthError } from '@platform/auth/auth.errors';
import { CommError, CommErrorCode } from '@platform/errors';
import { LegalGuard } from '../../../src/legal/legal.guard';
import { RequiresLegal } from '../../../src/legal/requires-legal.decorator';
import { REPORT_REASONS } from '../../../src/moderation/dto';
import { LegalService, type LegalStatus } from '../../../src/legal/legal.service';

class Routes {
  @RequiresLegal()
  send(): void {}
  @RequiresLegal({ except: 'child_safety_report' })
  report(): void {}
  read(): void {}
}

function context(handler: keyof Routes, request: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const status = (over: Partial<LegalStatus>): LegalStatus => ({ kind: 'family', documents: [], required: [], misconfigured: [], ...over });

function service(answer: LegalStatus | null) {
  const svc = Object.create(LegalService.prototype) as LegalService;
  const calls = { n: 0 };
  (svc as unknown as { statusOf: () => Promise<LegalStatus | null> }).statusOf = async () => {
    calls.n++;
    return answer;
  };
  return { svc, calls };
}

describe('PD-58: LegalGuard', () => {
  it('is a global guard AFTER AuthenticatedGuard and PermissionGuard, BEFORE the action throttle', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule) as Array<{ provide?: unknown; useClass?: unknown }>;
    const guards = providers.filter((p) => p && p.provide === APP_GUARD).map((p) => p.useClass);
    expect(guards).toEqual([AuthenticatedGuard, PermissionGuard, LegalGuard, ActionThrottleGuard]);
  });

  it('passes an ungated route without asking the database', async () => {
    const { svc, calls } = service(status({ required: [{ documentKey: 'terms_family', version: 'qa-v1', urlAr: 'x', urlEn: 'y' }] }));
    await expect(new LegalGuard(svc, new Reflector()).canActivate(context('read', { accountId: 'a' }))).resolves.toBe(true);
    expect(calls.n).toBe(0);
  });

  it('refuses a gated route with 403 TERMS_NOT_ACCEPTED while anything is outstanding, naming it', async () => {
    const required = [{ documentKey: 'code_of_conduct' as const, version: 'qa-v2', urlAr: 'x', urlEn: 'y' }];
    const { svc } = service(status({ required }));
    const refusal = await new LegalGuard(svc, new Reflector()).canActivate(context('send', { accountId: 'a' })).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(CommError);
    expect(refusal).toMatchObject({ code: CommErrorCode.TERMS_NOT_ACCEPTED, status: 403, detail: { required } });
  });

  it('passes a gated route once everything is accepted, and reads the status once per request', async () => {
    const { svc, calls } = service(status({}));
    const guard = new LegalGuard(svc, new Reflector());
    const request = { accountId: 'a' };
    await expect(guard.canActivate(context('send', request))).resolves.toBe(true);
    await expect(guard.canActivate(context('send', request))).resolves.toBe(true);
    expect(calls.n).toBe(1);
  });

  it('LD-11: a child-safety report passes without acceptance, without asking the database; every other reason is refused', async () => {
    expect(REPORT_REASONS).toContain('child_safety');
    const required = [{ documentKey: 'terms_family' as const, version: 'qa-v1', urlAr: 'x', urlEn: 'y' }];
    const { svc, calls } = service(status({ required }));
    const guard = new LegalGuard(svc, new Reflector());
    await expect(guard.canActivate(context('report', { accountId: 'a', body: { reason: 'child_safety' } }))).resolves.toBe(true);
    expect(calls.n).toBe(0);
    for (const body of [
      ...REPORT_REASONS.filter((r) => r !== 'child_safety').map((reason) => ({ reason })),
      { reason: 'CHILD_SAFETY' },
      { reason: ['child_safety'] },
      { reasons: 'child_safety' },
      [{ reason: 'child_safety' }],
      null,
      undefined,
    ]) {
      await expect(guard.canActivate(context('report', { accountId: 'a', body }))).rejects.toMatchObject({ code: CommErrorCode.TERMS_NOT_ACCEPTED });
    }
    // The exemption is only where the route names it.
    await expect(guard.canActivate(context('send', { accountId: 'a', body: { reason: 'child_safety' } }))).rejects.toMatchObject({
      code: CommErrorCode.TERMS_NOT_ACCEPTED,
    });
    // And never without an account.
    await expect(guard.canActivate(context('report', { body: { reason: 'child_safety' } }))).rejects.toBeInstanceOf(AuthError);
  });

  it('fails closed: no account is 401, an unknown account 403, an undecidable configuration 503', async () => {
    await expect(new LegalGuard(service(status({})).svc, new Reflector()).canActivate(context('send', {}))).rejects.toBeInstanceOf(AuthError);
    await expect(new LegalGuard(service(null).svc, new Reflector()).canActivate(context('send', { accountId: 'a' }))).rejects.toMatchObject({
      code: CommErrorCode.TERMS_NOT_ACCEPTED,
    });
    await expect(
      new LegalGuard(service(status({ misconfigured: ['terms_family'] })).svc, new Reflector()).canActivate(context('send', { accountId: 'a' })),
    ).rejects.toMatchObject({ code: CommErrorCode.LEGAL_NOT_CONFIGURED, status: 503 });
  });
});
