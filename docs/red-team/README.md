# Red Team (AI #9)

Adversarial audit of Jawwid Chat. Complementary to AI #5's QA: QA asks whether
the system satisfies its test cases; this asks what happens outside them.

| Document | Contents |
|---|---|
| [findings.md](findings.md) | All findings, P0→P3, with evidence grades. **Start here.** |
| [attack-surface.md](attack-surface.md) | What is reachable, what is declared-but-unreachable, what is absent. |
| [race-conditions.md](race-conditions.md) | Concurrency analysis; protected invariants and unprotected windows. |
| [cross-agent-red-team.md](cross-agent-red-team.md) | Seams between agents, and the attack chain that crosses them. |

## Executable evidence

```bash
cd apps/api && npx jest --selectProjects unit --testPathPattern red-team
```

`apps/api/test/unit/red-team/` asserts **observed** behaviour, so it passes
today. Each spec names the secure behaviour it violates. When a finding is fixed,
invert its assertion in the same commit — a green red-team suite after a fix
means the fix did not land.

## Rules this audit holds itself to

- A finding is **CONFIRMED** only with an executed test or an exhaustive read of
  the only code path. Everything else is graded **UNVERIFIED** or **THEORETICAL**
  and says so in the finding itself.
- No severity inflation. One proven P0 outranks fifty hardening notes.
- Absence of implementation is not a clearance. Unbuilt surfaces are listed as
  deferred, never as passed.
- Fix validation re-runs the attack **and its nearby variants** — a fix to the
  reported request that leaves the boundary open is not a fix (see RT-003, which
  survives the fix AI #5 specified for JC-005).

## Status

Campaign 1 (static + service-layer runtime) and campaign 2 (SQL attacks against
the `chat.*` migration series) are complete. **A large refactor is uncommitted in
the working tree** and six of seven unit suites currently fail to compile as a
result; see the live-tree notice at the top of `findings.md` for which findings
survive it, which it closes, and the one it makes worse (RT-004). The red-team
specs must be re-pointed at the new `AuthorizationService` API once that
refactor lands.

## Not yet run

Chaos/recovery (`chaos-scenarios.md`, `recovery-report.md`) and runtime
authorization attacks require a bootable application. There is no `main.ts`, no
`AppModule` and no HTTP surface beyond `/health`. See the *Deferred* section of
`findings.md`.
