/**
 * PD-40 PR-5 (review of #239): ACCESS_ROLE_CONFLICT carries the grants that
 * block a role edit as structured detail, parsed from the FULL database text
 * before the message is cut to 600 characters. With six or more grants the
 * cut used to drop the tail, so a client reading the message lost names.
 * DB-free: chat.update_access_role's wording is reproduced here.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { accessRoleConflict, blockingGrantsOf } from '../../../src/staff-accounts/access-role-conflict';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sqlText = (pairs: Array<[string, string]>) =>
  'Invalid `prisma.$executeRaw()` invocation:\n\nRaw query failed. Code: `42501`. Message: `ERROR: ' +
  `this edit gives keys their granting manager may not grant to: ${pairs.map(([s, g]) => `${s} (granted by ${g})`).join(', ')}; ` +
  'revoke those grants first (PD-40 H5)`';

describe('blockingGrantsOf', () => {
  it('reads every grant, well past what a 600-character message holds', () => {
    const pairs: Array<[string, string]> = Array.from({ length: 9 }, (_, i) => [uuid(i + 1), uuid(100 + (i % 2))]);
    const text = sqlText(pairs);
    expect(text.length).toBeGreaterThan(600);
    expect(blockingGrantsOf(text)).toEqual(pairs.map(([staffId, grantedBy]) => ({ staffId, grantedBy })));
  });

  it('reads one grant', () => {
    expect(blockingGrantsOf(sqlText([[uuid(1), uuid(2)]]))).toEqual([{ staffId: uuid(1), grantedBy: uuid(2) }]);
  });

  it('counts a grant once when the driver repeats the message', () => {
    const once = sqlText([[uuid(1), uuid(2)], [uuid(3), uuid(2)]]);
    expect(blockingGrantsOf(`${once}\n${once}`)).toEqual([
      { staffId: uuid(1), grantedBy: uuid(2) },
      { staffId: uuid(3), grantedBy: uuid(2) },
    ]);
  });

  it('reads nothing from another refusal', () => {
    expect(blockingGrantsOf('ERROR: no such role')).toEqual([]);
    expect(blockingGrantsOf('')).toEqual([]);
  });
});

describe('accessRoleConflict', () => {
  it('is a 409 whose message stays short and whose detail names every grant', () => {
    const pairs: Array<[string, string]> = Array.from({ length: 12 }, (_, i) => [uuid(i + 1), uuid(200)]);
    const error = accessRoleConflict(sqlText(pairs));
    expect(error).toBeInstanceOf(CommError);
    expect({ code: error.code, status: error.status }).toEqual({ code: CommErrorCode.ACCESS_ROLE_CONFLICT, status: 409 });
    expect(error.message.length).toBeLessThanOrEqual(600);
    expect(error.message.startsWith('this edit gives keys their granting manager may not grant to:')).toBe(true);
    expect(error.detail).toEqual({ grants: pairs.map(([staffId, grantedBy]) => ({ staffId, grantedBy })) });
  });
});
