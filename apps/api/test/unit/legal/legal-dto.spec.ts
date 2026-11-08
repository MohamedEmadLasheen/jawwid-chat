/**
 * PD-58 review P2: login, refresh and a password change rotate the session
 * BEFORE they read the Terms of Use block for the response. If that read threw,
 * the client would lose the new token pair and its retry with the old refresh
 * token would count as reuse, revoking every session. dtoFor therefore never
 * throws: a failed read answers 'unavailable', which still fails closed.
 */
import { LegalService, type LegalStatus } from '../../../src/legal/legal.service';
import type { PrismaService } from '../../../src/platform/prisma.service';

const service = (): LegalService => new LegalService({} as unknown as PrismaService);

describe('LegalService.dtoFor', () => {
  it("answers 'unavailable' instead of throwing when the status cannot be read", async () => {
    const legal = service();
    jest.spyOn(legal, 'statusOf').mockRejectedValue(new Error('connection reset'));
    await expect(legal.dtoFor('account-1')).resolves.toEqual({ state: 'unavailable', required: [], unavailable: [] });
  });

  it('still reports outstanding documents when the read succeeds', async () => {
    const legal = service();
    const required = [{ documentKey: 'family_terms', version: '1.0', title: 'Terms', url: 'https://example.invalid/t' }];
    const status = { kind: 'family', documents: [], required, misconfigured: [] } as unknown as LegalStatus;
    jest.spyOn(legal, 'statusOf').mockResolvedValue(status);
    const dto = await legal.dtoFor('account-1');
    expect(dto.state).toBe('required');
    expect(dto.required).toHaveLength(1);
  });

  it('treats an unknown account as unavailable, as before', async () => {
    const legal = service();
    jest.spyOn(legal, 'statusOf').mockResolvedValue(null);
    await expect(legal.dtoFor('nobody')).resolves.toEqual({ state: 'unavailable', required: [], unavailable: [] });
  });
});
