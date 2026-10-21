# Backup, Restore and Disaster Recovery

Owner: AI #7 · Date: 2026-09-05 · Encryption and restore corrected, re-drilled: 2026-10-21

## 1. What is backed up

| Data | Method | Frequency | Retention | Status |
|---|---|---|---|---|
| Postgres (authoritative state) | Managed provider continuous backup + PITR | continuous | 7–30 days | **not provisioned** |
| Postgres (portable copy) | `scripts/infra/backup-db.sh` (`pg_dump -Fc`, encrypted) | before every deploy; nightly | 30 days | **implemented and drilled** |
| Object storage | Provider versioning + lifecycle rules | continuous | 30 days | **not provisioned** |
| Redis | Not backed up by design | — | — | — |
| Secrets | Secret store's own durability | — | — | not provisioned |
| Container images | Registry, tagged by commit | per deploy | 90 days | pipeline written |

Redis is deliberately not backed up: it holds cache entries and in-flight jobs,
not customer data. It is configured `appendonly yes` so queued jobs survive a
restart, and `noeviction` so it cannot silently drop pending work. If Redis is
lost, queued jobs are lost — which is why jobs must be reconstructible from the
database outbox (AI #2). **Redis must never be the source of truth.**

## 2. Two layers, on purpose

The provider's continuous backup is the primary line: it supports point-in-time
recovery and is what a real disaster uses. The `pg_dump` copy exists because a
provider snapshot cannot be restored onto a laptop to answer "what did this
table look like on Tuesday", and because a compromise of the provider account
takes its snapshots with it.

## 3. Taking a backup

```bash
APP_ENV=production BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/backup.key \
  DATABASE_URL=... scripts/infra/backup-db.sh --out ./backups --schema chat
```

A backup is a complete copy of every family's messages, so it is **encrypted**,
and the plaintext archive never exists as a file: `pg_dump` writes to a pipe and
`openssl` encrypts the stream. It writes three files:

| File | What it is |
|---|---|
| `NAME.dump.enc` | `openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter 600000` over the `pg_dump -Fc` stream |
| `NAME.dump.enc.hmac` | `jawwid-backup-v1 hmac-sha256 pbkdf2-sha256 <iter> <salt> <tag>` — HMAC-SHA256 over the whole `.enc`, under a key derived separately (fresh salt) from the same secret |
| `NAME.dump.enc.sha256` | unkeyed checksum, for checking a copy without the key |

**Keep all three together.** Restore refuses an archive without its `.hmac`.

### The key

Set exactly one of:

- `BACKUP_ENCRYPTION_KEY_FILE` — a path; the file's **first line** is the
  secret. Preferred. Generate one with
  `openssl rand -base64 48 > backup.key && chmod 600 backup.key`.
- `BACKUP_ENCRYPTION_PASSPHRASE` — the secret itself, at least 16 characters.
  This is what the deploy workflows use, from the GitHub Environment secret of
  the same name.

The secret never appears on a command line, in a log or in an artefact:
`openssl` is told where it is (`-pass file:PATH` / `-pass env:VAR`), and the
HMAC is assembled with shell builtins rather than `openssl dgst -hmac KEY`,
which would put the derived key in every `ps` listing.

**Hold the secret somewhere you can read it back.** GitHub secrets are
write-only. If the passphrase exists only there, every backup the deploy
workflow takes is unrecoverable by anyone. Store it in the team's password
manager *before* setting it in GitHub, and restore one archive with that copy.

### When there is no key

The backup is **refused before `pg_dump` runs** unless `APP_ENV` is `local`,
`test` or `ci`. An unset `APP_ENV` is not local. Dumping and then deleting
would put an unencrypted copy on disk for the duration, and leave it there on a
failure part way through. `--allow-plaintext` overrides the refusal for the one
case it exists for — an archive going straight into an encrypted bucket — and
makes that a recorded decision. A key that is configured but unusable (missing
file, too short, both variables set) is an error everywhere, never a silent
fall back to plaintext.

### Why `openssl`, and what it does and does not give you

`openssl` is the one tool present on a stock macOS (LibreSSL), on the GitHub
runner and in the Debian `postgres` image; `age` and `gpg` are on none of them
reliably, and a backup step that needs a tool the host lacks is a backup that
silently does not happen. Archives written by LibreSSL 3.3 decrypt under OpenSSL
3.5 and vice versa (verified).

`openssl enc` has no authenticated mode, and CBC alone is malleable. The keyed
`.hmac` (encrypt-then-MAC) is what makes the archive **authenticated**: a wrong
key, a modified archive and a modified tag are all refused before anything is
decrypted. The `.sha256` is not that check — whoever can edit the archive can
rewrite it — and the drill proves the tag still refuses an archive whose
`.sha256` was rewritten to match.

### Recovering by hand

If the scripts are unavailable, `openssl` alone recovers the archive
(`<iter>` is the fourth field of the `.hmac`; verify the tag first if you can):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter <iter> \
  -pass file:backup.key -in NAME.dump.enc | pg_restore --list
```

### Other notes

- Which `pg_dump` runs is a version decision: `PG_IMAGE` names a client image
  and outranks whatever is on `PATH` (default `postgres:17-alpine` when no
  local `pg_dump` exists). Its major version must match the **server's**.
- Encrypted backups mount nothing into the container — the dump crosses the
  docker boundary as a stream. An unencrypted (local) backup still writes
  through a mount, and on macOS `/tmp` and `/private/tmp` usually are **not**
  shared with the Docker VM: the dump is written inside the VM and silently
  disappears while docker exits 0. The script detects a missing output file
  and says so.
- The checksum records the **basename**, so it still verifies after the dump is
  copied elsewhere.
- `--no-owner`, but **not** `--no-privileges`: the owner role differs between
  environments, but the roles named in the GRANTs (`anon`, `authenticated`,
  `service_role`, `chat_app`, `chat_service`) are ours and exist wherever the
  schema does. A `--no-privileges` archive restores into a database the
  application cannot read (§4.2).
- Every file written is mode `600`.

## 4. Restoring

```bash
BACKUP_ENCRYPTION_KEY_FILE=backup.key scripts/infra/restore-db.sh \
  --file backups/NAME.dump.enc --into postgres://postgres:postgres@localhost:55489/recovered --schema chat
```

Before it connects to the target, `restore-db.sh`, in order: verifies the
`.sha256` if present; for an `.enc`, requires a key and the `.hmac`, copies the
archive to a private directory (so it cannot be swapped between check and use),
verifies the HMAC tag, and decrypts it once into nothing as a trial. Any
failure stops it there:

```
REFUSING TO RESTORE: the integrity tag does not match.

Either the key is wrong, or the archive or its .hmac file was modified after the
backup was taken. Nothing has been decrypted and the target was not touched.
```

The restore itself decrypts straight into `pg_restore`'s stdin (over
`docker run -i` when the client is containerised). The plaintext never touches
disk. `PG_IMAGE` selects the `pg_restore` exactly as it selects the `pg_dump`:
`pg_restore` refuses an archive from a newer `pg_dump`.

It also refuses a target whose URL looks like production unless
`--i-understand-this-overwrites-production` is passed.

### 4.1 The recovery unit is the `chat` schema

It used to be "Core's `public` schema plus `chat`", because `chat.core_*` were
views over Jawwid Core's tables. That coupling is gone (RT-023), and the Core
shim the old procedure told you to load, `db/test/00_core_shim.sql`, no longer
exists. A `--schema chat` dump restores on its own into a bare `postgres:17`,
because `restore-db.sh` prepares the three things it cannot carry:

- **Extensions.** `btree_gist` and `pg_trgm` live in `public`, outside the
  dump, but chat's exclusion constraints and search indexes need them. The list
  is read from `supabase/migrations`, so a new extension cannot silently break
  restores.
- **Roles.** Attributes and memberships are cluster-level and appear in no
  schema-scoped dump. `chat_app` must be `INHERIT` and a member of
  `authenticated`, or it matches no policy; `chat_service` must be `BYPASSRLS`.
  Restated to mirror migrations `20260905091150` and `20260910120200`, with no
  passwords (set those out of band, as for a migrated database). The restoring
  role therefore needs `CREATE ROLE`; if the target forbids it, pass
  `--no-privileges` and understand that you get an investigation copy the
  application cannot use, not a recovery.
- **No existing schema.** The archive creates `chat` together with its USAGE
  grants, so a target that already has one is refused up front with the remedy.

### 4.2 Two restores that looked fine and were not

Both were found by drills (2026-09-08), and both are why the steps above exist.

- `pg_restore --schema=chat` filters out the entries whose own namespace is
  `-` — `CREATE SCHEMA chat` **and its ACL**. Pre-creating the schema silenced
  the loud failure and left a schema with no ACL: `chat_app` could not read one
  row while every structural check passed. `--schema` is therefore no longer
  passed to `pg_restore`; `pg_dump --schema` already scopes the archive.
- Dumps taken with `--no-privileges` carried zero ACL entries, so every
  restore produced a database in which `chat_app` could not touch a table.

## 5. Restore drill

A backup is an assumption until it has been restored, and a restore is a second
assumption until the copy has been *tested*. **Monthly**, and after any
migration that changes the schema shape.

Checklist — all must pass:

1. [ ] The dump restores with **zero** `pg_restore` errors.
2. [ ] Every `chat` table's row count matches the source.
3. [ ] `chat.schema_migrations` holds every expected version.
4. [ ] The restored copy passes `schema_acceptance`, `invariants`,
       `br1_invariants`, `tenant_isolation`, `relationship_predicate`,
       `story_rls` and `teacher_profile_rls` from `db/tests/`.
5. [ ] Effective privileges on the schema and every relation match the source,
       and `chat_app`, logged in as itself, reads what it reads in the source.
6. [ ] A wrong key and a modified archive are both refused, with the target
       untouched.
7. [ ] An application instance pointed at the restored database reaches
       `/health/ready` = 200.

**Last drill: 2026-10-21 — PASSED (items 1–6)**, from an encrypted
`APP_ENV=staging` backup of a freshly migrated `postgres:17` (77 migrations)
carrying synthetic rows, restored into a **second, separate** `postgres:17`
cluster that had never seen the schema or its roles:

| | Result |
|---|---|
| Plaintext in the `.enc` (`PGDMP`, `CREATE TABLE chat`, a synthetic marker, the key) | **none** — the same greps find the first two in an unencrypted dump |
| Wrong key / no key / modified archive (`.sha256` rewritten) / edited tag / missing tag | **all refused**, target untouched |
| `pg_restore` errors | **0** |
| `chat` tables / rows | **88 / 248**, every per-table count identical |
| Synthetic rows, `chat.config` content hash | identical |
| Effective ACLs (schema + every relation) | identical |
| Integrity suites on the copy | **7 / 7** |
| `chat_app` as itself | reads the copy, same result as the source |

`db/tests/od01_conversation_model.sql` is not in the list: it fails on a freshly
migrated database too ("conversation.type carries a fifth type"), so it says
nothing about the restore, and CI does not run it.

CI runs this whole drill on every pull request (G-41, in the migrations job):
encrypted backup, the refusals, a restore into a database that did not exist,
the suites, row-count and ACL parity, and `chat_app` reading the copy.
`scripts/qa/check-backup-encryption.sh` runs the encryption contract without a
database in the guards job.

## 6. Objectives

| Environment | RPO | RTO |
|---|---|---|
| Production | ≤ 5 min (provider PITR) | ≤ 2 h |
| Staging | ≤ 24 h | best effort |

These are proposals until a provider is chosen; PITR granularity and restore
speed are provider-dependent, and the RTO must be measured by a real drill
rather than assumed.

## 7. Disaster scenarios

| Scenario | Response |
|---|---|
| Database corrupted or data deleted | Stop writes. PITR to just before the event. If only `chat` is affected, restore per §4. Verify with the §5 checklist before reopening. |
| Database host lost | Provider failover, or provision a new instance and restore. Update `DATABASE_URL`; redeploy. |
| Redis lost | Provision a new instance, update `REDIS_URL`, redeploy. Queued jobs are gone — reconcile from the outbox (AI #2). Expect delayed notifications, not lost messages. |
| Object storage lost | Restore from versioning. Attachments are not reproducible from Postgres: this is the one data class with no second copy in the system. |
| Bad deployment | Roll back the image (`production-runbook.md`). If a migration ran, roll back the **application only** and assess the migration separately — most are not reversible. |
| Credential compromised | `secrets.md` §5. Revoke at the provider first. If it was the **backup passphrase**, rotate it and treat every archive written under it as readable by the holder. |
| Jawwid Core outage | Chat stays up; Core-dependent reads degrade visibly. Do not fabricate Core data; do not let Chat become a second source of truth. |
| LiveKit outage | Calling unavailable; messaging unaffected. |
| Push provider outage | Notifications retried by the worker; in-app delivery unaffected. |
| Region outage | Accepted risk for MVP. Recovery is restore-into-a-new-region, hours not minutes. Multi-region is explicitly out of scope (ADR-003). |

## 8. Gaps

- **The drill has never restored into a running application.** Checklist item
  7 (`/health/ready` = 200 against the restored copy) is unverified.
- **Key management is manual.** One passphrase per environment, no rotation
  procedure beyond "set a new one": archives keep the key they were written
  with, so a rotated-out passphrase must be retained for as long as its
  archives are. There is no escrow beyond the password-manager rule in §3.
- **The deploy workflows need the `BACKUP_ENCRYPTION_PASSPHRASE` Environment
  secret** in `staging` and `production`; until it is set, every deployment
  stops at the backup step (before any migration), by design.
- An encrypted archive is streamed into `pg_restore` through a pipe, so
  parallel restore (`pg_restore -j`) is not available. Restore is sequential;
  fine at today's size, worth measuring before it is not.
- No provider backups exist, because no managed database exists.
- Retention, PITR window and restore speed are unmeasured.
- Object storage backup is a policy, not yet a configuration.
