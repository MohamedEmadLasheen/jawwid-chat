#!/usr/bin/env node
// PD-49: verify every lesson-content approvals file (plan F.3).
//
//   node scripts/lessons/verify-approvals.mjs            every apps/lessons/src/content/approvals/*.json
//   node scripts/lessons/verify-approvals.mjs diff       what this change does to approvals, against its base branch
//   node scripts/lessons/verify-approvals.mjs selftest
//
// An approvals file is the API's signed export: {payload, keyId, signature},
// payload = {v: 1, env, issuedAt, datasetId, lessonKey, approvals}. It is
// accepted only when:
//   * keyId names a key of apps/lessons/src/content/approvals-keys.json whose id
//     is truly its key's id, an Ed25519 key for env "production", not revoked,
//     and -- if retired -- retired after this file was issued;
//   * the payload is env "production" (staging approvals, signed by a staging
//     key with QA accounts, never verify here), its dataset is the pinned one
//     and its lessonKey is the file's own;
//   * the signature over the canonical JSON of the payload verifies;
//   * every approval's steps are exactly the steps its signers signed, each by
//     a different person (play.json included).
// An unsigned file (keyId and signature null) may only approve nothing.
//
// `diff` (run in PR CI against the base branch) also refuses:
//   * a change that touches approvals-keys.json AND any approvals file (a key is
//     added in its own reviewed PR, never with what it signs);
//   * a changed approvals file that is not strictly newer (issuedAt) than the
//     base branch's copy -- an old export re-committed by a revert or a stale
//     branch (a replay of something since withdrawn) fails;
//   * a changed approvals file signed by a retired key.
//
// This is EXACTLY the set any engine loader may read: approvals/*.json, nothing
// else. CI is the trust anchor: the production bundle is built only by the
// ci.yml lessons job, after this passes. Node's built-in crypto, and git for diff.
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT = join(ROOT, 'apps', 'lessons', 'src', 'content');
const APPROVALS = join(CONTENT, 'approvals');
const KEYS = join(CONTENT, 'approvals-keys.json');
const GOLDEN = join(CONTENT, 'approvals.golden.json');
const PIN = join(ROOT, 'apps', 'lessons', 'quran-pin.json');
const REL_KEYS = 'apps/lessons/src/content/approvals-keys.json';
const REL_APPROVALS = 'apps/lessons/src/content/approvals/';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const STEPS = ['check', 'teacher', 'scholar'];

/** The same bytes as canonicalJson() in apps/lessons and apps/api. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

/** A key's id: the first 16 hex of the SHA-256 of its SPKI DER. */
export function keyIdOf(spkiDer) {
  return createHash('sha256').update(spkiDer).digest('hex').slice(0, 16);
}

const sameKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === keys;

/** Errors for the approvals themselves: steps are exactly the steps signed, each by a different person. */
function approvalErrors(approvals) {
  const errors = [];
  const ids = new Set();
  for (const a of approvals) {
    if (!sameKeys(a, 'approvalSha256,id,signers,steps') || typeof a.id !== 'string' || ids.has(a.id) || !Array.isArray(a.steps) || !Array.isArray(a.signers)) {
      errors.push(`approval ${a?.id}: exactly {id, approvalSha256, steps, signers}, once per item`);
      continue;
    }
    ids.add(a.id);
    const ok = a.signers.every((g) => sameKeys(g, 'at,staffId,step') && STEPS.includes(g.step) && typeof g.staffId === 'string' && g.staffId && ISO.test(g.at));
    const signed = a.signers.map((g) => g.step);
    const staff = a.signers.map((g) => g.staffId);
    if (!ok || [...a.steps].sort().join() !== [...signed].sort().join() || new Set(signed).size !== signed.length || new Set(staff).size !== staff.length) {
      errors.push(`approval ${a.id}: the steps must be exactly the steps signed, each by a different person`);
    }
  }
  return errors;
}

