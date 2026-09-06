# Local Development

Owner: AI #7 · Date: 2026-09-05

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22.x (CI pins 22.14.0) | API, Admin Web |
| Docker | any recent | Postgres, Redis, MinIO |
| **Docker Compose** | v2 plugin | the local stack |
| Flutter / Dart | stable | mobile apps only |
| `psql` (optional) | 17 | convenience; scripts fall back to a container |

> **Docker Compose is a separate plugin.** Having `docker` is not enough. If
> `docker compose version` fails:
> ```bash
> brew install docker-compose && mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose
> ```
> `scripts/infra/dev.sh` detects this and prints the same instructions.

## 1. Configure

```bash
cp .env.example .env
scripts/infra/check-env.sh local --file .env
```

Every value in `.env.example` is a local-only placeholder. Never copy a staging
or production value into it.

## 2. Start the stack

```bash
scripts/infra/dev.sh up
```

Starts Postgres (`:5433`), Redis (`:6380`) and MinIO (`:9000`, console `:9001`),
waits for health, and creates the private attachment bucket.

Run two checkouts at once by overriding ports:

```bash
POSTGRES_PORT=15433 REDIS_PORT=16380 STORAGE_PORT=19000 scripts/infra/dev.sh up
```

> **Migrating from the hand-started containers.** During bring-up, `jawwid-chat-pg`
> and `jawwid-chat-test` were created with `docker run` and hold ports 5433 and
> 55432. `dev.sh` reports them and will **not** stop them — that data is not
> ours to discard. Remove them yourself when ready:
> ```bash
> docker rm -f jawwid-chat-pg jawwid-chat-test
> ```

## 3. Database

The migration authority is `scripts/db/apply.sh` (ADR-002).

```bash
scripts/db/test-db.sh reset     # rebuild: Core shim + every migration
scripts/db/test-db.sh psql      # interactive shell
DATABASE_URL=... scripts/db/apply.sh   # apply pending migrations
```

Jawwid Chat lives in a `chat` schema alongside Jawwid Core's `public` schema.
`db/test/00_core_shim.sql` stands in for Core locally. This matters for backups:
a `chat`-only dump is **not** restorable without the Core tables first — see
`backup-recovery.md`.

`prisma generate` produces the typed client. Do **not** run `prisma migrate` or
`prisma db push` against a shared database; there is one migration authority
(ADR-002), and F-1 in `discovery.md` explains why that is currently contested.

## 4. Run the applications

```bash
# API — note: dist/main.js does not exist yet (no bootstrap; AI #1/#2)
cd apps/api && npm ci && npx prisma generate && npm run build && node dist/main.js

# Admin Web — http://localhost:5174
cd apps/admin-web && npm ci && npm run dev
```

When the bootstrap is written, one line in `main.ts` adopts the infrastructure
concerns (security headers, CORS allowlist, graceful shutdown):

```ts
import { applyInfrastructure } from './infra';
const app = await NestFactory.create(AppModule);
applyInfrastructure(app);
await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
```

and importing `HealthModule` mounts `/health`, `/health/live`, `/health/ready`.

## 5. Verify

```bash
curl -s localhost:3000/health/ready | jq
scripts/infra/smoke.sh http://localhost:3000
scripts/infra/scan-secrets.sh
```

## 6. Tests

```bash
cd apps/api       && npm test    # NOTE: no jest.config.js exists yet (F-5)
cd apps/admin-web && npm test
```

## 7. Mobile

`lib/` contains Dart source but there is **no `pubspec.yaml`**, and Flutter is not
installed on the machine this was validated on. The mobile app cannot currently
be resolved, built or tested. Build configuration is specified in
`handoff-ai3.md`; it is a specification, not a verified procedure.

## 8. Stopping

```bash
scripts/infra/dev.sh down    # stop; data preserved
scripts/infra/dev.sh nuke    # stop and delete volumes (asks for confirmation)
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `port is already allocated` | The hand-started containers still hold 5433/6380. Remove them, or override the ports. |
| API exits at boot with "Can't reach database server" | Expected today: Prisma connects eagerly and aborts startup if Postgres is down (F-2). Start the stack first. |
| `docker compose: unknown command` | The plugin is missing — see Prerequisites. |
| Backup written but the file is missing | Docker cannot see the output path. Use a directory under your home directory; `/tmp` is often not shared with the Docker VM. |
| `pg_dump: server version mismatch` | The container image's major version must match the server. Set `PG_IMAGE`. |
