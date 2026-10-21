# PD-16 — enrolling a new student, and the parent's sign-up

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-16.

## The workflow

| Step | Who | Where |
|---|---|---|
| Sales records "subscribed" with the form | Sales | Trial group "+ → Trial" (trial journey) |
| **Assign** the responsible supervisor (confirm the parent's sign-in e-mail) | Operations manager / super admin | Admin Web → Trials & new students → New students → card → Assign |
| Chat creates the family, parent, account and children; sets weekly times where the teacher is free | — | same transaction; the answer lists times it could not set (the Teachers department sets them in Schedules) |
| **Create group** (parent, teacher, supervisor) + the parent's direct chat with the supervisor | the assigned supervisor (or their manager) | New students card → Create group (opens it in Chat) |
| Parent opens the app → "New parent? Create your account" → e-mail → **code** → password | the parent | app sign-in screen |
| The code appears on the card ("Send it to them on WhatsApp: 482913") | the assigned supervisor | New students card (refreshes every 15 s) |
| The parent is signed in and sees Chats: the family group and their supervisor | — | app |

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/trials/new-students` | `{ canAssign, students: [{ …form, enrolment: null \| { supervisor, groupConversationId, canCreateGroup, parentSignup: { state, code?, expiresAt? } } }] }`, filtered per viewer |
| POST | `/trials/new-students/:trialId/assign` | `{ supervisorId, email? }` → `{ familyId, learnerIds, schedules: [{ learnerId, set, reason }] }` |
| POST | `/trials/new-students/:trialId/group` | → `{ conversationId }` |
| POST | `/auth/signup/request` | public; `{ email }` → always `{ ok: true, delivery: 'relay' }` |
| POST | `/auth/signup/verify` | public; `{ email, code, password }` → `{ ok: true }`; then `POST /auth/login` |

Refusals: `AUTH.SIGNUP_CODE_INVALID` (401, any wrong / expired / spent code or unknown e-mail), `AUTH.PASSWORD_TOO_WEAK` (400, fewer than 8 characters), `COMMON.RATE_LIMITED` (429).

## Database rules

- `chat.enrol_learner` (server-side only; Operations manager or super admin) is the only new writer of `learner.teacher_id`; it opens the assignment gate for its own insert.
- `chat.student_enrolment` links the form to the family; only its group is added later, once.
- `trial_subscription_frozen_once_enrolled`: an enrolled form never changes.
- `chat.parent_signup_code`: one live code per account, at most 5 tries, at most a day's life (the API uses 10 minutes), hashed; `relay_code` is cleared when the code is used or superseded.

## Connecting WhatsApp later

Add a sender inside `src/new-students` that reads the form's phone (confined) and sends the code through an approved authentication template; set `delivery` to it in `ParentSignupService.request`. Nothing else changes: the parent's screen already says the code arrives on WhatsApp.