/** Errors for one approvals file (empty = it verifies). */
export function check(envelope, { lessonKey, datasetId, keys }) {
  const errors = [];
  if (!sameKeys(envelope, 'keyId,payload,signature')) return ['must be exactly {payload, keyId, signature}'];
  const p = envelope.payload;
  if (!sameKeys(p, 'approvals,datasetId,env,issuedAt,lessonKey,v') || p.v !== 1 || !Array.isArray(p.approvals)) {
    return ['payload must be exactly {v: 1, env, issuedAt, datasetId, lessonKey, approvals}'];
  }
  if (p.env !== 'production') errors.push(`payload.env is ${p.env}: only production approvals reach children`);
  if (p.datasetId !== datasetId) errors.push(`payload.datasetId ${p.datasetId} is not the pinned ${datasetId}`);
  if (p.lessonKey !== lessonKey) errors.push(`payload.lessonKey ${p.lessonKey} is not this file's ${lessonKey}`);
  errors.push(...approvalErrors(p.approvals));
  if (envelope.keyId === null) {
    if (envelope.signature !== null || p.approvals.length > 0) errors.push('an unsigned file may only approve nothing');
    return errors;
  }
  if (!ISO.test(p.issuedAt)) errors.push('payload.issuedAt must be an ISO time');
  const key = keys.find((k) => k.id === envelope.keyId);
  if (!key) return [...errors, `unknown key id ${envelope.keyId}: not in approvals-keys.json`];
  if (key.env !== 'production') errors.push(`key ${key.id} is a ${key.env} key: it never verifies production approvals`);
  if (key.revokedAt) errors.push(`key ${key.id} is revoked (${key.revokedAt}): nothing it signed is accepted`);
  if (key.retiredAt && !(p.issuedAt < key.retiredAt)) errors.push(`key ${key.id} was retired at ${key.retiredAt}; this file was issued after`);
  let pub;
  try {
    const der = Buffer.from(key.publicKey, 'base64');
    if (keyIdOf(der) !== key.id) return [...errors, `approvals-keys.json: key ${key.id} is not the id of its own public key`];
    pub = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (pub.asymmetricKeyType !== 'ed25519') return [...errors, `key ${key.id} is not an Ed25519 key`];
  } catch {
    return [...errors, `key ${key.id}: not a base64 SPKI DER public key`];
  }
  const ok = typeof envelope.signature === 'string' && verify(null, Buffer.from(canonicalJson(p), 'utf8'), pub, Buffer.from(envelope.signature, 'base64'));
  if (!ok) errors.push(`the signature does not verify under key ${key.id} (the file was changed after the API signed it, or never signed)`);
  return errors;
}

/** Errors for what a change does: `files` maps each changed approvals path to {before, after} (null = absent). */
export function checkDiff({ keysChanged, files, keys }) {
  const errors = [];
  const changed = Object.keys(files);
  if (keysChanged && changed.length) errors.push(`approvals-keys.json and approvals (${changed.join(', ')}) change together: add a key in its own PR, first`);
  for (const [path, { before, after }] of Object.entries(files)) {
    if (!after) continue; // removing approvals is always allowed: it shows less
    if (after.keyId !== null) {
      const key = keys.find((k) => k.id === after.keyId);
      if (key?.retiredAt) errors.push(`${path}: signed by the retired key ${key.id}; export it again under the current key`);
    }
    if (before && before.keyId !== null && after.keyId !== null && !(after.payload?.issuedAt > before.payload?.issuedAt)) {
      errors.push(`${path}: issued ${after.payload?.issuedAt}, not after the base branch's ${before.payload?.issuedAt} -- an older export (a replay) is refused`);
    }
  }
  return errors;
}

