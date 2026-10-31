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
//     key with QA accounts, never verify here), its dataset is the pinned one,
//     its lessonKey is the file's own, and it was not issued in the future
//     (more than 5 minutes of clock skew);
//   * the signature over the canonical JSON of the payload verifies;
//   * every approval's steps are exactly the steps its signers signed, each by
//     a different person (play.json included).
// An unsigned file (keyId and signature null) may only approve nothing.
//
// The key registry is validated for real (exact fields, env, ISO dates, ids,
// Ed25519), and the golden vector's TEST-ONLY key may never be listed in it.
//
// The ledger (apps/lessons/src/content/approvals-ledger.json) is the
// high-water mark of every signed lesson: {issued: {lessonKey: issuedAt}}. On
// any tree, each signed approvals file has exactly its issuedAt there and each
// entry has its signed file. It only grows, so no git history is needed to
// refuse a replay.
//
// `diff` (run in PR CI against the base branch) also refuses:
//   * a change that touches approvals-keys.json AND any approvals file or the
//     ledger (a key is added in its own reviewed PR, never with what it signs);
//   * a change to approvals (a file signed before or after) or the ledger together with the code that checks
//     them (PROTECTED: this script, the guards, the CI workflows, CODEOWNERS,
//     the engine's and the content check's readers) -- a PR never checks itself;
//   * deleting or unsigning a file that is signed on the base branch (withdraw
//     by exporting again: the API signs what is approved now). A lesson that is
//     removed is RETIRED, not deleted: a newer signed export with zero
//     approvals; its file and ledger entry stay, and it approves nothing;
//   * a changed signed file not strictly newer than the base ledger's entry for
//     its lesson (a replay of an export since withdrawn), or a brand-new one
//     whose lesson already has an entry, or that was issued more than
//     NEW_WITHIN_DAYS ago;
//   * a ledger that shrinks or goes back, or that does not record the new issuedAt;
//   * a changed approvals file signed by a retired key.
//
// This is EXACTLY the set any engine loader may read: approvals/*.json, nothing
// else. CI is the trust anchor: the production bundle is built only by the
// ci.yml lessons job, after this passes. What protects THIS script is the
// CODEOWNERS review of it (the owner's branch-protection setting). Node's
// built-in crypto, and git for diff.
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT = join(ROOT, 'apps', 'lessons', 'src', 'content');
const APPROVALS = join(CONTENT, 'approvals');
const KEYS = join(CONTENT, 'approvals-keys.json');
const LEDGER = join(CONTENT, 'approvals-ledger.json');
const GOLDEN = join(CONTENT, 'approvals.golden.json');
const PIN = join(ROOT, 'apps', 'lessons', 'quran-pin.json');
const REL_KEYS = 'apps/lessons/src/content/approvals-keys.json';
const REL_LEDGER = 'apps/lessons/src/content/approvals-ledger.json';
const REL_APPROVALS = 'apps/lessons/src/content/approvals/';
/** What checks approvals: never changed in the same PR as approvals (a PR never checks itself). */
export const PROTECTED = [
  'scripts/lessons/verify-approvals.mjs',
  'scripts/lessons/check-quran-content.py',
  'scripts/qa/guards.sh',
  '.github/workflows/',
  '.github/CODEOWNERS',
  'apps/lessons/src/content/quran-content.ts',
  'apps/lessons/src/play/mechanics.ts',
  'apps/lessons/src/play/signed.ts',
  'apps/lessons/src/fonts/AmiriQuran.ttf',
];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const KEY_ID = /^[0-9a-f]{16}$/;
const STEPS = ['check', 'teacher', 'scholar'];
const ENVS = ['production', 'staging'];
const SKEW_MS = 5 * 60 * 1000;
const NEW_WITHIN_DAYS = 7;

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

/** An ISO time as milliseconds (with or without milliseconds: one form to compare), or NaN. */
export const time = (t) => (typeof t === 'string' && ISO.test(t) ? Date.parse(t) : NaN);

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const sameKeys = (o, keys) => isObj(o) && Object.keys(o).sort().join() === keys;

