/**
 * PD-58 (roadmap 2026-11-03 §7.6): no content route can bypass the Terms of
 * Use gate.
 *
 * Walks Nest's own route metadata (the same inventory the PD-40 route spec
 * uses) and FAILS when:
 *   - a write (any verb but GET) rate-limited as a content action (MESSAGE_SEND,
 *     ATTACHMENT_UPLOAD, STORY_PUBLISH, WHITEBOARD_WRITE, CALL_START,
 *     REPORT_SUBMIT) lacks @RequiresLegal();
 *   - a route on the fixed list (§7.4's gated routes that carry no such limit)
 *     lacks it, or no longer exists under that path (rename the entry with it);
 *   - a route that must NEVER be gated (reading, /auth/*, GET /me, accepting,
 *     account deletion, the parent notices, logout) carries it.
 *
 * `POST /reports` and `POST /me/blocks` (MG-1) are on the fixed list. The one
 * exemption there is (LD-11: a child-safety report) is on `POST /reports`
 * only; any other route carrying an exemption fails here.
 */
import { RATE_LIMITED_ACTION, ActionScope } from '@platform/auth/action-throttle.guard';
import { REQUIRES_LEGAL, REQUIRES_LEGAL_EXCEPT } from '../../../src/legal/requires-legal.decorator';
import { collectRoutes, type Route } from '../../support/route-inventory';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

jest.setTimeout(120_000);

const CONTENT_SCOPES = ['MESSAGE_SEND', 'ATTACHMENT_UPLOAD', 'STORY_PUBLISH', 'WHITEBOARD_WRITE', 'CALL_START', 'REPORT_SUBMIT'];

/** §7.4's gated routes that no content rate limit marks. */
const FIXED = [
  'POST /conversations/direct',
  'POST /conversations/family-group',
  'POST /conversations/student-group',
  'POST /conversations/:conversationId/messages/:messageId/reactions',
  'PATCH /conversations/:conversationId/messages/:messageId',
  'POST /stories',
  'POST /me/feedback',
  'POST /parent-feedback/:id/reply',
  'PATCH /me/profile',
  'PATCH /me/children/:learnerId',
  'POST /me/avatar/upload',
  'POST /me/avatar',
  'DELETE /me/avatar',
  'POST /me/children/:learnerId/avatar/upload',
  'POST /me/children/:learnerId/avatar',
  'DELETE /me/children/:learnerId/avatar',
  'POST /me/teacher-profile',
  'PATCH /me/teacher-profile/name',
  'POST /me/teacher-profile/certificates/upload',
  'POST /me/teacher-profile/certificates',
  'PATCH /me/teacher-profile/certificates/:id',
  'DELETE /me/teacher-profile/certificates/:id',
  'POST /lessons/:id/report',
  'POST /lessons/:id/absence',
  'POST /lessons/:id/apology',
  'POST /lessons/:id/teacher-apology',
  'POST /calls',
  // ENG-10 (2026-11-07): found by walking every ungated write on main.
  'POST /lessons/:id/late-apology',
  'POST /lessons/:id/report/edit',
  'POST /learners/:learnerId/rewards',
  'POST /certificates/:id/story',
  // MG-1 (developer-implementation-guide §3.3): reporting and blocking.
  'POST /reports',
  'POST /me/blocks',
];

/** The only exemptions (LD-11), by route. */
const EXEMPT: Record<string, string> = { 'POST /reports': 'child_safety_report' };

/** Never gated (§7.4): a person who has not accepted can still read, leave, delete their account. */
const NEVER = (r: Route) =>
  r.method === 'GET' ||
  r.path.startsWith('/auth/') ||
  r.path === '/me/legal' ||
  r.path === '/me/legal/accept' ||
  r.path === '/me/account/delete' ||
  r.path.startsWith('/account-deletion') ||
  r.path.startsWith('/parent-notices') ||
  r.path.startsWith('/me/sessions');