function lessonKeyOf(file) {
  if (file === 'play.json') return 'play';
  const m = /^surah-(\d{3})\.json$/.exec(file);
  return m ? `quran-${m[1]}` : null;
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function diffMain() {
  const base = process.env.APPROVALS_BASE_REF || process.env.GITHUB_BASE_REF || 'main';
  const ref = `origin/${base}`;
  const has = () => {
    try {
      git('rev-parse', '--verify', '--quiet', ref);
      return true;
    } catch {
      return false;
    }
  };
  if (!has() && process.env.GITHUB_BASE_REF) {
    try {
      git('fetch', '--no-tags', '--depth=1', 'origin', `+refs/heads/${base}:refs/remotes/${ref}`);
    } catch {
      /* reported below */
    }
  }
  if (!has()) {
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      console.log(`verify-approvals diff: cannot read ${ref}; a pull request's approvals cannot be compared, so this FAILS`);
      return 1;
    }
    console.log(`verify-approvals diff: no ${ref} here; nothing to compare (pull requests are compared in CI)`);
    return 0;
  }
  const names = git('diff', '--name-only', ref, '--', REL_KEYS, REL_APPROVALS).split('\n').filter(Boolean);
  const read = (path, at) => {
    try {
      return JSON.parse(at ? git('show', `${at}:${path}`) : readFileSync(join(ROOT, path), 'utf8'));
    } catch {
      return null;
    }
  };
  const files = {};
  for (const n of names) if (n.startsWith(REL_APPROVALS)) files[n] = { before: read(n, ref), after: read(n, null) };
  const keys = JSON.parse(readFileSync(KEYS, 'utf8')).keys;
  const errors = checkDiff({ keysChanged: names.includes(REL_KEYS), files, keys });
  for (const e of errors) console.log(`verify-approvals diff: ${e}`);
  console.log(`verify-approvals diff: against ${ref}, ${Object.keys(files).length} approvals file(s) changed; keys ${names.includes(REL_KEYS) ? 'changed' : 'unchanged'}`);
  return errors.length ? 1 : 0;
}

