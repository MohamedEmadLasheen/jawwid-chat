# Jawwid Chat — Cross-Agent Red Team Audit

Owner: AI #9 · 2026-09-05

Where two agents' work meets, each assumes the other holds the boundary. This
document is only about those seams.

## Artifacts actually found on disk

| Agent | Found | Not found |
|---|---|---|
| AI #1 (backend core / RBAC / coverage) | `apps/api/src/platform/*` — but every file is labelled a *reference implementation* or *seam* awaiting AI #1 | `docs/architecture/` (cited by README) |
| AI #2 (communication) | `apps/api/src/communication/*`, `apps/api/prisma/schema.prisma` | `docs/communication/` — incl. `scope-decisions.md`, which the schema cites to justify its DESIGN-ONLY section |
| AI #3 (mobile) | `lib/**` (Flutter), `test/**`, `docs/mobile/*` | — |
| AI #4 (admin web) | `apps/admin-web/**`, `docs/admin/*` | — |
| AI #5 (QA) | `docs/qa/*`, `apps/api/test/unit/authorization/*`, `jest.config.js` | — |
| AI #6 (design) | `docs/design/*`, `lib/design/*` | — |
| AI #7 (infrastructure) | `docker-compose.yml`, `infra/`, `.env.example`, `.github/workflows/` (**empty**) | `docs/infrastructure/*` — four files cited by name, none present |
| AI #8 (product ops) | — | no artifacts found |

Six documents are cited as authoritative by code or by other documents and do
not exist (**RT-020**). Two of them — AI #2's `scope-decisions.md` and AI #7's
`environment.md` — are the stated justification for a security-relevant
decision, which makes those decisions unreviewable. RT-005 is a direct
consequence: the variable that would have been listed in `environment.md` is
missing from `.env.example`, so the code's hardcoded fallback is what runs.

---

## Conflicts

### X-01 · Two databases · **P1** · owners: AI #1, AI #2, AI #7, product
Fully written up as **RT-010**. AI #2's Prisma schema targets a standalone
Postgres `public` schema; AI #1's Supabase migrations declare the `chat` schema
lives *inside the Jawwid Core database*; AI #7's init script serves both and says
so. The Core-hosted model contradicts `docs/qa/authoritative-scope.md` §2 and the
standing rule that Jawwid Chat shares no database with any other product.

### X-02 · The client enforces a rule the server has no way to express · **P0** · owners: AI #1, AI #2
AI #3's `CommunicationPolicy` is an exemplary client-side statement of BR-1:
total over the role pair, correctly labelled *"defence in depth only; the backend
remains the authority"*, and it even denies the group-member→1:1 affordance so a
group never becomes a directory.

The backend it defers to **cannot make that decision**. `canReadThread` and
`canSendMessage` are never given a thread kind or a participant set (**RT-002**),
and no teacher actor exists (`ActorKind` has no teacher; JC-003). The client is
correct, self-aware about its own limits, and pointing at an authority that does
not exist. This is the most dangerous shape a security assumption can take: both
sides documented, neither enforcing.

### X-03 · Admin Web assumes per-family server capabilities that no endpoint provides · **P2** · owners: AI #2, AI #4
`capabilities.ts` states, correctly, that per-family decisions come from the
server in `FamilyDetail.capabilities` "because only the server can evaluate
`on_duty(family, now)`, stickiness, assist eligibility and `owner_locked`". No
such endpoint exists — `apps/api` has one controller, `/health`. AI #4's
`docs/admin/backend-contract-required.md` is the correct response to that gap.
The risk is the interim: if the capability payload is stubbed client-side to
unblock UI work, the "UI is not a boundary" discipline inverts silently.

### X-04 · Storage: two halves that cannot connect · **P2** · owners: AI #2, AI #7
**RT-022.** AI #2 implemented an HMAC signer that expects *this API* to serve the
bytes; no such route exists. AI #7 provisioned MinIO with credentials
(`STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`) that no code
reads, and set `STORAGE_ENDPOINT` to MinIO — which the signer cannot serve from.
Meanwhile the variable the signer actually needs, `STORAGE_SIGNING_SECRET`, is in
neither file (**RT-005**). Attachments cannot currently be stored or served by
any path, and the security-relevant variable is the one that fell through the gap.

### X-05 · QA's regression suite is enforced by nothing · **P2** · owners: AI #7, AI #5
**RT-015.** AI #5 wrote conformance tests that correctly fail against the current
implementation and are explicitly marked *"do not weaken them to make the suite
green"*. `.github/workflows/` is an empty directory. `npx jest --selectProjects
unit` today: **4 failed, 6 passed**. Nothing observes that. `docs/qa/release-gate.md`
describes gates that no automation applies.

### X-06 · The defect log trails the tests that cite it · **P3** · owner: AI #5
`docs/qa/defects.md` ends at JC-004, but `assist-escalation-bypass.spec.ts` cites
JC-005 and `internal-note-privacy.spec.ts` cites JC-006, both with full
reasoning in comments. Two real defects exist only inside test files. Anyone
triaging from the log alone will miss them — including the fix-validation
follow-up that **RT-003** depends on.

### X-07 · No AI #8 artifacts; the operating model is asserted only in QA prose · **P2** · owner: AI #8
Permanent Primary Ownership, Shift Coverage, Workload Monitoring and the Attention
model exist as `chat.config` seed rows and as prose in
`docs/qa/authoritative-scope.md`. There is no operating-model document and no
implementation. The seeded weights are unreviewed against an operating model
nobody has written down.

### X-08 · "Reference implementations" are indistinguishable from finished work at runtime · **P1** · owners: AI #1, AI #7
`ReferenceCoverageService` implements **no** shift, coverage-rule or absence
logic — it returns the family's owner if active, else `null` — and says so
honestly. `PrismaIdentityService` reads primary keys. The gateway's auth is a
`String()` cast marked "AI #1 SEAM: replace this".

Every one of these is honestly labelled in a comment. **None of them fails at
startup.** A comment is not a deployment control. The system as committed would
boot — if it had a `main.ts` — with no authentication, no coverage engine and no
real identity service, and nothing would say so. Each seam needs a hard
`APP_ENV !== 'local'` guard that refuses to construct the reference
implementation. That single pattern closes RT-001 and RT-005 as *deployment*
risks even before AI #1 lands the real work.

---

## The chain that matters most

Individually these are P1s. Composed, they are a full customer-data compromise
requiring nothing but knowledge of the public repository:

1. **RT-001** — connect as any staff member by naming a UUID.
2. **RT-002** — `canReadThread` allows any family-facing role to read every family, whatever the thread's kind; `listThreadsForActor` (**RT-011**) then returns every thread in the system via a `familyId: '*'` probe.
3. Nothing scopes that to coverage, and no participant set exists to scope it against.
4. **RT-012** — every message read returns the full receipt roster, enumerating internal staff user ids.
5. **RT-005** — attachments are readable with a self-minted signature over any object key.

Step 4 feeds step 1: the receipt roster hands an attacker the exact user ids that
step 1 consumes. The chain closes on itself.

**Breaking any one link breaks the chain, and link 1 is the cheapest to fix**
(X-08's startup guard). That is the recommended first move.
