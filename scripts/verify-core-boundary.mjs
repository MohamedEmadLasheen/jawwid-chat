#!/usr/bin/env node
/**
 * Runtime verification of the Jawwid Core -> Jawwid Chat integration boundary.
 *
 * This does not mock anything. It boots the real NestJS application against a
 * freshly migrated database, sends real signed HTTP requests, and reads the
 * resulting rows back out of Postgres. Unit tests cannot show that the wiring,
 * the raw-body signature and the SQL functions agree; this can.
 *
 *   node scripts/verify-core-boundary.mjs
 */
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = require('pg');

const DATABASE_URL = 'postgresql://postgres:postgres@localhost:55432/jawwid_chat_test';
const KEY_ID = 'core-2026-09';
const SECRET = 'a-test-secret-of-at-least-32-characters-long';
// A second Jawwid Core, belonging to a second organization.
const KEY_ID_B = 'core-b-2026-09';
const SECRET_B = 'a-different-test-secret-at-least-32-chars-ok';
const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  -- ${detail}` : ''}`);
};

function post(body, { keyId = KEY_ID, secret = SECRET, timestamp, headers = true } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return fetch(`${BASE}/integration/core/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headers
        ? {
            'x-jawwid-key-id': keyId,
            'x-jawwid-timestamp': ts,
            'x-jawwid-signature': `sha256=${signature}`,
          }
        : {}),
    },
    body: raw,
  });
}

const envelope = (type, data, eventId = randomUUID()) => ({
  event_id: eventId,
  event_type: type,
  occurred_at: new Date().toISOString(),
  data,
});

const server = spawn('node', ['dist/main.js'], {
  cwd: new URL('../apps/api/', import.meta.url).pathname,
  env: {
    ...process.env,
    DATABASE_URL,
    PORT: String(PORT),
    CORE_WEBHOOK_SECRETS: `${KEY_ID}:${SECRET},${KEY_ID_B}:${SECRET_B}`,
    CORE_WEBHOOK_ORGANIZATIONS: `${KEY_ID}:jawwid,${KEY_ID_B}:academy-b`,
    // Required by AI #2's attachment storage, which refuses to start without a
    // real signing secret. Unrelated to this boundary, but the whole app boots.
    STORAGE_SIGNING_SECRET: 'runtime-verification-signing-secret-32-plus',
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const db = new Client({ connectionString: DATABASE_URL });
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

try {
  // Wait for the application to accept connections.
  let booted = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`${BASE}/integration/core/events`, { method: 'POST', body: '{}' });
      booted = true;
      break;
    } catch {
      await sleep(500);
    }
  }
  check('the NestJS application boots and listens', booted,
    booted ? `port ${PORT}` : serverLog.slice(-400));
  if (!booted) throw new Error('server did not start');

  await db.connect();

  // --- authentication ------------------------------------------------------
  const noAuth = await post(envelope('teacher.upserted', {}), { headers: false });
  check('an unsigned delivery is rejected', noAuth.status === 401,
    `status ${noAuth.status}, reason ${(await noAuth.json()).reason}`);

  const badSig = await post(envelope('teacher.upserted', {}), { secret: 'wrong-secret-entirely' });
  check('a delivery signed with the wrong secret is rejected', badSig.status === 401,
    `status ${badSig.status}, reason ${(await badSig.json()).reason}`);

  const unknownKey = await post(envelope('teacher.upserted', {}), { keyId: 'not-a-key' });
  check('a delivery with an unknown key id is rejected', unknownKey.status === 401,
    `reason ${(await unknownKey.json()).reason}`);

  const stale = await post(envelope('teacher.upserted', {}), {
    timestamp: String(Math.floor(Date.now() / 1000) - 4000),
  });
  check('a replayed delivery outside the timestamp window is rejected', stale.status === 401,
    `reason ${(await stale.json()).reason}`);

  // A valid signature over a tampered body must fail: proves the body is signed.
  const signedBody = JSON.stringify(envelope('teacher.upserted', { core_teacher_id: randomUUID() }));
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', SECRET).update(`${ts}.${signedBody}`).digest('hex');
  const tampered = await fetch(`${BASE}/integration/core/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-jawwid-key-id': KEY_ID,
      'x-jawwid-timestamp': ts,
      'x-jawwid-signature': `sha256=${sig}`,
    },
    body: signedBody.replace('teacher.upserted', 'teacher.deactivated'),
  });
  check('a tampered body fails the signature', tampered.status === 401,
    `status ${tampered.status}`);

  // --- ingestion -----------------------------------------------------------
  const coreTeacherId = randomUUID();
  const teacherEvent = envelope('teacher.upserted', {
    core_teacher_id: coreTeacherId,
    display_name: 'Ustadh Kareem',
  });

  const applied = await post(teacherEvent);
  const appliedBody = await applied.json();
  check('a correctly signed event is applied', applied.status === 200 && appliedBody.status === 'applied',
    `status ${applied.status} / ${appliedBody.status}`);

  const row = await one('select display_name from chat.teacher where core_teacher_id = $1',
    [coreTeacherId]);
  check('the Chat-owned row exists with the delivered data',
    row?.display_name === 'Ustadh Kareem', `display_name=${row?.display_name}`);

  // --- duplicate delivery --------------------------------------------------
  const replay = await post(teacherEvent);
  const replayBody = await replay.json();
  check('re-delivering the same event_id reports a duplicate',
    replay.status === 200 && replayBody.status === 'duplicate', `${replayBody.status}`);

  const teacherCount = await one('select count(*)::int as n from chat.teacher where core_teacher_id = $1',
    [coreTeacherId]);
  check('and produced no second row', teacherCount.n === 1, `rows=${teacherCount.n}`);

  const eventCount = await one(
    'select count(*)::int as n from chat.core_event where external_event_id = $1',
    [teacherEvent.event_id]);
  check('and exactly one delivery is recorded', eventCount.n === 1, `rows=${eventCount.n}`);

  // A different event carrying the same entity is idempotent at the entity level.
  const restated = await post(envelope('teacher.upserted', {
    core_teacher_id: coreTeacherId,
    display_name: 'Ustadh Kareem Ali',
  }));
  check('a new event for the same entity updates in place',
    (await restated.json()).status === 'applied', 'applied');
  const after = await one('select count(*)::int as n, max(display_name) as name from chat.teacher where core_teacher_id = $1',
    [coreTeacherId]);
  check('still one row, carrying the newer value',
    after.n === 1 && after.name === 'Ustadh Kareem Ali', `${after.n} row, name=${after.name}`);

  // --- the no-automatic-owner rule, at runtime -----------------------------
  const coreParentId = randomUUID();
  const parent = await post(envelope('parent.upserted', {
    core_parent_id: coreParentId, display_name: 'Ahmed Family', language: 'ar',
  }));
  const parentBody = await parent.json();
  check('a new parent is accepted but not turned into a family',
    parent.status === 200 && parentBody.status === 'not_applicable', `${parentBody.status}`);
  const waiting = await one('select count(*)::int as n from chat.core_parent_inbox where core_parent_id = $1',
    [coreParentId]);
  check('it waits for a manager to name an owner', waiting.n === 1, `inbox rows=${waiting.n}`);

  // --- malformed -----------------------------------------------------------
  const malformed = await post({ event_type: 'teacher.upserted', data: {} });
  check('an envelope with no event_id is refused as a bad request', malformed.status === 400,
    `status ${malformed.status}`);

  const unknownType = await post(envelope('something.invented', {}));
  check('an unknown event type is refused as a bad request', unknownType.status === 400,
    `status ${unknownType.status}`);

  const notJson = await post('this is not json');
  check('a non-JSON body is refused', notJson.status === 400 || notJson.status === 401,
    `status ${notJson.status}`);

  // --- audit evidence ------------------------------------------------------
  const audits = await one(
    `select count(*)::int as n from chat.audit_log where action = 'core_webhook_rejected'`);
  check('every rejected delivery is written to the audit log', audits.n >= 6, `audit rows=${audits.n}`);

  const auditDetail = await one(
    `select reason, after ->> 'reason' as coded, after ->> 'key_id' as key_id
       from chat.audit_log where action = 'core_webhook_rejected'
       order by id desc limit 1`);
  check('the audit row records why it was refused and which key was claimed',
    Boolean(auditDetail?.reason && auditDetail?.coded),
    `${auditDetail?.coded} / key=${auditDetail?.key_id}`);

  const appliedEvents = await one(
    `select count(*)::int as n from chat.event_log where type = 'core_event_applied'`);
  check('applied events are recorded in the event log', appliedEvents.n >= 2, `events=${appliedEvents.n}`);

  const dupEvents = await one(
    `select count(*)::int as n from chat.event_log where type = 'core_event_duplicate'`);
  check('and duplicates are recorded distinctly', dupEvents.n >= 1, `events=${dupEvents.n}`);

  const processed = await one(
    `select processed_at is not null as done, error from chat.core_event where external_event_id = $1`,
    [teacherEvent.event_id]);
  check('the delivery is marked processed with no error',
    processed?.done === true && processed?.error === null, `error=${processed?.error}`);

  const health = await one(
    `select last_status, unprocessed_events::int as unprocessed,
            parents_awaiting_owner::int as waiting
       from chat.sync_health where source = 'jawwid_core'`);
  check('sync health is populated and reports a healthy boundary',
    health?.last_status === 'ok' && health.unprocessed === 0,
    `status=${health?.last_status} unprocessed=${health?.unprocessed}`);
  check('and surfaces the parent still awaiting an owner', health?.waiting === 1,
    `awaiting=${health?.waiting}`);

  // --- tenant isolation at the boundary ------------------------------------
  // Two organizations, two Jawwid Core instances, two signing keys. The same
  // Core identifier from each must not collide or overwrite.
  await db.query(`select chat.bootstrap_organization('academy-b', 'Academy B')`);

  const sharedCoreId = randomUUID();
  const intoA = await post(envelope('teacher.upserted', {
    core_teacher_id: sharedCoreId, display_name: 'A teacher',
  }));
  const intoB = await post(envelope('teacher.upserted', {
    core_teacher_id: sharedCoreId, display_name: 'B teacher',
  }), { keyId: KEY_ID_B, secret: SECRET_B });

  check('both organizations accept the same Core identifier',
    (await intoA.json()).status === 'applied' && (await intoB.json()).status === 'applied',
    'applied to each');

  const perOrg = await one(
    `select count(*)::int as n from chat.teacher where core_teacher_id = $1`, [sharedCoreId]);
  check('and it becomes two separate records, one per organization', perOrg.n === 2,
    `rows=${perOrg.n}`);

  const orgARow = await one(
    `select t.display_name from chat.teacher t
       join chat.organization o on o.id = t.organization_id
      where t.core_teacher_id = $1 and o.slug = 'jawwid'`, [sharedCoreId]);
  check("organization A's record was not overwritten by organization B's delivery",
    orgARow?.display_name === 'A teacher', `A has "${orgARow?.display_name}"`);

  // A payload that names another organization must not be able to reach it.
  const smuggle = await post(envelope('teacher.upserted', {
    core_teacher_id: randomUUID(), display_name: 'Smuggled',
    organization_id: (await one(`select id from chat.organization where slug='jawwid'`)).id,
    organization_slug: 'jawwid',
  }), { keyId: KEY_ID_B, secret: SECRET_B });
  check('a payload naming another organization is accepted but ignored',
    (await smuggle.json()).status === 'applied', 'applied');
  const smuggled = await one(
    `select o.slug from chat.teacher t join chat.organization o on o.id = t.organization_id
      where t.display_name = 'Smuggled'`);
  check("and lands in the signing key's organization, not the payload's",
    smuggled?.slug === 'academy-b', `landed in ${smuggled?.slug}`);

} finally {
  await db.end().catch(() => undefined);
  server.kill('SIGTERM');
  await sleep(500);
  server.kill('SIGKILL');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n--- ${results.length} runtime checks, ${failed.length} failed ---`);
process.exit(failed.length === 0 ? 0 : 1);
