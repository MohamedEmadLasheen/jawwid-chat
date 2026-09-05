# Jawwid Chat — Mobile (AI #3) Repository Discovery Report

Date: 2026-09-05
Author: AI #3 — Flutter Mobile Engineer
Status: **Discovery complete. Implementation BLOCKED pending two decisions (see §5).**

---

## 1. Repository state discovered

The primary working directory `/Users/mohamedlasheen/Documents/jawwid chat` was **completely
empty** — no files, no `.git`, not a git repository.

| Discovery item (per role brief §81)        | Finding |
|--------------------------------------------|---------|
| 1. Current Flutter project structure       | **None.** No `pubspec.yaml`, no `lib/`, no `android/`, no `ios/`. |
| 2. Flutter / Dart versions                 | **Flutter and Dart are not installed on this machine** (`flutter`, `dart` → command not found; no SDK at `~/development/flutter`, `~/flutter`, `/opt/flutter`, `/usr/local/flutter`; not in Homebrew). |
| 3. Existing architecture                   | None. |
| 4. Existing state management               | None. |
| 5. Existing API client                     | None. |
| 6. Existing authentication                 | None. |
| 7. Existing realtime implementation        | None. |
| 8. Existing push notification impl.        | None. |
| 9. Existing calling implementation         | None. |
| 10. Existing local storage                 | None. |
| 11. Existing design system                 | None. No Jawwid brand assets, logo, colour tokens, or typography supplied. |
| 12. Existing tests                         | None. |
| 13. Existing communication features        | None. |
| 14. AI #1 backend contracts available      | **None.** No `docs/` tree, no schema, no auth contract, no RBAC contract. |
| 15. AI #2 communication contracts available| **None.** `docs/communication/mobile-contract.md` does not exist. |

Git was initialised on branch `main` as part of this discovery pass; the only content committed
is this report and the project brief. No application code has been written.

## 2. Related repositories inspected

`~/Documents/` contains ~17 checkouts of an unrelated product, **Second School**
(`second-school*`, `ss-*`). These were inspected for reusable mobile foundations:

- `second-school-mobile` is **not** a Flutter project. It is **React + Vite + Capacitor +
  Supabase** (TypeScript).
- Nothing in these repositories is a Jawwid Chat backend, and none of them expose the
  contracts AI #1 / AI #2 are meant to own.

**Relevant signal:** the organisation's existing mobile stack is Capacitor/React/Supabase, not
Flutter. Choosing Flutter for Jawwid Chat means introducing a second, unshared mobile
toolchain. That is a legitimate choice, but it should be a deliberate one — see §5.2.

## 3. Product brief located and read

`~/Downloads/JAWWID_CHAT_BRIEF.pdf` (8 pages) was located, extracted, and read in full. It is
copied into this repository at `docs/JAWWID_CHAT_BRIEF.pdf` (plain-text extraction alongside it
at `docs/JAWWID_CHAT_BRIEF.txt`).

The brief states of itself: *"Full design doc (v3) exists separately; this brief is the contract
for what to build."* **The referenced design doc v3 was not found on this machine.**

### What the brief actually specifies

Jawwid Chat is described as a **Customer Success operating system for the internal CS team** —
"Replaces WhatsApp for the CS team."

- **Roles:** `admin (owner)`, `coverage`, `manager`, `finance / technical / academic` internal
  staff, `system`. Family-side contacts have capability flags.
- **Core model:** one family → one permanent Primary Owner, plus a configurable coverage engine
  (`on_duty(family, now)`), one continuous thread per family, cases layered on the thread,
  computed attention score, computed workload score.
- **Screens (§8):** Admin inbox · Family screen · Manager dashboard · Tasks screen · and one
  **"Customer (help screen in app)"**.
- **MVP scope (§10)** is nine items, all of them staff-side data model, coverage engine, inbox,
  attention/workload engines, tasks, deterministic automation, manager dashboard, and logging.

