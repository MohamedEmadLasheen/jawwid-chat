# Jawwid Chat — Stories

Status: **IMPLEMENTED** · Landed 2026-09-28 · Migration `20260928120000_chat_stories.sql`
Companions: `../security/RLS-STRATEGY.md`, `../architecture/AUTHORIZATION-MODEL.md`,
`../contracts/API-CONTRACT.md`, `../contracts/DOMAIN-VOCABULARY.md`

---

## 1. What a story is

A short-lived publication from the academy to a chosen slice of its people.
A publisher writes some words and optionally attaches one image or video, names an
**audience** rather than a list of people, and publishes. The story is readable by
that audience for 24 hours and then stops being readable.

It is not a message: there is no reply, no thread, no conversation. It is not a
broadcast either — broadcast (Phase 2) reaches a family as an ordinary message
through the messaging engine, and is answerable. A story is read-only by design.

## 2. Scope, honestly stated

Stories was **deferred** in the PRD and sits in the "Later" band of the roadmap,
below broadcast, labels and class groups. It was built on explicit instruction
after an audit established that no implementation existed on `main`. This document
records what was built so the next reader does not have to reconstruct it from
the diff.

A complete, unmerged Stories implementation also exists on the abandoned
`phase5/calls-stories-broadcast` lineage (`38d3a33`). It was read as a design
reference and **not** ported: it is written against a permission-key
authorization model and three tables that do not exist on `main`. See §9.

## 3. Who may do what

| | Publish | Read own feed | See viewer list | Delete |
|---|---|---|---|---|
| `manager` | ✅ | ✅ | ✅ | ✅ any |
| `admin` | ✅ | ✅ | ✅ | own only |
| `coverage` | ✅ | ✅ | ✅ | own only |
| `finance` / `technical` / `academic` | ❌ | ✅ | ❌ | ❌ |
| Teacher | ❌ | ✅ | ❌ | ❌ |
| Parent (family contact) | ❌ | ✅ | ❌ | ❌ |

Publishing is the **family-facing staff set** (`FAMILY_FACING_STAFF_ROLES`) and
nothing wider: the same predicate that decides who may message a family. There is
deliberately no `super_admin` or `coverage_admin` — those are the old lineage's
role names and do not exist on this schema.

A parent may not see who viewed a story they received. A viewer list says which
named parent opened which publication and when; a recipient is not the owner of an
academy publication, however WhatsApp-like that might feel.

**Where this is enforced:** `AuthorizationService.canPublishStory` /
`canReadStories` / `canReadStoryViewers`, called by `StoryService`. RLS is the
second layer (§7).

## 4. The audience

Authored as **intent**, resolved **server-side, once, at publish**, into
`chat.story_recipient`.

| Clause | Resolves to | Through |
|---|---|---|
| `all_families` | every communicating contact in the organization | `chat.contact` |
| `all_teachers` | every active teacher | `chat.teacher` |
| `assigned_families` | the contacts of families this staff member supervises | `chat.family.owner_id` |
| `family` | one family's contacts | `chat.family` |
| `teacher` | one teacher | `chat.teacher` |
| `contact` | one contact | `chat.contact` |
| `conversation` | the parents and teachers of one student/class group | `chat.conversation_member` |

A recipient must be **active**, and a contact must additionally hold
`can_message` — the same predicate `chat.teacher_parent_authorized` uses for "a
family contact who may communicate". Staff are never recipients.

**Two clauses are deliberately absent.** `label`, because `chat.family_label` does
not exist (labels are Phase 2, unbuilt) — offering it would be a control that only
fails when used. `group` as its own kind, because on this schema a group *is* a
conversation; the clause is called `conversation` for that reason.

### Why write-time resolution

Resolving at read time would mean every reader's feed runs a union of subqueries
per story per pull, cannot be usefully indexed, and — worse — makes "who was this
published to?" unanswerable after the fact, because the answer changes whenever
somebody joins a group.

