# Jawwid Chat — Stories

Status: **IMPLEMENTED END TO END** · backend + admin publishing + Flutter read client
Landed 2026-09-28, hardened 2026-09-29, Flutter client 2026-09-29 · Migration `20260928120000_chat_stories.sql`
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
access ended. The sweep's predicate has **one branch per story state**, so there
is no state a media object can hide in:

| State | Window measured from |
|---|---|
| `draft` | `updated_at` — an abandoned draft; an actively edited one keeps resetting its own clock |
| `published` | `expires_at` — even if `expireDue` has not relabelled it, so a stalled expiry pass cannot stall retention |
| `expired` | `expires_at` |
| `deleted` | `deleted_at` |

Adding a fifth state without adding a branch fails the "nothing left holding
media" test in `stories-hardening.spec.ts` §B.

```
published ──► expires_at reached ──► access revoked ──► retention window ──► media purged
```

The window exists so that revoking access and destroying bytes are not the same
act. Deletion is terminal and no surface re-serves a removed story's media, so this
is **not** an in-product undo — it is the interval in which an operator with
storage access can still retrieve content that was removed by mistake, before it is
gone for good. Stating it that way matters: an earlier draft of this document
called it "recoverable", which was not true of anything a user could do.

**No surface hands out media once access has ended.** `signMedia` is gated on
readability, not just on the key existing: a draft and a live published story
sign; an expired, deleted or purged one returns `null`. The gate is in the signing
helper rather than at each call site, because `list()` deliberately returns expired
stories as the publisher's reporting surface. What it cannot do is revoke a URL
already minted — a signature is self-validating — so the exposure is bounded by
`STORAGE_SIGNED_URL_TTL_SECONDS` (default 300s, capped at 3600), not by the story's
lifetime.

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

### Four defects found by these tests, and fixed

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
- **A publisher could mint a fresh media URL for a story whose access had ended.**
  `signMedia` signed any key it was handed, and `list()` returns expired stories by
  design, so an expired publication's picture stayed retrievable for as long as
  retention kept the bytes. No feed showed it, which is why it would not have been
  noticed. Now gated on readability. `stories-hardening.spec.ts` §A is the
  regression.
- **Story media could outlive the product, two different ways.** The purge sweep
  keyed only on `deleted_at` / `expires_at`, both NULL for a draft — so media on a
  never-published story was never eligible and sat in the bucket forever. And
  `story_has_content` required a body **or** a media key, so clearing the key on a
  *picture-only* publication violated the check and that story could never be
  purged at all. Every earlier retention test happened to give its story a body,
  which is how the second one hid. `stories-hardening.spec.ts` §B is the regression.

### And one correctness defect the fan-out test found

`chat.notification.rule_key` carries a foreign key to
`chat.notification_rule(key)`. The migration seeded the story *template* but not
the *rule*, so **every story notification failed at INSERT**, the outbox returned
the event to pending, retried five times and marked it `failed`. Realtime still
fanned out, so the feature looked like it worked. Nothing caught it because no test
drained the outbox for a story. The rule row is now seeded and
`stories-hardening.spec.ts` §G drains the outbox and asserts on real notification
rows.

## 8. Clients

**Admin web** (`apps/admin-web/src/features/stories/`) is the publishing surface:
compose, attach media, pick an audience, publish, see delivery and view counts,
open a viewer list, remove with a reason. Registered as nav area `stories`, visible
to `admin`, `coverage` and `manager` — mirroring `canPublishStory`, because a nav
entry that hid a page the server would serve is a worse lie than one that shows it.

**Flutter** (`lib/features/stories/`) is the read client. It consumes exactly two routes —
`GET /stories/feed` and `POST /stories/:id/view` — and nothing else, because nothing else is
available to a `parent` or `teacher`.

| Piece | File |
|---|---|
| Model, mirroring `StoryFeedItem` | `lib/shared/models/story.dart` |
| Video playback seam | `lib/core/media/story_video_player.dart` |
| Repository interface | `lib/core/data/repositories.dart` (`StoryRepository`) |
| HTTP implementation | `lib/core/data/http/http_story_repository.dart` |
| Wire mapping | `WireMappers.story` |
| Feed state, ordering, view recording | `lib/features/stories/application/stories_controller.dart` |
| The rail | `lib/features/stories/presentation/stories_rail.dart` |
| The full-screen viewer | `lib/features/stories/presentation/story_viewer_screen.dart` |
| Route | `Routes.story(id)` → `/stories/:storyId` |

Decisions worth knowing before changing it:

* **The rail renders nothing unless there are stories.** Loading, empty, failed and
  "no repository registered" all look the same from outside: absent. The controller keeps them
  apart internally so a missing wiring cannot masquerade as a quiet academy. Retry is the Chats
  screen's existing pull-to-refresh, which now refreshes conversations and stories together.