## 4. Conflict between the brief and the AI #3 role assignment

The AI #3 role assignment describes a **standalone Parent + Teacher Flutter messenger**. The
brief describes a **staff-facing CS console**. The overlap is small, and several headline
features of the role assignment appear **nowhere** in the brief.

| AI #3 role assignment says to build | Present in the project brief? |
|---|---|
| Parent mobile experience | **Partially** — brief §8 has one "Customer (help screen in app)": owner name/photo, open topics in plain status, continue/new topic, self-service buttons, honest reply time. It is a help screen inside the existing Jawwid app, not a standalone messenger. |
| **Teacher** mobile experience | **No.** The brief has no teacher role anywhere. `learner.teacher_id` exists as a data field only. |
| **Student Groups** (official parent↔teacher channel) | **No.** The brief's conversation model is `thread` UNIQUE **per family**, with the explicit invariant "cases never create a second thread." |
| Teacher/parent **message approval** workflow | **No.** |
| **Voice / group calling**, LiveKit, CallKit, ConnectionService | **No.** No calling of any kind in the brief. |
| **Voice notes**, reactions, read receipts, typing indicators | **No.** Brief has `message.attachments jsonb` only. |
| Push notifications, deep links | **Implied** (reminders/automation) but **not specified**. |
| "No direct teacher ↔ parent communication" rule | Not addressable — there is no teacher actor in the brief. |

The brief also marks as **explicitly out of MVP**: any AI, shared queue, auto-distribution,
CSAT, multi-team structures.

**I have not resolved this conflict by guessing.** Per role-assignment §57, §58 and §80
("Do not invent a new backend protocol", "DO NOT GUESS when backend behaviour is unclear"),
a scope contradiction of this size is escalated, not silently reconciled.

## 5. Blockers

### 5.1 Product scope conflict (blocking — decision required)
Building the parent/teacher messenger described in the role assignment would contradict the
document that calls itself "the contract for what to build." Building the brief's CS console
would contradict the role assignment. Either choice, made unilaterally, risks discarding the
entire implementation. This is a true product decision and is the one thing I am stopping on.

### 5.2 Flutter toolchain absent (blocking for verified delivery)
Without the Flutter SDK I can write Dart source but **cannot compile it, cannot run
`flutter analyze`, and cannot execute a single unit, widget, or integration test.** Role
assignment §77 requires tests implemented *and* §79 requires test results. Any code delivered
in this state would be unverified by construction, and I will not report it as working.

### 5.3 No backend contracts exist (blocking for integration)
Neither AI #1 (auth, RBAC, core entities) nor AI #2 (`docs/communication/mobile-contract.md`)
has produced anything in this repository. Every endpoint, payload, realtime event, and token
flow the client needs is currently undefined. Coding against invented endpoints is prohibited
by §57/§58/§80; the correct action is to record the dependency, which is what this report does.

## 6. What can proceed without unblocking

Independent of the decisions above, the following is safe to build because it is contract-free:
design system and theme tokens (once brand assets are supplied), Arabic-first RTL and
localisation scaffolding, error/loading/empty-state primitives, and the local persistence /
offline-queue layer. All of it, however, remains **uncompilable and untestable** until §5.2 is
resolved.

## 7. Recommended order once unblocked

1. Install the Flutter SDK; pin Flutter/Dart versions in the repo.
2. Confirm product scope (§5.1) and obtain the design doc v3 referenced by the brief.
3. Obtain or co-author `docs/communication/mobile-contract.md` with AI #2, and the auth/session
   contract from AI #1.
4. Foundation → design system + RTL/localisation → auth + secure token storage → conversation
   list → thread screen → offline queue + realtime sync → notifications → (calling, only if it
   is confirmed to be in scope at all).

## 8. Nothing was assumed

No application code, no invented endpoints, no hardcoded staff names, no hardcoded schedules,
and no secrets have been committed.
