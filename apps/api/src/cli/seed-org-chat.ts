import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { describeTarget } from './bootstrap-super-admin';
import { bootstrapSuperAdmin } from './super-admin-bootstrap';
import { SeedRefusal, seedOrgChat, type SeedManifest } from './org-chat-seed';

/**
 * PD-8 QA seed -- the organization structure, 10 teachers and 30 families.
 *
 *   DATABASE_URL=postgres://... node dist/cli/seed-org-chat.js \
 *     --target localhost:55432/jawwid_chat \
 *     --password-file ~/.jawwid/qa-seed.pw \
 *     [--email-domain orgchat.qa.jawwid.test] [--organization <uuid>] \
 *     [--manifest ./orgchat-manifest.json] [--no-active-backup] [--allow-non-local]
 *
 * Same rails as bootstrap-super-admin: the target must be named and must match
 * DATABASE_URL; outside APP_ENV local/test/ci it refuses unless told otherwise;
 * THE PASSWORD NEVER APPEARS ON A COMMAND LINE and is never printed -- every
 * synthetic account gets that one QA password, read from a chmod-600 file or
 * stdin. The manifest lists subjects, names and roles only.
 *
 * Synthetic people only (G-20, system-inventory §4): real staff are created on
 * the live system by an administrator, never seeded.
 */

const LOCAL_ENVS = new Set(['local', 'test', 'ci', '']);

function fail(code: string, message: string): never {
  process.stderr.write(`seed-org-chat: REFUSED [${code}] ${message}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const args = {
    target: undefined as string | undefined,
    passwordFile: process.env.ORG_SEED_PASSWORD_FILE,
    emailDomain: 'orgchat.qa.jawwid.test',
    organization: undefined as string | undefined,
    manifest: undefined as string | undefined,
    activeBackup: true,
    allowNonLocal: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) fail('USAGE', `${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--target': args.target = value(); break;
      case '--password-file': args.passwordFile = value(); break;
      case '--email-domain': args.emailDomain = value(); break;
      case '--organization': args.organization = value(); break;
      case '--manifest': args.manifest = value(); break;
      case '--no-active-backup': args.activeBackup = false; break;
      case '--allow-non-local': args.allowNonLocal = true; break;
      case '--password':
        fail('USAGE', 'a password is never accepted on the command line; use --password-file or stdin');
      default: fail('USAGE', `unknown argument ${flag}`);
    }
  }
  return args;
}

function readPassword(path: string | undefined): string {
  if (path) {
    const stat = statSync(path);
    if (!stat.isFile()) fail('PASSWORD_FILE', 'the password file is not a regular file');
    if ((stat.mode & 0o077) !== 0) fail('PASSWORD_FILE', 'the password file must be readable by its owner only (chmod 600)');
    return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  }
  if (process.stdin.isTTY) fail('PASSWORD_FILE', 'no --password-file given and stdin is a terminal; pipe the password in');
  return readFileSync(0, 'utf8').replace(/\r?\n$/, '');
}

/** Who is who, without a single credential in it. */
export function publicManifest(m: SeedManifest) {
  const person = (p: { subject: string; name: string }, role: string) => ({ subject: p.subject, name: p.name, role });
  return {
    organizationId: m.organizationId,
    accounts: [
      person(m.superAdmin, 'super_admin'),
      person(m.operationsManager, 'operations manager'),
      person(m.salesManager, 'sales manager'),
      person(m.teachersManager, 'teachers manager'),
      ...m.supervisors.map((s) => person(s, 'operations supervisor')),
      ...m.backups.map((b) => person(b, 'operations backup supervisor')),
      ...m.teacherSupervisors.map((s) => person(s, 'teachers supervisor')),
      ...m.teachers.map((t) => person(t, 'teacher')),
      ...m.families.map((f) => person(f.parent, `parent (${f.children.length} children, scenario ${f.scenario})`)),
    ],
    counts: {
      teachers: m.teachers.length,
      families: m.families.length,
      children: m.families.reduce((n, f) => n + f.children.length, 0),
      familyGroups: m.families.reduce((n, f) => n + f.groups.length, 0),
      parentDirects: m.families.reduce((n, f) => n + f.directs.length, 0),
      teacherDirects: m.teacherDirects.length,
      backupLinks: m.backupLinks.length,
      activeBackupLinks: m.backupLinks.filter((l) => l.active).length,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('USAGE', 'DATABASE_URL is not set');
  const target = describeTarget(databaseUrl);
  if (!args.target) fail('USAGE', `--target is required; DATABASE_URL points at ${target}`);
  if (args.target !== target) fail('TARGET_MISMATCH', `--target ${args.target} does not match DATABASE_URL (${target})`);
  const appEnv = (process.env.APP_ENV ?? '').trim().toLowerCase();
  if (!LOCAL_ENVS.has(appEnv) && !args.allowNonLocal) {
    fail('ENVIRONMENT', `APP_ENV=${appEnv}; pass --allow-non-local to seed outside a local environment`);
  }
  const password = readPassword(args.passwordFile);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const organizationId =
      args.organization ??
      (await prisma.$queryRaw<{ id: string }[]>`select chat.default_organization_id()::text as id`)[0].id;
    // The organization needs its super admin first, created only by the
    // supported bootstrap (which targets the default organization).
    const hasSuper = await prisma.staff.count({
      where: { organizationId, role: 'super_admin', isActive: true, leftAt: null },
    });
    if (hasSuper === 0) {
      if (args.organization) fail('NO_SUPER_ADMIN', 'that organization has no super admin; bootstrap one first');
      await bootstrapSuperAdmin(prisma, {
        email: `owner@${args.emailDomain}`,
        password,
        displayName: 'QA Organization Owner',
      });
    }
    const manifest = await seedOrgChat(prisma, {
      organizationId,
      emailDomain: args.emailDomain,
      password,
      activateOneBackup: args.activeBackup,
    });
    const out = publicManifest(manifest);
    if (args.manifest) writeFileSync(args.manifest, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ target, ...out.counts, organizationId })}\n`);
  } catch (error) {
    const code = error instanceof SeedRefusal ? error.code : 'ERROR';
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`seed-org-chat: REFUSED [${code}] ${message}\n`);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
