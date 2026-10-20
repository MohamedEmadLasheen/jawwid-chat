# Core ⇄ Chat: confirming a trial's subscription

> **RETIRED 2026-10-20 (trial journey).** The owner decided that Jawwid Chat is
> the only source of truth for a trial's outcome. Chat no longer sends
> `trial.converted`, and a `subscription.created` delivery is recorded but
> changes nothing. Core has nothing to build for trials. See "Trial journey as
> built" in `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`. The text below is
> kept as history.

**Status (historical):** the Chat side was built (2026-10-19). Core was to
build its side. Record: PD-11 T4 in
`docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`. Wire rules (signing, envelope,
retries): `docs/architecture/core-integration-contract.md` §1–§2, §6.

## The round trip

```
Sales records "subscribed" on an attended trial (Chat)
  └─ Chat → Core   trial.converted   { trialId, prospect, teacher, ... }
        Core creates the subscription (and, when ready, the student)
  └─ Core → Chat   subscription.created   { core_subscription_id, chat_trial_id, core_child_id }
        Chat confirms the trial; the teacher is credited;
        New Students shows the student
```

## Chat → Core: `trial.converted`

Queued in Chat's outbox in the same transaction as Sales' decision. Sent only for
`subscribed`, never for `not_subscribed`. Sales' reason and note, and the prospect's
note, never leave Chat. The prospect has a display name only, with no contact details
(BR-2).

```jsonc
{
  "trialId": "<Chat lesson uuid>",        // Core echoes this back as chat_trial_id
  "organizationId": "<Chat uuid>",
  "teacherId": "<Chat teacher uuid>",
  "coreTeacherId": "652f…" | null,          // Core's id for the teacher, when Chat knows it
  "prospect": { "id": "<uuid>", "displayName": "…", "level": "beginner" | null },
  "trialAt": "2026-10-19T08:00:00.000Z",
  "recordedBy": "<Chat staff uuid>",
  "recordedAt": "2026-10-19T10:00:00.000Z"
}
```

> **Not yet delivered.** Like every other Chat → Core event (`lesson.closed`,
> `teacher.deduction_applied`, `teacher.suspended`, …), it waits in
> `chat.outbox_event`. No worker sends Chat's events to Core yet. That outbound
> transport is a separate, shared piece of work.

## Core → Chat: `subscription.created`

`POST /api/v1/integration/core/events`, signed as the contract §1 describes:
HMAC-SHA256 over `{timestamp}.{raw body}`, with the `X-Jawwid-Key-Id`,
`X-Jawwid-Timestamp` and `X-Jawwid-Signature` headers, and ±300 s for the timestamp.
No user session is involved. The envelope follows contract §2:

```jsonc
{
  "event_id": "<stable across retries>",
  "event_type": "subscription.created",
  "occurred_at": "2026-10-19T10:05:00Z",
  "data": {
    "core_subscription_id": "652f1c2ab8e4a10012ab0001",   // required
    "chat_trial_id": "<trialId from trial.converted>",     // omit when not from a Chat trial
    "core_child_id": "652f1c2ab8e4a10012ab9f01"           // the student, when Core has one
  }
}
```

Core's ids are **opaque text**: Chat stores and compares them exactly as sent,
never parsing them as UUIDs and never changing their case
(`20261019200000_chat_core_boundary.sql`).

### Answers

| Status | Body | Meaning for Core |
|---|---|---|
| 200 | `{"status":"applied"}` | Confirmed. |
| 200 | `{"status":"duplicate"}` | Already applied, either this event or the same subscription under another event id. Stop. |
| 200 | `{"status":"not_applicable"}` | Not from a Chat trial (no `chat_trial_id`). Nothing to do. Chat does not mirror subscriptions (PD-10). |
| 400 | `{"error":"unknown_event_type" \| "malformed_json" \| …}` | Stop: retrying cannot help. |
| 401 | `{"error":"invalid_signature" \| "unknown_key" \| "stale_timestamp" \| "missing_headers"}` | Fix the signing. Each refusal is audited. |
| 422 | `{"error":"unknown_trial" \| "trial_not_subscribed" \| "trial_confirmed_by_another_subscription" \| "missing_core_subscription_id" \| "invalid_core_child_id"}` | A disagreement. Stop, and have a person look. It stays in `chat.core_event` with its reason. |
| 500 | `{"error":"retry_later"}` | Sales hasn't recorded the trial's decision in Chat yet. Retry with backoff. |
| 500 | `{"error":"apply_failed"}` | Chat failed. Retry with backoff. |
| 503 | `{"error":"not_configured"}` | No webhook secret is configured. Retry later. |

### What Chat does with it

`chat.confirm_trial_subscription(trial, core_subscription_id, core_child_id)` runs
on the server side only, and redelivering it changes nothing.

- It stamps the confirmation, which credits the teacher, and keeps Core's ids.
- **If a learner with that `core_child_id` already exists** in the trial's
  organization, the prospect is linked to it. New Students then shows the student
  under **Ready to set up**.
- **Otherwise** New Students shows **Confirmed, student not in Chat yet**. When a
  learner later arrives with that `core_child_id`, or gains it, the database links
  it, and the student moves to *Ready to set up* without anyone acting.

## What Core needs to build

1. Read `trial.converted`. Today it waits in Chat's outbox, so the outbound
   transport, or a pull of it, has to be agreed first.
2. Send `subscription.created` with `chat_trial_id` set to the `trialId` it received,
   and `core_child_id` once the student exists in Core.
3. Use the shared secret, configured in Chat as `CORE_WEBHOOK_SECRETS` (or the
   deployed name `CORE_WEBHOOK_SECRET`) in the form `keyid:secret[,keyid2:secret2]`.
   Core sends `keyid` in `X-Jawwid-Key-Id`.
4. For Chat to ever *have* the learner, Core must deliver students. Chat has the
   SQL ingest for them (`chat.ingest_core_learner`), but this webhook doesn't accept
   `student.upserted` yet. Until it does, staff add learners in Chat with the
   matching `core_child_id`, and the link follows.
