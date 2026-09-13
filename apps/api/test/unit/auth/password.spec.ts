/**
 * Argon2id (IDENTITY-MODEL §2, PRD §7.1).
 *
 * The canonical document names an algorithm. These assert that the shipped code
 * is that algorithm at the documented cost -- not scrypt, not bcrypt, and not
 * Argon2id at parameters low enough to be worthless.
 */
import { ARGON2ID_PREFIX, hashPassword, spendComparableTime, verifyPassword } from '@platform/auth/password';

jest.setTimeout(30_000);

describe('Argon2id is the algorithm, at the documented cost', () => {
  it('produces a PHC string that says argon2id', async () => {
    const hash = await hashPassword('a-correct-password');
    expect(hash.startsWith(ARGON2ID_PREFIX)).toBe(true);
    expect(hash).not.toMatch(/^\$argon2i\$|^\$argon2d\$|^scrypt\$|^\$2[aby]\$/);
  });

  it('encodes the OWASP minimum parameters into the hash, so they can be raised later', async () => {
    const hash = await hashPassword('a-correct-password');
    expect(hash).toContain('$v=19$');
    expect(hash).toContain('m=19456,t=2,p=1');
  });

  it('never stores the password, and salts so two equal passwords differ', async () => {
    const plain = 'the-same-password';
    const a = await hashPassword(plain);
    const b = await hashPassword(plain);

    expect(a).not.toContain(plain);
    expect(a).not.toBe(b);
    expect(await verifyPassword(plain, a)).toBe(true);
    expect(await verifyPassword(plain, b)).toBe(true);
  });
});

describe('verification', () => {
  it('accepts the right password and refuses everything else', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
    expect(await verifyPassword('CORRECT HORSE BATTERY STAPLE', hash)).toBe(false);
  });

  it('handles non-ASCII passwords, which Arabic-first users will have', async () => {
    const plain = 'كلمة-السر-الطويلة-٢٠٢٦';
    const hash = await hashPassword(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
    expect(await verifyPassword('كلمة-السر', hash)).toBe(false);
  });

  it('returns false rather than throwing on a corrupt or foreign stored hash', async () => {
    // A corrupt row must fail that one login, not 500 the endpoint for everyone.
    for (const stored of [
      '',
      'not-a-hash',
      '$argon2id$truncated',
      '$argon2id$v=19$m=19456,t=2,p=1$bad!!salt$bad!!hash',
      'scrypt$16384$8$1$c2FsdA==$a2V5', // the archived D-6 format
      '$2b$12$abcdefghijklmnopqrstuv', // bcrypt
    ]) {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    }
  });

  it('refuses a hash that is not argon2id even if it is otherwise well formed', async () => {
    // Downgrading to a weaker algorithm must not be possible by writing a row.
    const argon2i = '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaA';
    expect(await verifyPassword('anything', argon2i)).toBe(false);
  });
});

describe('account enumeration by timing', () => {
  it('spendComparableTime performs a real verification, not a no-op', async () => {
    // If the unknown-subject path returned instantly, response timing would
    // enumerate accounts no matter how uniform the body is.
    const started = process.hrtime.bigint();
    await spendComparableTime('whatever-was-submitted');
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    // A real Argon2id verification at m=19456 costs tens of milliseconds; a
    // no-op or a failed parse costs well under one.
    expect(elapsedMs).toBeGreaterThan(5);
  });

  it('is within the same order of magnitude as verifying a real hash', async () => {
    const hash = await hashPassword('a-real-password');

    // MEDIAN OF SEVEN, not a single sample. Jest runs suites in parallel and
    // Argon2id is CPU- and memory-bound, so any one measurement can be
    // arbitrarily stretched by a neighbouring worker. A security test that
    // fails at random gets muted, which costs more than the property it
    // guards -- and the property is about the TYPICAL cost, not the worst case.
    const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const started = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const real: number[] = [];
    const decoy: number[] = [];
    for (let i = 0; i < 7; i++) {
      real.push(await time(() => verifyPassword('a-wrong-password', hash)));
      decoy.push(await time(() => spendComparableTime('a-wrong-password')));
    }

    // The bound stays wide on purpose: this asserts "the unknown-subject path
    // does comparable work", not a constant-time guarantee, which is not
    // achievable in a Node process and is not what the defence relies on.
    expect(median(decoy)).toBeGreaterThan(median(real) / 5);
    expect(median(decoy)).toBeLessThan(median(real) * 5);
  });
});
