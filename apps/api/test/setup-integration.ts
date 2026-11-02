import { OutboxWorker } from '@communication/outbox/outbox.worker';

/**
 * The integration project's default timeout, for every test AND every hook:
 * 60 s. Under CI load a beforeEach that truncates and reseeds outran jest's
 * 5 s hook default in more than one spec (G-19: pd031-scheduling, pd012-s2).
 * It is set here because Jest 29 reads `testTimeout` from the GLOBAL config
 * only, so a per-project `testTimeout` would be ignored. A spec that calls
 * jest.setTimeout itself still wins.
 */
jest.setTimeout(60_000);

/**
 * DB/app clock skew. Rows written by SQL (chat.work_task_raise, triggers) take
 * available_at from the DATABASE's now(); OutboxWorker.drain() claims with the
 * APPLICATION's clock. On a developer Mac the Postgres VM (colima) drifts --
 * measured 2026-11-02: 0.7 s ahead -- so a spec that writes such a row and
 * drains at once finds nothing to claim (task-delivery-pd047, action-log-pd035
 * failed locally, never in CI, where both share one clock). A spec's drain with
 * no explicit `now` claims up to SKEW_LEAD_MS ahead. That never claims a retry
 * early: the shortest backoff is 5 s. Production is untouched -- the worker
 * drains in a loop, so a row of the future is claimed on a later pass.
 */
const SKEW_LEAD_MS = 2_000;
const drain = OutboxWorker.prototype.drain;
OutboxWorker.prototype.drain = function (this: OutboxWorker, batchSize?: number, now?: Date) {
  return drain.call(this, batchSize, now ?? new Date(Date.now() + SKEW_LEAD_MS));
};