The cost is that the audience is a **snapshot**: a family enrolled tomorrow does
not retroactively receive today's story. That is the correct semantics for a
publication, and it is a decision rather than an accident.

Holding the publisher role is **necessary and not sufficient**. The resolver
independently refuses every clause outside the author's own organization, so a
forged or copied id reaches nobody. Refusal is loud
(`COMM.STORY_AUDIENCE_INVALID`) rather than silent, so an operator who mistypes a
group id learns it while composing instead of from the delivery count.

## 5. Lifecycle

```
    draft ────► published ────► expired
      │             │              │
      └─────────────┴──────────────┴────► deleted   (terminal)
```

Allowed: `draft→published`, `published→expired`, any→`deleted`, and X→X.
Refused: anything out of `deleted`, `published→draft`, `expired→published`.

Enforced twice: in `StoryService`, and by `chat.guard_story_transition()` so the
database refuses it too. Resurrection is the one transition with a real security
consequence — it would make a publication readable again after its audience
snapshot had gone stale.

## 6. Expiration and media retention

**Two clocks, deliberately separate.**

**Access** ends at `expires_at`, immediately, without waiting for any job. Every
read requires `expires_at > now()`: the service's WHERE clause and the
`story_visible_to_audience` RLS policy both carry it. A story is unreadable a
millisecond past its expiry even if no sweep has ever run.

**Bytes** are removed later, `story.media_retention_hours` (default 72h) after
access ended — measured from `deleted_at` for a story an operator removed, and
`expires_at` otherwise.

```
published ──► expires_at reached ──► access revoked ──► retention window ──► media purged
```

The window exists because an operator who deletes the wrong story has a bounded
interval in which the content can still be recovered, and because destroying bytes
in the same transaction that revokes access makes an accidental publication
unrecoverable.

**If the sweep fails**, nothing becomes readable that should not be. The worst a
wedged sweep does is leave rows labelled `published` that no query returns, and
media in the bucket longer than intended. `StorySweeper` runs from the existing
worker loop (`STORY_SWEEP_MS`, default 60s) in its own try block, so a sweep
failure cannot stop outbox delivery.

The story **row** is never hard-deleted: it is the audit trail of what the academy
published. Deletion is `state = 'deleted'` plus a stamped reason, matching this
schema's convention everywhere else.

## 7. Security model

| Concern | Control |
|---|---|
| Who may publish / read / see viewers | `AuthorizationService`, called by `StoryService` — the **primary** control |
| Which stories a reader gets | a join through their own `chat.story_recipient` rows; there is no fetch-then-filter path |
| Tenant isolation | `organizationId` filter in every service query, plus restrictive RLS on `chat.story` **and on all three child tables** |
| Recording a view as someone else | RLS `WITH CHECK (actor_id in current_actor_ids())` |
| Recording a view on a story you were never sent | `chat.enforce_story_view_audience()` trigger, `SECURITY DEFINER` |
| Duplicate views | composite primary key `(story_id, actor_id)` |
| Enumerating stories | every refusal on a reader path returns the same `COMM.STORY_NOT_FOUND` with the same message and status |
| Media access | short-lived signed URL minted per request, only for a story the caller was already authorized to see; the object key is a name, never a capability |

RLS is **defence in depth, not the primary path** (`RLS-STRATEGY.md` §2). It is
inert on the API path today because the API connects as the owner and sets no
actor context. The policies are written to be correct on the day that changes, and
`db/tests/story_rls.sql` runs them as `authenticated` in CI so they cannot rot.

### Two defects found while building this, and fixed

- **The audience trigger read under the caller's RLS.** A system control that asks
  "is this actor in this story's audience?" while constrained to the caller's own
  visibility is not reading the world. It failed *closed*, so it was never an
  access bug — but it swallowed cases belonging to the RLS `WITH CHECK`, leaving no
  test able to tell the two guards apart. Now `SECURITY DEFINER` with a pinned
  `search_path`.