/** Errors for the key registry: exact fields, env, ISO dates, a true id of an Ed25519 key, never the golden test key. */
export function keyRegistryErrors(doc, goldenKeyId) {
  if (!sameKeys(doc, 'about,keys') || !Array.isArray(doc.keys)) return ['approvals-keys.json must be exactly {about, keys: [...]}'];
  const errors = [];
  const ids = new Set();
  const optional = ['retiredAt', 'revokedAt', 'note'];
  for (const k of doc.keys) {
    const where = `approvals-keys.json: key ${isObj(k) ? k.id : k}`;
    const extra = isObj(k) ? Object.keys(k).filter((f) => !['id', 'publicKey', 'env', 'addedAt', ...optional].includes(f)) : [];
    if (!isObj(k) || extra.length || !['id', 'publicKey', 'env', 'addedAt'].every((f) => f in k)) {
      errors.push(`${where}: exactly {id, publicKey, env, addedAt, retiredAt?, revokedAt?, note?}${extra.length ? `; unknown: ${extra.join(', ')}` : ''}`);
      continue;
    }
    if (!KEY_ID.test(k.id) || ids.has(k.id)) errors.push(`${where}: the id is 16 lowercase hex, once`);
    ids.add(k.id);
    if (k.id === goldenKeyId) errors.push(`${where}: the golden vector's TEST-ONLY key is never a real key`);
    if (!ENVS.includes(k.env)) errors.push(`${where}: env is production or staging`);
    for (const f of ['addedAt', 'retiredAt', 'revokedAt']) if ((f === 'addedAt' || f in k) && Number.isNaN(time(k[f]))) errors.push(`${where}: ${f} is an ISO time`);
    if ('note' in k && typeof k.note !== 'string') errors.push(`${where}: note is text`);
    try {
      const der = Buffer.from(k.publicKey, 'base64');
      if (keyIdOf(der) !== k.id) errors.push(`${where}: not the id of its own public key`);
      if (createPublicKey({ key: der, format: 'der', type: 'spki' }).asymmetricKeyType !== 'ed25519') errors.push(`${where}: not an Ed25519 key`);
    } catch {
      errors.push(`${where}: not a base64 SPKI DER public key`);
    }
  }
  return errors;
}

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
export function check(envelope, { lessonKey, datasetId, keys, now = Date.now() }) {
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
  const issued = time(p.issuedAt);
  if (Number.isNaN(issued)) errors.push('payload.issuedAt must be an ISO time');
  else if (issued > now + SKEW_MS) errors.push(`payload.issuedAt ${p.issuedAt} is in the future`);
  const key = keys.find((k) => k.id === envelope.keyId);
  if (!key) return [...errors, `unknown key id ${envelope.keyId}: not in approvals-keys.json`];
  if (key.env !== 'production') errors.push(`key ${key.id} is a ${key.env} key: it never verifies production approvals`);
  if (key.revokedAt) errors.push(`key ${key.id} is revoked (${key.revokedAt}): nothing it signed is accepted`);
  if (key.retiredAt && !(issued < time(key.retiredAt))) errors.push(`key ${key.id} was retired at ${key.retiredAt}; this file was issued after`);
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

const LESSON_KEY = /^(quran-\d{3}|play)$/;

/** Errors for the ledger's shape: {about, issued: {lessonKey: ISO}}. */
export function ledgerErrors(doc) {
  if (!sameKeys(doc, 'about,issued') || !isObj(doc.issued)) return ['approvals-ledger.json must be exactly {about, issued: {lessonKey: issuedAt}}'];
  return Object.entries(doc.issued)
    .filter(([k, t]) => !LESSON_KEY.test(k) || Number.isNaN(time(t)))
    .map(([k, t]) => `approvals-ledger.json: ${k}: ${t} (a lesson key, an ISO time)`);
}

/** On any tree: each signed file has exactly its issuedAt in the ledger, and each entry has its signed file. */
export function ledgerMatches(signedIssued, ledger) {
  const errors = [];
  for (const [k, t] of Object.entries(signedIssued)) {
    if (!(k in ledger.issued)) errors.push(`${k} is signed but not in approvals-ledger.json: record its issuedAt there`);
    else if (time(ledger.issued[k]) !== time(t)) errors.push(`${k}: the ledger says ${ledger.issued[k]}, the file was issued ${t}`);
  }
  for (const k of Object.keys(ledger.issued)) if (!(k in signedIssued)) errors.push(`approvals-ledger.json: ${k} has no signed approvals file (a signed lesson is never deleted or unsigned)`);
  return errors;
}

const signedOf = (e) => isObj(e) && e.keyId !== null && e.keyId !== undefined;

/**
 * Errors for what a change does. `files` maps each changed approvals path to
 * {before, after} (null = absent); `ledger` is {before, after} (the documents);
 * `protectedChanged` lists the PROTECTED paths it changes.
 */
export function checkDiff({ keysChanged, protectedChanged = [], files, ledger, keys, now = Date.now() }) {
  const errors = [];
  // What can approve something: a file signed before or after (an unsigned file approves nothing), or the ledger.
  const changed = Object.keys(files).filter((p) => signedOf(files[p].before) || signedOf(files[p].after));
  const before = ledger?.before?.issued ?? {};
  const after = ledger?.after?.issued ?? {};
  const ledgerChanged = canonicalJson(before) !== canonicalJson(after);
  const approvalsChanged = changed.length > 0 || ledgerChanged;
  if (keysChanged && approvalsChanged) errors.push(`approvals-keys.json and approvals (${[...changed, ...(ledgerChanged ? [REL_LEDGER] : [])].join(', ')}) change together: add a key in its own PR, first`);
  if (approvalsChanged && protectedChanged.length) {
    errors.push(`approvals change together with the code that checks them (${protectedChanged.join(', ')}): change that code in its own PR, first`);
  }
  for (const [k, t] of Object.entries(before)) {
    if (!(k in after)) errors.push(`approvals-ledger.json: ${k} was removed (the ledger only grows)`);
    else if (!(time(after[k]) >= time(t))) errors.push(`approvals-ledger.json: ${k} goes back from ${t} to ${after[k]} (the ledger only grows)`);
  }
  for (const [path, f] of Object.entries(files)) {
    const lessonKey = lessonKeyOf(path.slice(path.lastIndexOf('/') + 1));
    if (signedOf(f.before) && !signedOf(f.after)) {
      errors.push(`${path}: signed on the base branch, so it is never deleted or unsigned -- withdraw by exporting it again`);
      continue;
    }
    if (!signedOf(f.after)) continue;
    const key = keys.find((k) => k.id === f.after.keyId);
    if (key?.retiredAt) errors.push(`${path}: signed by the retired key ${key.id}; export it again under the current key`);
    const issued = time(f.after.payload?.issuedAt);
    const mark = lessonKey ? before[lessonKey] : undefined;
    if (mark !== undefined) {
      if (!f.before) errors.push(`${path}: a new file, but ${lessonKey} is already in the ledger (${mark}): a deleted lesson never comes back`);
      if (!(issued > time(mark))) errors.push(`${path}: issued ${f.after.payload?.issuedAt}, not after the ledger's ${mark} -- an older export (a replay) is refused`);
    } else if (signedOf(f.before)) {
      if (!(issued > time(f.before.payload?.issuedAt))) errors.push(`${path}: issued ${f.after.payload?.issuedAt}, not after the base branch's ${f.before.payload?.issuedAt} -- a replay is refused`);
    } else if (!(issued >= now - NEW_WITHIN_DAYS * 86_400_000)) {
      errors.push(`${path}: a first export must be recent (within ${NEW_WITHIN_DAYS} days); this one was issued ${f.after.payload?.issuedAt}`);
    }
    if (lessonKey && time(after[lessonKey]) !== issued) errors.push(`${path}: approvals-ledger.json must record ${lessonKey} at ${f.after.payload?.issuedAt}`);
  }
  return errors;
}

function lessonKeyOf(file) {
  if (file === 'play.json') return 'play';
  const m = /^surah-(\d{3})\.json$/.exec(file);
  return m ? `quran-${m[1]}` : null;
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const EMPTY_LEDGER = { about: '', issued: {} };

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
  // --no-renames: a rename is a delete plus an add, each judged as such.
  const names = git('diff', '--name-only', '--no-renames', ref, '--', REL_KEYS, REL_LEDGER, REL_APPROVALS, ...PROTECTED).split('\n').filter(Boolean);
  const read = (path, at) => {
    try {
      return JSON.parse(at ? git('show', `${at}:${path}`) : readFileSync(join(ROOT, path), 'utf8'));
    } catch {
      return null;
    }
  };
  const files = {};
  for (const n of names) if (n.startsWith(REL_APPROVALS)) files[n] = { before: read(n, ref), after: read(n, null) };
  const protectedChanged = names.filter((n) => PROTECTED.some((p) => (p.endsWith('/') ? n.startsWith(p) : n === p)));
  const keys = JSON.parse(readFileSync(KEYS, 'utf8')).keys;
  const ledger = { before: read(REL_LEDGER, ref) ?? EMPTY_LEDGER, after: read(REL_LEDGER, null) ?? EMPTY_LEDGER };
  const errors = checkDiff({ keysChanged: names.includes(REL_KEYS), protectedChanged, files, ledger, keys });
  for (const e of errors) console.log(`verify-approvals diff: ${e}`);
  console.log(
    `verify-approvals diff: against ${ref}, ${Object.keys(files).length} approvals file(s) changed; ` +
      `keys ${names.includes(REL_KEYS) ? 'changed' : 'unchanged'}; ${protectedChanged.length} checking file(s) changed`,
  );
  return errors.length ? 1 : 0;
}

function selftest() {
  // The shared golden vectors: envelopes the API's signer produced (lesson-content.spec.ts makes
  // the same bytes from its test-only seed) verify here, and check-quran-content.py reads them.
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const gkeys = [golden.key];
  const now = Date.parse('2026-10-30T00:00:00Z');
  const gctx = { lessonKey: golden.envelope.payload.lessonKey, datasetId: golden.envelope.payload.datasetId, keys: gkeys, now };
  const failed = [];
  const goldenErrors = check(golden.envelope, gctx);
  if (goldenErrors.length) failed.push(`the golden vector: ${goldenErrors.join('; ')}`);
  // Non-ASCII: the canonical bytes of an Arabic value, and its signature, are the same everywhere.
  const g = golden.arabic;
  if (canonicalJson(g.value) !== g.canonical) failed.push('the Arabic golden vector: canonical JSON differs');
  const gpub = createPublicKey({ key: Buffer.from(golden.key.publicKey, 'base64'), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(g.canonical, 'utf8'), gpub, Buffer.from(g.signature, 'base64'))) failed.push('the Arabic golden vector: the signature does not verify');

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
    // 12:00:00.000Z vs 12:00:00Z: the same instant, whatever the form (a string compare says otherwise).
    ['retired at the very instant it signed, written without ms', signed(payload), withKey({ retiredAt: '2026-10-29T12:00:00Z' }), false],
    ['retired a second after, written without ms', signed(payload), withKey({ retiredAt: '2026-10-29T12:00:01Z' }), true],
    ['issued in the future', signed({ ...payload, issuedAt: '2026-10-30T00:10:00.000Z' }), ctx, false],
    ['issued within the clock skew', signed({ ...payload, issuedAt: '2026-10-30T00:04:00.000Z' }), ctx, true],
    ['steps not signed', signed({ ...payload, approvals: [{ ...a0, signers: a0.signers.slice(1) }] }), ctx, false],
    ['one person, two steps', signed({ ...payload, approvals: [{ ...a0, signers: a0.signers.map((s) => ({ ...s, staffId: 'one' })) }] }), ctx, false],
    ['the pre-signature format', { surah: 112, lessonKey: 'quran-112', approvals: [] }, ctx, false],
  ];
  for (const [name, env, c, ok] of cases) if ((check(env, c).length === 0) !== ok) failed.push(name);

  // The key registry.
  const reg = (k) => ({ about: '', keys: [k] });
  const registry = [
    ['a valid key', reg(key), true],
    ['an empty registry', { about: '', keys: [] }, true],
    ['a typo (retired_at)', reg({ ...key, retired_at: '2027-01-01T00:00:00Z' }), false],
    ['env qa', reg({ ...key, env: 'qa' }), false],
    ['a date that is not ISO', reg({ ...key, addedAt: '29/10/2026' }), false],
    ['a wrong id', reg({ ...key, id: 'ffffffffffffffff' }), false],
    ['the golden TEST-ONLY key', reg(golden.key), false],
    ['the same key twice', { about: '', keys: [key, key] }, false],
    ['no addedAt', reg({ id: key.id, publicKey: key.publicKey, env: 'production' }), false],
  ];
  for (const [name, doc, ok] of registry) if ((keyRegistryErrors(doc, golden.key.id).length === 0) !== ok) failed.push(`keys: ${name}`);

  const at = (t) => signed({ ...payload, issuedAt: t });
  const older = at('2026-10-01T00:00:00.000Z');
  const newer = at('2026-10-02T00:00:00.000Z');
  const stale = at('2026-08-01T00:00:00.000Z');
  const recent = at('2026-10-29T00:00:00.000Z');
  const R = { 'quran-112': '2026-10-29T00:00:00.000Z' };
  const unsignedEmpty = { payload: { ...payload, approvals: [], issuedAt: null }, keyId: null, signature: null };
  const f = 'apps/lessons/src/content/approvals/surah-112.json';
  const L = (issued) => ({ about: '', issued });
  const one = (before, after, lb, la, over = {}) => ({ keysChanged: false, files: { [f]: { before, after } }, ledger: { before: L(lb), after: L(la) }, keys: [key], now, ...over });
  const diffs = [
    ['a newer export', one(older, newer, { 'quran-112': '2026-10-01T00:00:00.000Z' }, { 'quran-112': '2026-10-02T00:00:00.000Z' }), true],
    ['a replayed older export', one(newer, older, { 'quran-112': '2026-10-02T00:00:00.000Z' }, { 'quran-112': '2026-10-01T00:00:00.000Z' }), false],
    ['the same export again', one(newer, newer, { 'quran-112': '2026-10-02T00:00:00.000Z' }, { 'quran-112': '2026-10-02T00:00:00.000Z' }), false],
    ['a newer export the ledger does not record', one(older, newer, { 'quran-112': '2026-10-01T00:00:00.000Z' }, { 'quran-112': '2026-10-01T00:00:00.000Z' }), false],
    ['a first export, recent (1 day)', one(null, recent, {}, R), true],
    ['a first export, stale', one(null, stale, {}, { 'quran-112': '2026-08-01T00:00:00.000Z' }), false],
    ['a signed file deleted', one(newer, null, { 'quran-112': '2026-10-02T00:00:00.000Z' }, { 'quran-112': '2026-10-02T00:00:00.000Z' }), false],
    ['a signed file unsigned', one(newer, unsignedEmpty, { 'quran-112': '2026-10-02T00:00:00.000Z' }, { 'quran-112': '2026-10-02T00:00:00.000Z' }), false],
    // PR 1 deleted it and dropped the entry (refused above); were it to slip, PR 2 re-adds the old export:
    ['re-added after a deletion', one(null, older, { 'quran-112': '2026-10-02T00:00:00.000Z' }, { 'quran-112': '2026-10-01T00:00:00.000Z' }), false],
    ['the ledger loses an entry', { keysChanged: false, files: {}, ledger: { before: L({ 'quran-112': '2026-10-02T00:00:00.000Z' }), after: L({}) }, keys: [key], now }, false],
    ['keys and approvals together', one(null, recent, {}, R, { keysChanged: true }), false],
    ['keys and the ledger together', { keysChanged: true, files: {}, ledger: { before: L({}), after: L({ 'quran-112': '2026-10-02T00:00:00.000Z' }) }, keys: [key], now }, false],
    ['a key alone', { keysChanged: true, files: {}, ledger: { before: L({}), after: L({}) }, keys: [key], now }, true],
    ['approvals with the verifier', one(null, recent, {}, R, { protectedChanged: ['scripts/lessons/verify-approvals.mjs'] }), false],
    ['the verifier alone', { keysChanged: false, protectedChanged: ['scripts/lessons/verify-approvals.mjs'], files: {}, ledger: { before: L({}), after: L({}) }, keys: [key], now }, true],
    ['signed by a retired key', one(null, recent, {}, R, { keys: [{ ...key, retiredAt: '2999-01-01T00:00:00Z' }] }), false],
    ['an unsigned empty file, new', one(null, unsignedEmpty, {}, {}), true],
    ['a lesson retired: a newer signed export with zero approvals', one(newer, signed({ ...payload, approvals: [], issuedAt: '2026-10-03T00:00:00.000Z' }), { 'quran-112': '2026-10-02T00:00:00.000Z' }, { 'quran-112': '2026-10-03T00:00:00.000Z' }), true],
    ['a first export, 8 days old', one(null, at('2026-10-22T00:00:00.000Z'), {}, { 'quran-112': '2026-10-22T00:00:00.000Z' }), false],
    ['an unsigned empty file with the checking code (approves nothing)', one(null, unsignedEmpty, {}, {}, { protectedChanged: ['apps/lessons/src/play/mechanics.ts'] }), true],
  ];
  for (const [name, input, ok] of diffs) if ((checkDiff(input).length === 0) !== ok) failed.push(`diff: ${name}`);
  if (ledgerMatches({ 'quran-112': '2026-10-02T00:00:00Z' }, L({ 'quran-112': '2026-10-02T00:00:00.000Z' })).length) failed.push('ledger: the same instant in two forms');
  if (!ledgerMatches({}, L({ 'quran-112': '2026-10-02T00:00:00.000Z' })).length) failed.push('ledger: an entry without its file was accepted');

  for (const x of failed) console.log(`verify-approvals selftest: FAIL ${x}`);
  if (!failed.length) {
    console.log(
      `verify-approvals selftest: the golden vectors verify (one Arabic); ${cases.length} file cases, ${registry.length} key-registry cases ` +
        `and ${diffs.length} change cases, each as expected`,
    );
  }
  return failed.length ? 1 : 0;
}

