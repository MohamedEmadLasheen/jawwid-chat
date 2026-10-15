/**
 * C2 -- AuthorizationService.listScope: the list form of the scoped read
 * decision. Pure. Its refusals must be exactly the ones the pre-C2 list gave
 * (the legacy canRead probe) -- same code, same message -- and its scopes must
 * follow canRead's scoped branches. That the resulting QUERY returns exactly
 * what canReadResolved allows is proven against a database in
 * test/integration/conversation-list-scope.spec.ts.
 */
import { CommErrorCode } from '@platform/errors';
import { SYSTEM_ACTOR, type Actor } from '@platform/types';
import {
  admin,
  academicStaff,
  authzWithOnDuty,
  conversation,
  financeStaff,
  manager,
  parent,
  teacher,
} from '../../support/fixtures';

const authz = authzWithOnDuty();
const ORG = 'org-1';

const coverage = (id = 'coverage-1') => admin(id, 'coverage');
const superAdmin = (id = 'super-1') => admin(id, 'super_admin');
const technicalStaff = (id = 'technical-1') => admin(id, 'technical');
const inactive = (a: Actor): Actor => ({ ...a, isActive: false });
const withoutOrg = (a: Actor): Actor => ({ ...a, organizationId: undefined });

describe('listScope: scopes follow canRead', () => {
  it('manager -> the whole of their own organization', () => {
    expect(authz.listScope(manager())).toEqual({
      allowed: true,
      scope: { kind: 'organization', organizationId: ORG },
    });
  });

  it('admin -> staff scope WITH ownership', () => {
    expect(authz.listScope(admin('a-1'))).toEqual({
      allowed: true,
      scope: { kind: 'staff', organizationId: ORG, actorId: 'a-1', ownership: true },
    });
  });

  it('coverage -> staff scope WITHOUT ownership (decision U2)', () => {
    expect(authz.listScope(coverage('c-1'))).toEqual({
      allowed: true,
      scope: { kind: 'staff', organizationId: ORG, actorId: 'c-1', ownership: false },
    });
  });

  it.each([
    ['parent', parent('p-1')],
    ['teacher', teacher('t-1')],
  ])('%s -> live membership, inside their organization', (_n, a) => {
    expect(authz.listScope(a)).toEqual({
      allowed: true,
      scope: { kind: 'member', organizationId: ORG, actorId: a.actorId },
    });
  });

  it('no organization -> nothing (never "no filter")', () => {
    for (const a of [manager(), admin(), coverage(), parent(), teacher()]) {
      expect(authz.listScope(withoutOrg(a))).toEqual({ allowed: true, scope: { kind: 'none' } });
    }
  });

  it('SYSTEM -> nothing (not reachable over HTTP)', () => {
    expect(authz.listScope(SYSTEM_ACTOR)).toEqual({ allowed: true, scope: { kind: 'none' } });
  });
});

describe('listScope: refusals are the pre-C2 list refusals, verbatim', () => {
  // The pre-C2 list refused staff through the legacy canRead probe on a
  // throw-away conversation. Same actor -> same code and message.
  const probe = conversation({ organizationId: ORG, familyId: null });

  it.each([
    ['super_admin', superAdmin()],
    ['finance', financeStaff()],
    ['technical', technicalStaff()],
    ['academic', academicStaff()],
    ['inactive admin', inactive(admin())],
    ['inactive manager', inactive(manager())],
  ])('%s', (_n, a) => {
    const legacy = authz.canRead(a, probe, null);
    expect(legacy.allowed).toBe(false);
    const listed = authz.listScope(a);
    expect(listed).toEqual({
      allowed: false,
      code: (legacy as { code: CommErrorCode }).code,
      reason: (legacy as { reason: string }).reason,
    });
  });

  it('an inactive parent or teacher is refused as inactive (C1 alignment; unreachable over HTTP)', () => {
    for (const a of [inactive(parent()), inactive(teacher())]) {
      expect(authz.listScope(a)).toEqual({
        allowed: false,
        code: CommErrorCode.ACTOR_INACTIVE,
        reason: 'actor is inactive',
      });
    }
  });
});

describe('the coverage engine production binds can list', () => {
  it('PlatformModule binds COVERAGE_SERVICE to SqlCoverageService, which implements familiesOnDutyFor', async () => {
    const { PlatformModule } = await import('@platform/platform.module');
    const { COVERAGE_SERVICE } = await import('@platform/tokens');
    const { SqlCoverageService } = await import('@platform/coverage.service');
    const providers = Reflect.getMetadata('providers', PlatformModule) as Array<{ provide?: unknown; useClass?: unknown }>;
    const binding = providers.filter((p) => p && p.provide === COVERAGE_SERVICE);
    expect(binding).toHaveLength(1);
    expect(binding[0].useClass).toBe(SqlCoverageService);
    expect(typeof SqlCoverageService.prototype.familiesOnDutyFor).toBe('function');
  });
});

describe('a coverage engine that cannot list stops the application at startup', () => {
  // Only ConversationService is real here; its collaborators are inert stubs
  // because startup is all that is exercised.
  async function boot(coverage: unknown) {
    const { Test } = await import('@nestjs/testing');
    const { ConversationService } = await import('@communication/conversations/conversation.service');
    const { PrismaService } = await import('@platform/prisma.service');
    const { AuthorizationService } = await import('@platform/authorization.service');
    const { OutboxService } = await import('@communication/outbox/outbox.service');
    const tokens = await import('@platform/tokens');
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: PrismaService, useValue: {} },
        { provide: AuthorizationService, useValue: {} },
        { provide: OutboxService, useValue: {} },
        { provide: tokens.IDENTITY_SERVICE, useValue: {} },
        { provide: tokens.COVERAGE_SERVICE, useValue: coverage },
        { provide: tokens.AUDIT_SERVICE, useValue: {} },
        { provide: tokens.RELATIONSHIP_SERVICE, useValue: {} },
      ],
    }).compile();
    await moduleRef.init();
    return moduleRef;
  }

  it('an engine with onDuty only is refused by Nest init', async () => {
    await expect(boot({ onDuty: async () => null })).rejects.toThrow('cannot list on-duty families');
  });

  it('an engine that can list starts', async () => {
    const moduleRef = await boot({ onDuty: async () => null, familiesOnDutyFor: async () => [] });
    await moduleRef.close();
  });
});
