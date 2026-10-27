/**
 * PD-36 x PD-35 -- the 'mention' seat policy. A seat is taken on a mention only
 * with an OPEN summons of the joiner here AND PD-8 standing of their own (which
 * no seat supplies). Losing standing voids the summons on the way out. The
 * policy replaces PD-35's refusing placeholder when the module starts.
 */
import { CommErrorCode } from '@platform/errors';
import type { Actor } from '@platform/types';
import { MentionService } from '@communication/mentions/mention.service';
import { SeatPolicyRegistry, SeatReason, type SeatTarget } from '@communication/seats/seat-policy';

const NOW = new Date('2026-10-26T12:00:00Z');
const MANAGER = { actorId: 'staff-mgr', kind: 'staff', displayName: 'Manager', locale: 'en', isActive: true } as unknown as Actor;
const GROUP: SeatTarget = { id: 'conv-1', organizationId: 'org-1', type: 'family_group', familyId: 'fam-1', learnerId: null };

function build(open: { id: string } | null) {
  const calls: Array<{ where: unknown }> = [];
  const moved: string[] = [];
  const tx = {
    messageMention: {
      updateMany: jest.fn(async (args: { where: { id: string }; data: { state: string } }) => {
        moved.push(`${args.where.id}->${args.data.state}`);
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async () => ({ id: open?.id, conversationId: GROUP.id, targetActorId: MANAGER.actorId })),
    },
  };
  const prisma = {
    messageMention: {
      findFirst: jest.fn(async (args: { where: unknown }) => {
        calls.push(args);
        return open;
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const outbox = { enqueue: jest.fn(async () => undefined) };
  const registry = new SeatPolicyRegistry();
  const service = new MentionService(
    prisma as never,
    {} as never,
    outbox as never,
    {} as never,
    {} as never,
    {} as never,
    registry,
  );
  return { service, registry, calls, moved, outbox };
}

describe("the 'mention' seat policy", () => {
  it('replaces the placeholder when the module starts', () => {
    const { service, registry } = build(null);
    registry.register({ reason: SeatReason.MENTION, placeholder: true, canJoin: () => ({ allowed: false, code: CommErrorCode.SEAT_NOT_ELIGIBLE, reason: 'x' }) });
    service.onModuleInit();
    expect(registry.get(SeatReason.MENTION)?.placeholder).toBeFalsy();
  });

  it('allows an open summons with standing, and asks for exactly that summons when the client names it', async () => {
    const { service, calls } = build({ id: 'mn-1' });
    const d = await service.canJoin(MANAGER, GROUP, { sourceId: 'mn-1', standing: 'manager' as never, now: NOW });
    expect(d.allowed).toBe(true);
    expect(calls[0]).toMatchObject({
      where: { conversationId: 'conv-1', targetActorId: 'staff-mgr', isSummons: true, state: 'pending', expiresAt: { gt: NOW }, id: 'mn-1' },
    });
  });

  it('refuses with no open summons (none, answered, or expired)', async () => {
    const { service } = build(null);
    const d = await service.canJoin(MANAGER, GROUP, { sourceId: null, standing: 'manager' as never, now: NOW });
    expect(d).toMatchObject({ allowed: false, code: CommErrorCode.SEAT_NOT_ELIGIBLE });
  });

  it('refuses without standing of their own, and voids the summons so nobody waits for them', async () => {
    const { service, moved, outbox } = build({ id: 'mn-2' });
    const d = await service.canJoin(MANAGER, GROUP, { sourceId: null, standing: null, now: NOW });
    expect(d).toMatchObject({ allowed: false, code: CommErrorCode.SEAT_NOT_ELIGIBLE });
    expect(moved).toEqual(['mn-2->void']);
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.anything(), 'mention.updated', expect.objectContaining({ mentionId: 'mn-2', state: 'void' }));
  });
});
