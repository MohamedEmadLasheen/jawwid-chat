# Design Pack — Scope and Authority

**Owner:** AI #6 · **Status:** GOVERNING for this directory · **Read before any other file here.**

---

## 1. What this directory is

`docs/design/` is a **design / UX conformance artifact**.

It is **not** a product authority, **not** an architecture authority, and **not** a second
product definition. It describes how the product the PRD defines should look, read and behave
at the interface layer.

## 2. Source-of-truth hierarchy

> **The approved Jawwid Chat PRD v0.1 governs product scope and behaviour.**
> Existing briefs, role assignments, discovery reports and implementation artifacts — including
> everything in this directory — may provide context **only where they do not conflict with the
> PRD**. Where they conflict, the PRD wins and this pack is wrong.

| Rank | Artifact | Standing |
|---|---|---|
| 1 | **Jawwid Chat PRD v0.1** (approved by the product owner) | **Authoritative.** Not on disk — see §5. |
| 2 | `docs/qa/authoritative-scope.md` (AI #5) | The operative **written record** of PRD scope until the PRD is added to the repo. Governing by its own declaration. |
| 3 | `docs/product-operations/open-decisions.md` (AI #8) | The register of decisions product still owns. This pack defers to it and never pre-empts it. |
| 4 | This design pack | **Subordinate to all of the above.** Interface layer only. |
| — | `docs/JAWWID_CHAT_BRIEF.pdf` | **SUPERSEDED.** Its *communication* chapter is void. Its *operating model* chapter is carried forward by the PRD (`authoritative-scope.md` §4). |

**Nothing in this pack overrides the PRD.** If a screen spec, token, decision record or
terminology entry disagrees with the PRD, the PRD is right and the file is a defect — raise it,
do not implement it.

## 3. Correction to this pack's original premise

The first version of this pack was written on the premise recorded in `docs/mobile/decisions.md`
**D1** — *"the PDF brief governs the staff side; role assignments govern the family/teacher
side."* That premise is **withdrawn.**

It is superseded by `docs/qa/authoritative-scope.md`, and it is one of the two competing
reconciliations of the same product-owner decision recorded as **OD-01 (BLOCKING)**. Choosing
between them is a product and architecture decision owned by the product owner and AI #1.
**This pack does not choose.** Where a screen's behaviour would differ between the two
reconciliations, the spec says so and describes the requirement rather than the resolution.

Three consequences were corrected throughout this pack on review:

| Was | Now |
|---|---|
| "One continuous thread per family, `thread.family_id UNIQUE`" asserted as an invariant | **Withdrawn.** The conversation model is **OD-01 / C-2**, owned by AI #1 and AI #2. This pack states only the *UX* requirement: the customer relationship is continuous and an inbox row is a family. |
| "Owner" / "On duty" as UI labels | **Primary Owner** / **Current Handler** — the PRD's own terms (`authoritative-scope.md` §3). |
| Calling and approvals described as possibly out of scope | Both are **PRD MVP scope.** Only their *implementation status* is unresolved. |

## 4. What this pack decides, and what it does not

**It decides** (final, see `FREEZE.md` §1): visual language and tokens · typography and the
Arabic-first type strategy · spacing, radius, elevation, motion · component inventory and their
states · information hierarchy within a screen · RTL/LTR mirroring rules · bilingual terminology
for UI strings · loading, empty, error, offline and permission-denied treatments · accessibility
minimums · cross-platform visual consistency.

**It does not decide** — and any apparent decision on these is a documentation defect:
product scope · the conversation/data model · authorization · who may approve what · identity
and authentication · routing, ownership, coverage, attention or workload logic · API contracts ·
schema · release sequencing.

Every screen spec marks backend-owned behaviour inline as **`[BE]`**. Every affordance described
as hidden or disabled is **UX only**; the backend is the sole authority
(`authoritative-scope.md` §3, AI #5's `docs/qa/rbac-matrix.md`).

## 5. Standing risk

**PRD v0.1 is not in the repository** (`authoritative-scope.md` §6, `docs/release/reconnaissance.md`
RC-13). This pack was therefore conformed against AI #5's written record of PRD scope, not
against the PRD itself.

**A conformance re-check of this pack against PRD v0.1 is required once the document is on
disk.** It is listed as a blocker in `FREEZE.md` §5 and is not a task this agent can close.
