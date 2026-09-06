#!/usr/bin/env node
/**
 * Set an account's password. Owner: AI #7 (infrastructure).
 *
 *   node scripts/dev/set-password.mjs <subject> <password>
 *
 * There is no public registration (PRD), so accounts are created by an operator
 * and this is how they get a password. It uses the SAME hashing the API uses --
 * importing it from the build rather than reimplementing scrypt here, so the
 * two can never drift.
 *
 * Requires: apps/api built (npm run build) and DATABASE_URL set.
 * Refuses to run against production: seeding a password there is an incident,
 * not a convenience.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const api = resolve(here, '../../apps/api');
const require = createRequire(`${api}/`);

if ((process.env.APP_ENV ?? 'local') === 'production') {
  console.error('refusing to run against production');
  process.exit(1);
}

const [subject, password] = process.argv.slice(2);
if (!subject || !password) {
  console.error('usage: set-password.mjs <subject> <password>');
  process.exit(64);
}
if (password.length < 12) {
  console.error('password must be at least 12 characters');
  process.exit(64);
}

const { hashPassword } = require(`${api}/dist/platform/auth/password.js`);
const { PrismaClient } = require(`${api}/node_modules/@prisma/client`);

const prisma = new PrismaClient();
try {
  const account = await prisma.account.findUnique({ where: { subject } });
  if (!account) {
    console.error(`no account with subject '${subject}'`);
    process.exit(66);
  }
  const passwordHash = await hashPassword(password);
  await prisma.accountCredential.upsert({
    where: { accountId: account.id },
    create: { accountId: account.id, passwordHash },
    update: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
  });
  // Never echo the password, not even in a dev tool: shell history and CI logs
  // both outlive the convenience.
  console.log(`password set for ${subject} (${account.kind})`);
} finally {
  await prisma.$disconnect();
}
