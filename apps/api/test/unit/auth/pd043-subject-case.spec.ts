/**
 * PD-43 (department head's review of #184): one rule for the sign-in name's
 * case, at login and when a code is completed. A teacher's sign-in is stored
 * lower-cased (chat.create_teacher); someone who types it with capitals is
 * still found. The exact subject is tried first, so an older account whose
 * subject has capitals keeps signing in exactly as before.
 */
import { AuthErrorCode } from '@platform/auth/auth.errors';
import type { AuthService } from '@platform/auth/auth.service';
import { PasswordResetService } from '@platform/auth/password-reset.service';
import { buildAuth, FakeDb, FakeIdentity, teacherActor, withAuthEnv } from './support/fake-db';

jest.setTimeout(60_000);

const PASSWORD = 'a-correct-password-1';

describe('login: the sign-in name, whatever its case', () => {
  let db: FakeDb;
  let identity: FakeIdentity;
  let auth: AuthService;

  beforeEach(() => {
    withAuthEnv();
    db = new FakeDb();
    identity = new FakeIdentity();
    auth = buildAuth(db, identity);
  });

  it('a lower-cased sign-in is found when typed with capitals', async () => {
    const account = await db.addAccount({ subject: 'new.teacher@example.test', kind: 'teacher' }, PASSWORD);
    identity.give(account.id, teacherActor());
    await expect(auth.login('  New.Teacher@Example.TEST ', PASSWORD)).resolves.toMatchObject({ refreshToken: expect.any(String) });
  });

  it('an exact subject with capitals still signs in as before', async () => {
    const account = await db.addAccount({ subject: 'Legacy-Login-01', kind: 'teacher' }, PASSWORD);
    identity.give(account.id, teacherActor());
    await expect(auth.login('Legacy-Login-01', PASSWORD)).resolves.toMatchObject({ refreshToken: expect.any(String) });
  });

  it('an unknown name is the same refusal', async () => {
    await expect(auth.login('Nobody@Example.TEST', PASSWORD)).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CREDENTIALS });
  });
});

describe('complete(): the same rule', () => {
  it('tries the exact subject, then the lower-cased one', async () => {
    const seen: string[] = [];
    const prisma = {
      account: {
        findUnique: jest.fn(async ({ where }: { where: { subject: string } }) => {
          seen.push(where.subject);
          return where.subject === 'new.teacher@example.test' ? { id: 'acc' } : null;
        }),
      },
      passwordResetCode: { findFirst: jest.fn(async () => null) },
    };
    const service = new PasswordResetService(prisma as never, {} as never, {} as never);
    await expect(service.complete(' New.Teacher@Example.TEST', '123456', '1234')).rejects.toMatchObject({ code: AuthErrorCode.RESET_CODE_INVALID });
    expect(seen).toEqual(['New.Teacher@Example.TEST', 'new.teacher@example.test']);
  });
});