function selftest() {
  // The shared golden vector: an envelope the API's signer produced (lesson-content.spec.ts makes
  // the same bytes from its test-only seed) verifies here, and check-quran-content.py reads it.
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const gkeys = [golden.key];
  const gctx = { lessonKey: golden.envelope.payload.lessonKey, datasetId: golden.envelope.payload.datasetId, keys: gkeys };
  const failed = [];
  const goldenErrors = check(golden.envelope, gctx);
  if (goldenErrors.length) failed.push(`the golden vector: ${goldenErrors.join('; ')}`);

  // A throwaway signer for the cases.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  const key = { id: keyIdOf(der), publicKey: der.toString('base64'), env: 'production', addedAt: '2026-10-29T00:00:00Z' };
  const signed = (pl) => ({ payload: pl, keyId: key.id, signature: sign(null, Buffer.from(canonicalJson(pl), 'utf8'), privateKey).toString('base64') });
  const payload = golden.envelope.payload;
  const ctx = { ...gctx, keys: [key] };
  const withKey = (over) => ({ ...ctx, keys: [{ ...key, ...over }] });
  const a0 = payload.approvals[0];
  const cases = [
    ['signed', signed(payload), ctx, true],
    ['changed after signing', { ...signed(payload), payload: { ...payload, approvals: [] } }, ctx, false],
    ['unknown key', { ...signed(payload), keyId: 'ffffffffffffffff' }, ctx, false],
    ['unsigned with approvals', { payload, keyId: null, signature: null }, ctx, false],
    ['unsigned and empty', { payload: { ...payload, approvals: [], issuedAt: null }, keyId: null, signature: null }, ctx, true],
    ['another lesson', signed({ ...payload, lessonKey: 'quran-113' }), ctx, false],
    ['another dataset', signed({ ...payload, datasetId: 'test-2' }), ctx, false],
    ['a staging payload', signed({ ...payload, env: 'staging' }), ctx, false],
    ['a staging key', signed(payload), withKey({ env: 'staging' }), false],
    ['a revoked key', signed(payload), withKey({ revokedAt: '2026-01-01T00:00:00Z' }), false],
    ['a key retired before it signed', signed(payload), withKey({ retiredAt: '2000-01-01T00:00:00Z' }), false],
    ['a key retired after it signed', signed(payload), withKey({ retiredAt: '2999-01-01T00:00:00Z' }), true],
    ['steps not signed', signed({ ...payload, approvals: [{ ...a0, signers: a0.signers.slice(1) }] }), ctx, false],
    ['one person, two steps', signed({ ...payload, approvals: [{ ...a0, signers: a0.signers.map((g) => ({ ...g, staffId: 'one' })) }] }), ctx, false],
    ['the pre-signature format', { surah: 112, lessonKey: 'quran-112', approvals: [] }, ctx, false],
  ];
  for (const [name, env, c, ok] of cases) if ((check(env, c).length === 0) !== ok) failed.push(name);

  const older = signed({ ...payload, issuedAt: '2026-10-01T00:00:00.000Z' });
  const newer = signed({ ...payload, issuedAt: '2026-10-02T00:00:00.000Z' });
  const f = 'apps/lessons/src/content/approvals/surah-112.json';
  const diffs = [
    ['a newer export', { keysChanged: false, files: { [f]: { before: older, after: newer } }, keys: [key] }, true],
    ['a replayed older export', { keysChanged: false, files: { [f]: { before: newer, after: older } }, keys: [key] }, false],
    ['the same export again', { keysChanged: false, files: { [f]: { before: newer, after: newer } }, keys: [key] }, false],
    ['keys and approvals together', { keysChanged: true, files: { [f]: { before: null, after: newer } }, keys: [key] }, false],
    ['a key alone', { keysChanged: true, files: {}, keys: [key] }, true],
    ['approvals removed', { keysChanged: false, files: { [f]: { before: newer, after: null } }, keys: [key] }, true],
    ['signed by a retired key', { keysChanged: false, files: { [f]: { before: null, after: newer } }, keys: [{ ...key, retiredAt: '2999-01-01T00:00:00Z' }] }, false],
  ];
  for (const [name, input, ok] of diffs) if ((checkDiff(input).length === 0) !== ok) failed.push(`diff: ${name}`);

  for (const x of failed) console.log(`verify-approvals selftest: FAIL ${x}`);
  if (!failed.length) console.log(`verify-approvals selftest: the golden vector verifies; ${cases.length} file cases and ${diffs.length} change cases, each as expected`);
  return failed.length ? 1 : 0;
}

function main() {
  const datasetId = JSON.parse(readFileSync(PIN, 'utf8')).datasetId;
  const keys = JSON.parse(readFileSync(KEYS, 'utf8')).keys;
  const ids = keys.map((k) => k.id);
  if (!Array.isArray(keys) || new Set(ids).size !== ids.length || !keys.every((k) => sameKeys(k, Object.keys(k).sort().join()) && k.id && k.publicKey && k.env)) {
    console.log('verify-approvals: approvals-keys.json must list keys with unique ids, each with its publicKey and env');
    return 1;
  }
  const files = existsSync(APPROVALS) ? readdirSync(APPROVALS).filter((f) => f.endsWith('.json')).sort() : [];
  let failed = 0;
  for (const f of files) {
    const lessonKey = lessonKeyOf(f);
    const errors = lessonKey ? check(JSON.parse(readFileSync(join(APPROVALS, f), 'utf8')), { lessonKey, datasetId, keys }) : ['not an approvals file name (surah-NNN.json or play.json)'];
    for (const e of errors) console.log(`verify-approvals: ${f}: ${e}`);
    if (errors.length) failed++;
  }
  console.log(`verify-approvals: ${files.length} approvals file(s), ${files.length - failed} verified; ${keys.length} key(s) known`);
  return failed ? 1 : 0;
}

const mode = process.argv[2];
process.exit(mode === 'selftest' ? selftest() : mode === 'diff' ? diffMain() : main());
