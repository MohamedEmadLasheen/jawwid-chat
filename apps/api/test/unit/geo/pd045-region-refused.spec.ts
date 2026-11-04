/**
 * PD-45 PR-2b (plan §3.4, §11): `parent_file.region` stays readable ("Old note")
 * but is no longer written. A request that names `region` is refused with the
 * code every other bad field uses -- 400 VALIDATION, naming the field -- and
 * only AFTER the caller has been authorised (a caller outside the Parent
 * Profile's rule still gets PARENT_PROFILE_DENIED / NOT_FOUND first, so the
 * answer never says which ids exist). Nothing is written.
 */
import { ParentRecordService } from '../../../src/parent-profile/parent-record.service';
import { CommError, CommErrorCode } from '../../../src/platform/errors';

function service() {
  const tx = { $executeRaw: jest.fn(), $queryRaw: jest.fn() };
  const prisma = {
    parentFile: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const svc = new ParentRecordService(prisma as never, {} as never, {} as never, { audit: jest.fn() } as never);
  const contact = { id: 'c1', name: 'Parent', familyId: 'f1', organizationId: 'o1', countryCode: 'EG', subdivisionCode: null };
  const editable = jest.fn().mockResolvedValue({ actor: { actorId: 'a1' }, contact });
  (svc as unknown as { requireEditableContact: unknown }).requireEditableContact = editable;
  return { svc, prisma, editable };
}

describe('PD-45: a write of the old free-text region is refused', () => {
  it.each([
    ['text', { region: 'Giza' }],
    ['null (clearing it is a write too)', { region: null }],
    ['an empty string', { region: '' }],
    ['text next to a valid location', { countryCode: 'EG', subdivisionCode: 'EG-GZ', region: 'Giza' }],
  ])('%s -> 400 VALIDATION naming region, and nothing is written', async (_name, body) => {
    const { svc, prisma } = service();
    const err = await svc.update('a1', 'c1', body).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(CommError);
    expect(err).toMatchObject({ code: CommErrorCode.VALIDATION, status: 400 });
    expect((err as CommError).message).toMatch(/^region: /);
    expect((err as CommError).message).toMatch(/subdivisionCode/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.parentFile.findUnique).not.toHaveBeenCalled();
  });

  it('is decided after the caller is authorised, never before', async () => {
    const { svc, editable } = service();
    editable.mockRejectedValue(new CommError(CommErrorCode.PARENT_PROFILE_DENIED, 'denied'));
    await expect(svc.update('a1', 'c1', { region: 'Giza' })).rejects.toMatchObject({ code: CommErrorCode.PARENT_PROFILE_DENIED });
  });
});