- **The child tables had no tenant predicate.** `story_audience`,
  `story_recipient` and `story_view` carry no `organization_id` and inherit tenancy
  through `story_id` — but their permissive policies grant on facts about the
  *caller* ("is this row mine?", "may I publish?"), neither of which mentions an
  organization. A publisher in one academy could therefore read every other
  academy's viewer lists, recipient lists and authored audiences. Each child table
  now carries a restrictive organization policy resolved through
  `chat.story_organization_id()`. `db/tests/story_rls.sql` H3–H5 is the regression.

## 8. Clients

**Admin web** (`apps/admin-web/src/features/stories/`) is the publishing surface:
compose, attach media, pick an audience, publish, see delivery and view counts,
open a viewer list, remove with a reason. Registered as nav area `stories`, visible
to `admin`, `coverage` and `manager` — mirroring `canPublishStory`, because a nav
entry that hid a page the server would serve is a worse lie than one that shows it.

**Flutter** is **not wired in this change.** The mobile client authenticates only
as `parent | teacher`, so it can never publish; its role is a read-only feed and
viewer. `lib/features/stories/` remains the inert seam it has been since `c36ae46`
— `storyRingsProvider` returns `const []`, the rail renders zero pixels, and
`test/features/conversations/chats_screen_test.dart` asserts that it does. No dead
controls, nothing fake. Wiring it is a follow-up:

1. `StoryRepository` + `HttpStoryRepository` over `GET /stories/feed` and
   `POST /stories/:id/view`.
2. Override `storyRingsProvider` at the composition root (`lib/app/bootstrap.dart`).
3. A full-screen viewer route with progress, advance and pause.
4. `canPostStoryProvider` stays `false` — this client cannot publish.

Deferred because no Dart toolchain was available to compile or test it in the
session that built the backend, and shipping unverified Dart is worse than
shipping a seam that tells the truth.

## 9. Relationship to the abandoned Phase 5 lineage

`38d3a33` on `phase5/calls-stories-broadcast` contains a complete Stories feature
that was never merged. It was used as a design reference — the materialised
audience, the composite-key deduplication, the anti-enumeration trigger and the
"no client names a recipient" rule all come from it.

It was **not ported**, because it depends on things `main` does not have:
`chat.permission`, `chat.role_permission`, `chat.current_has_permission()`,
`chat.family_label`, `chat.group_member`, `chat.learner_teacher_assignment`,
`AudienceResolverService`, `rbac/permissions.ts`, `call-sweeper.ts`. Importing it
would have given this database two authorization models.

Two defects in that implementation are fixed here rather than inherited: its read
policy gated on `state = 'published'` without `expires_at`, and its expiry sweep
never deleted story media.

## 10. Configuration

| Key | Default | Meaning |
|---|---|---|
| `story.default_lifetime_hours` | 24 | how long a published story stays readable |
| `story.max_body_length` | 2000 | longest body accepted |
| `story.feed_page_size` | 50 | stories per feed page |
| `story.media_retention_hours` | 72 | how long media survives after access ends |

All four are seeded in the migration and mirrored in
`COMMUNICATION_CONFIG_DEFAULTS`, so an unset row falls back rather than failing.
Media limits are 10 MB for an image and 100 MB for a video, and the accepted types
are jpeg/png/webp/heic and mp4/quicktime/webm.

## 11. Tests

| Suite | Covers |
|---|---|
| `apps/api/test/unit/authorization/story-authorization.spec.ts` | the role matrix, as pure decisions (19) |
| `apps/api/test/integration/stories.spec.ts` | the whole lifecycle, audience resolution, expiry, views, viewer list, delete, retention, tenant isolation (65) |
| `db/tests/story_rls.sql` | every policy, run as `authenticated` (36 assertions) |
| `apps/admin-web/src/features/stories/StoriesPage.test.tsx` | the console's UI contract (16) |