function main() {
  const datasetId = JSON.parse(readFileSync(PIN, 'utf8')).datasetId;
  const doc = JSON.parse(readFileSync(KEYS, 'utf8'));
  const goldenKeyId = JSON.parse(readFileSync(GOLDEN, 'utf8')).key.id;
  const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : null;
  const setup = [...keyRegistryErrors(doc, goldenKeyId), ...(ledger ? ledgerErrors(ledger) : ['approvals-ledger.json is missing'])];
  if (setup.length) {
    for (const e of setup) console.log(`verify-approvals: ${e}`);
    return 1;
  }
  const keys = doc.keys;
  const files = existsSync(APPROVALS) ? readdirSync(APPROVALS).filter((f) => f.endsWith('.json')).sort() : [];
  const signedIssued = {};
  let failed = 0;
  for (const f of files) {
    const lessonKey = lessonKeyOf(f);
    const envelope = JSON.parse(readFileSync(join(APPROVALS, f), 'utf8'));
    const errors = lessonKey ? check(envelope, { lessonKey, datasetId, keys }) : ['not an approvals file name (surah-NNN.json or play.json)'];
    if (lessonKey && signedOf(envelope)) signedIssued[lessonKey] = envelope.payload?.issuedAt;
    for (const e of errors) console.log(`verify-approvals: ${f}: ${e}`);
    if (errors.length) failed++;
  }
  const mismatch = ledgerMatches(signedIssued, ledger);
  for (const e of mismatch) console.log(`verify-approvals: ${e}`);
  console.log(`verify-approvals: ${files.length} approvals file(s), ${files.length - failed} verified; ${keys.length} key(s) known; ledger ${mismatch.length ? 'MISMATCHED' : 'matches'}`);
  return failed || mismatch.length ? 1 : 0;
}

const mode = process.argv[2];
process.exit(mode === 'selftest' ? selftest() : mode === 'diff' ? diffMain() : main());
