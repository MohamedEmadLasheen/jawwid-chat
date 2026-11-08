/**
 * provision-review-cohort's reading of DATABASE_URL, without a database (LR-05).
 *
 * The property that matters is negative: a malformed DATABASE_URL is refused
 * with exit 2 and a fixed message that never quotes the URL, its password
 * included. A valid one yields only host:port/database.
 */
import { targetFromDatabaseUrl } from '../../../src/cli/provision-review-cohort';

describe('provision-review-cohort targetFromDatabaseUrl', () => {
  let exit: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    exit = jest.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exit.mockRestore();
    stderr.mockRestore();
  });

  it('refuses a malformed DATABASE_URL with exit 2 and never quotes it', () => {
    const secret = 'Distinctive-Secret-91';
    // A non-numeric port makes `new URL` throw; its error would carry the input.
    const malformed = `postgres://jawwid:${secret}@db.example:not-a-port/jawwid_chat`;

    expect(() => targetFromDatabaseUrl(malformed)).toThrow('exit 2');

    expect(exit).toHaveBeenCalledWith(2);
    const written = stderr.mock.calls.map(([line]) => String(line)).join('');
    expect(written).toContain('REFUSED [USAGE] DATABASE_URL is not a valid URL');
    expect(written).not.toContain(secret);
    expect(written).not.toContain('db.example');
  });

  it('returns only host:port/database for a valid DATABASE_URL', () => {
    const secret = 'Distinctive-Secret-92';
    expect(targetFromDatabaseUrl(`postgres://jawwid:${secret}@db.example:6543/jawwid_chat?sslmode=require`)).toBe(
      'db.example:6543/jawwid_chat',
    );
    expect(exit).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});
