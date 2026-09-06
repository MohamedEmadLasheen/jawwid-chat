# Jawwid Chat

Customer Success operating system for Jawwid. Replaces WhatsApp for the CS team.

The authoritative product contract is the **Project Brief** (`docs/brief/JAWWID_CHAT_BRIEF.md`).
Every number in it is a `config` default, not a constant.

## The one rule

One Family -> One Primary Owner. The system, not the employee, owns the family's history.

## Layout

| Path | Owner | Contents |
|---|---|---|
| `apps/admin-web` | AI #4 | Internal Admin Web application (React + TS + Vite) |
| `docs/admin` | AI #4 | Admin architecture, workflows, testing, backend dependencies |
| `docs/architecture` | AI #1 | Backend core, data model, RBAC, coverage engine |
| `docs/communication` | AI #2 | Thread/message/case/task/handoff, realtime, automation |
| `docs/design` | AI #6 | Product UX, design system, terminology, screen specs, handoffs |

## Admin Web

```bash
cd apps/admin-web
npm install
npm run dev
```