* **One ring per story, not per author.** The feed carries no author on purpose, so grouping by
  publisher would yield exactly one ring and discard the per-story `viewed` flag. Each ring is
  labelled with the story's own title, falling back to the academy name from localisation — the
  publisher identity is never invented from a field the contract does not have.
* **No publishing affordance at all.** No "your story" entry, no composer, no delete. This
  client cannot authenticate as a role that may publish, so any such control could only fail.
* **Views are recorded on ARRIVAL in the viewer**, never on feed load and never on a ring tap.
  The ring updates optimistically so it stops looking unread immediately; the server stays
  authoritative and the next refresh reconciles.
* **Expiry is respected, not re-implemented.** The viewer leaves a story whose `expires_at` has
  passed rather than requesting a view the server would refuse, and a refused view
  (`STORY_EXPIRED` / `STORY_DELETED` / `STORY_NOT_FOUND`) closes the story and refetches the
  feed.
* **A deep link waits for the feed.** `/stories/:id` is a real route, so a cold start can land
  there before the feed loads. It shows a spinner rather than declaring the story missing — the
  first version read the list in `initState`, found it empty, and lied.
* **Media is passed through, never constructed.** The signed URL is handed to `Image.network`
  or to the video seam exactly as received — no bucket, no key, no path building. A lapsed
  signature or a purged object reaches the reader as "this picture could not be loaded" or
  "this video could not be played", not a blank.

### Video

Video stories **play inline**, through the seam in `lib/core/media/story_video_player.dart`.

`video_player` (flutter.dev's own package) is the only dependency this feature added, and it
exists for exactly one reason: the backend accepts `video/mp4`, `quicktime` and `webm`, so a
video story has to actually play. Nothing else in the app plays video — a video ATTACHMENT is
deliberately treated as a file and handed to the platform — so there was no existing capability
to reuse.

The package is reached only through `StoryVideoPlayer`, so no widget names a platform type and
no test touches a platform channel. One player instance is owned by the viewer's `State` and
disposed with it; `load` releases the previous controller before building the next, so two
decoders are never alive at once.

**Two advance mechanisms, deliberately not one:**

| Story kind | Progress segment | Advances when |
|---|---|---|
| image, or words only | `AnimationController` over `imageDuration` (5s) | the animation completes |
| video | real `position / duration` from the player | **playback completes** |

A video is never given a timer. A fixed one would be wrong in both directions: it would cut a
40-second video short, and it would skip past one that stalled buffering. A video that fails to
initialise is **not** treated as completed — it shows the failure with a retry, and the story
stays put.

Every automatic advance passes through one gate (`_advanceFrom`) which drops the request unless
the story asking is still the current one, the viewer is still mounted, and it is not already
leaving. That is what makes a late callback — a video completing just after the reader tapped
next — harmless rather than a double advance.

**Lifecycle.** Backgrounding the app pauses a video and stops an image's clock; resuming
restarts it, unless the reader is holding the screen. Closing the viewer pauses playback,
cancels the status subscription and disposes the player. There is no `Timer` anywhere in the
viewer: an `AnimationController` and a stream subscription both die with the `State`.

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

The migration also seeds a `chat.notification_template` row per locale **and** a
`chat.notification_rule` row keyed `story_published`. The rule row is not optional:
`chat.notification.rule_key` is a foreign key, so without it every story
notification fails to insert.
Media limits are 10 MB for an image and 100 MB for a video, and the accepted types
are jpeg/png/webp/heic and mp4/quicktime/webm.

## 11. Tests

| Suite | Covers |
|---|---|
| `apps/api/test/unit/authorization/story-authorization.spec.ts` | the role matrix, as pure decisions (19) |
| `apps/api/test/integration/stories.spec.ts` | the whole lifecycle, audience resolution, expiry, views, viewer list, delete, retention (65) |
| `apps/api/test/integration/stories-hardening.spec.ts` | media after access ends, retention on every state, full cross-tenant matrix, expiry with the sweeper off, empty audiences, fan-out limits, failure isolation (34) |
| `db/tests/story_rls.sql` | every policy, run as `authenticated` (36 assertions) |
| `apps/admin-web/src/features/stories/StoriesPage.test.tsx` | the console's UI contract (16) |
| `test/features/stories/stories_rail_test.dart` | the rail: absence, ordering, read state, no publishing affordance, refresh (13) |
| `test/features/stories/story_viewer_test.dart` | the viewer: opening, view tracking, navigation, progress, image and video media, video lifecycle, mixed image/video sequences, localisation (44) |
| `test/core/data/http/stories_over_http_test.dart` | the client's half of the wire contract, over real sockets (12) |

All of it runs in CI on every pull request: `api` (typecheck + unit), `admin-web`
(typecheck + tests + build), `migrations` (apply from empty, G-19 idempotency,
schema acceptance, identity and BR-1 invariants, **story RLS**, integration suite).
The `mobile` job reports BLOCKED on the CI hosts, where no Flutter toolchain is installed; the
Flutter suite (545 tests) runs locally on a host that has one. Closing that gap is a CI concern,
not a code one.