/** The handler functions, keyed like the inventory, so their metadata can be read. */
function handlers(): Map<string, { fn: Function; classGated: boolean }> {
  const SRC = join(__dirname, '..', '..', '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const f = join(dir, n);
      return statSync(f).isDirectory() ? files(f) : n.endsWith('.controller.ts') ? [f] : [];
    });
  const out = new Map<string, { fn: Function; classGated: boolean }>();
  const j = (a: string, b: string) => '/' + [a, b].map((s) => s.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  for (const file of files(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    for (const exported of Object.values(require(file) as Record<string, unknown>)) {
      if (typeof exported !== 'function') continue;
      const ctor = exported as { prototype: Record<string, unknown> };
      const prefix = Reflect.getMetadata(PATH_METADATA, ctor) as string | string[] | undefined;
      if (prefix === undefined) continue;
      const classGated = Reflect.getMetadata(REQUIRES_LEGAL, ctor) === true;
      for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
        const fn = ctor.prototype[name];
        if (name === 'constructor' || typeof fn !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
        if (verb === undefined) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | string[];
        for (const p of Array.isArray(prefix) ? prefix : [prefix]) {
          for (const s of Array.isArray(sub) ? sub : [sub]) {
            const key = `${RequestMethod[verb]} ${j(p, s)}`;
            out.set(key, { fn: fn as Function, classGated });
          }
        }
      }
    }
  }
  return out;
}

const routes = collectRoutes();
const fns = handlers();
const key = (r: Route) => `${r.method} ${r.path}`;
const gated = (r: Route) => fns.get(key(r))!.classGated || Reflect.getMetadata(REQUIRES_LEGAL, fns.get(key(r))!.fn) === true;
const scopeOf = (r: Route) => Reflect.getMetadata(RATE_LIMITED_ACTION, fns.get(key(r))!.fn) as string | undefined;
const contentScopes = new Set(
  CONTENT_SCOPES.map((name) => (ActionScope as Record<string, string>)[name]).filter((v): v is string => typeof v === 'string'),
);

describe('PD-58: every content route is behind the Terms of Use gate', () => {
  it('finds the routes it is about (the inventory is not empty)', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(contentScopes.size).toBeGreaterThanOrEqual(5);
  });

  it('every WRITE rate-limited as a content action carries @RequiresLegal()', () => {
    // A read stays open even when it spends a content budget (GET /whiteboards/:id/assets
    // counts against WHITEBOARD_WRITE): reading is never gated (§7.4).
    const missing = routes.filter((r) => r.method !== 'GET' && contentScopes.has(scopeOf(r) ?? '') && !gated(r)).map(key);
    expect(missing).toEqual([]);
  });

  it('every route on the fixed list exists and carries @RequiresLegal()', () => {
    const byKey = new Map(routes.map((r) => [key(r), r]));
    expect(FIXED.filter((k) => !byKey.has(k))).toEqual([]);
    expect(FIXED.filter((k) => byKey.has(k) && !gated(byKey.get(k)!))).toEqual([]);
  });

  it('every write in the whiteboards controllers is gated', () => {
    const boards = routes.filter((r) => r.controller.startsWith('whiteboards/') && r.method !== 'GET');
    expect(boards.length).toBeGreaterThan(10);
    expect(boards.filter((r) => !gated(r)).map(key)).toEqual([]);
  });

  it('LD-11: the only exemption is the child-safety report on POST /reports', () => {
    const exemptions = Object.fromEntries(
      routes
        .map((r) => [key(r), Reflect.getMetadata(REQUIRES_LEGAL_EXCEPT, fns.get(key(r))!.fn) as string | undefined] as const)
        .filter(([, e]) => e !== undefined),
    );
    expect(exemptions).toEqual(EXEMPT);
  });

  it('a @Public() route is never gated: it has no account to check (PUT /storage/:objectKey is authorized by its signed URL)', () => {
    // The gate for a content upload is where its signed URL is minted (attachments/authorize,
    // stories/media, the avatar and certificate uploads, the receipt upload, board assets).
    expect(routes.filter((r) => r.isPublic && gated(r)).map(key)).toEqual([]);
  });

  it('reading, signing in or out, accepting, account deletion and the parent notices are NEVER gated', () => {
    const wrong = routes.filter((r) => NEVER(r) && gated(r)).map(key);
    expect(wrong).toEqual([]);
    for (const k of ['GET /me', 'GET /me/legal', 'POST /me/legal/accept', 'POST /me/account/delete', 'POST /auth/logout', 'POST /parent-notices/:key/acknowledge']) {
      const r = routes.find((x) => key(x) === k);
      expect(r).toBeDefined();
      expect(gated(r!)).toBe(false);
    }
  });
});
