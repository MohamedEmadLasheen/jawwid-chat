# Jawwid Chat

A communication platform for Jawwid Online Quran & Arabic Academy: parents,
teachers, supervisors (admins) and managers communicate safely around families
and learners, with ownership, permissions, moderation, privacy, realtime,
notifications and auditability enforced by the platform.

The authoritative product direction is `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`
(with `docs/product/jawwid-chat-prd-v0.1.md` for requirements). The
documentation index is `docs/README.md`. The integration branch is
`integration/recovery` (Phase 0, 2026-09-07).

> The paragraph that used to sit here described a "Customer Success operating
> system" built from the PDF brief. That direction is superseded; see
> `docs/recovery/PHASE-0-BRANCH-LEDGER.md` for how the repository was reconciled.

## The one rule

BR-1: a teacher and a parent never share a direct channel; they communicate
only inside the official Student Group with a live admin present. Enforced in
`AuthorizationService` and by database triggers. And: one family, one current
supervisor — the system, not the employee, owns the family's history.

## Layout

| Path | Owner | Contents |
|---|---|---|
| `apps/admin-web` | AI #4 | Internal Admin Web application (React + TS + Vite) |
| `docs/admin` | AI #4 | Admin architecture, workflows, testing, backend dependencies |
| `docs/architecture` | AI #1 | Backend core, data model, RBAC, coverage engine |
| `docs/communication` | AI #2 | Conversations, messages, approvals, calls, realtime, notifications |
| `docs/design` | AI #6 | Product UX, design system, terminology, screen specs, handoffs |

## Admin Web

```bash
cd apps/admin-web
npm install
npm run dev
```
