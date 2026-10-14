/**
 * The database identity a request runs as is established in ONE place.
 *
 * On chat_app, Postgres resolves the actor from session settings
 * (chat.actor_subject, chat.actor_organization, the raw chat.actor_staff_id
 * fallback) and anything holding the chat_app connection can set them. So the
 * boundary is the API's own code: only ActorScopedDatabase may set them, from
 * the guard-verified actor, transaction-locally. This test reads apps/api/src
 * and refuses:
 *   - an identity or role setting written anywhere else (set_config, SET, SET ROLE);
 *   - an elevation gate (chat.transferring_ownership, chat.syncing_assignment,
 *     chat.provisioning_super_admin) opened outside its one server-side owner;
 *   - $queryRawUnsafe / $executeRawUnsafe, the only way request text could
 *     become SQL (tagged $queryRaw binds every value as a parameter);
 *   - DATABASE_APP_URL read anywhere but ActorScopedDatabase.
 * And it refuses any database credential or URL in Admin Web's source.
 *
 * Pure: reads files, no database.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const API_SRC = join(__dirname, '../../../src');
const WEB_SRC = join(__dirname, '../../../../admin-web/src');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(name) ? [p] : [];
  });
}
/** Source with comments removed, so documentation may name what code must not do. */
function code(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const IDENTITY = /(chat\.actor_(subject|organization|staff_id)|request\.jwt|\bset\s+(local\s+)?role\b|\bset\s+session\s+authorization\b)/i;
const GATES = /chat\.(transferring_ownership|syncing_assignment|provisioning_super_admin)/i;
const ALLOWED_IDENTITY = new Set(['platform/actor-database.ts']);
const ALLOWED_GATES = new Set(['cli/super-admin-bootstrap.ts']);

export function auditSources(apiSrc: string, webSrc: string): string[] {
  const v: string[] = [];
  for (const f of files(apiSrc, /\.ts$/)) {
    const r = relative(apiSrc, f);
    const src = code(f);
    if (IDENTITY.test(src) && !ALLOWED_IDENTITY.has(r)) v.push(`${r} sets or reads a database identity setting`);
    if (GATES.test(src) && !ALLOWED_GATES.has(r)) v.push(`${r} opens an elevation gate`);
    if (/\$(query|execute)RawUnsafe\b/.test(src)) v.push(`${r} uses an Unsafe raw query`);
    if (/DATABASE_APP_URL/.test(src) && r !== 'platform/actor-database.ts') v.push(`${r} reads DATABASE_APP_URL`);
  }
  for (const f of files(webSrc, /\.(ts|tsx|js|jsx)$/)) {
    const src = code(f);
    if (/postgres(ql)?:\/\/|DATABASE_(APP_)?URL|chat_app|service_role|JWT_(ACCESS|REFRESH)_SECRET|STORAGE_SECRET_KEY/.test(src)) {
      v.push(`admin-web/${relative(webSrc, f)} names a database or server credential`);
    }
  }
  return v;
}

describe('database identity is established only by ActorScopedDatabase', () => {
  it('the repository is clean', () => {
    expect(auditSources(API_SRC, WEB_SRC)).toEqual([]);
  });

  it('the one place that sets it does so transaction-locally, from the verified actor', () => {
    const src = code(join(API_SRC, 'platform/actor-database.ts'));
    const sets = [...src.matchAll(/set_config\('chat\.actor_(\w+)',\s*\$\{([^}]+)\},\s*(true|false)\)/g)];
    expect(sets.map((m) => [m[1], m[2], m[3]])).toEqual([
      ['subject', 'identity.subject', 'true'],
      ['organization', 'actor.organizationId', 'true'],
    ]);
    expect(src).not.toMatch(/actor_staff_id/);
  });

  describe('negative controls', () => {
    function tree(apiFiles: Record<string, string>, webFiles: Record<string, string> = {}): [string, string] {
      const root = mkdtempSync(join(tmpdir(), 'idb-'));
      for (const [base, set] of [['api', apiFiles], ['web', webFiles]] as const) {
        for (const [p, body] of Object.entries(set)) {
          mkdirSync(join(root, base, p, '..'), { recursive: true });
          writeFileSync(join(root, base, p), body);
        }
        mkdirSync(join(root, base), { recursive: true });
      }
      return [join(root, 'api'), join(root, 'web')];
    }
    it('catches an identity write, a gate, an Unsafe query and a leaked credential', () => {
      const v = auditSources(...tree(
        {
          'family/x.service.ts': "await tx.$executeRaw`select set_config('chat.actor_staff_id', ${body.staffId}, true)`;",
          'family/y.service.ts': "await tx.$executeRaw`select set_config('chat.transferring_ownership', 'on', true)`;",
          'family/z.service.ts': 'await this.prisma.$queryRawUnsafe(`select * from chat.family where id = ${id}`);',
          'family/w.service.ts': 'await tx.$executeRaw`set role service_role`;',
        },
        { 'api.ts': "const url = 'postgres://chat_app:pw@db/jawwid';" },
      )).join('\n');
      expect(v).toMatch(/x\.service\.ts sets or reads a database identity/);
      expect(v).toMatch(/y\.service\.ts opens an elevation gate/);
      expect(v).toMatch(/z\.service\.ts uses an Unsafe raw query/);
      expect(v).toMatch(/w\.service\.ts sets or reads a database identity/);
      expect(v).toMatch(/admin-web\/api\.ts names a database or server credential/);
    });
  });
});
