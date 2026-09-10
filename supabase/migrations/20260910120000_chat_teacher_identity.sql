-- Jawwid Chat -- teacher identity becomes first class, and the account gains a
-- lifecycle. PR-A of the authentication rollout (`docs/architecture/IDENTITY-MODEL.md`
-- §2.1 and §3, CANONICAL, locked 2026-09-07).
--
-- WHY
-- ---
-- A teacher currently "exists" if and only if some chat.learner.teacher_id
-- happens to equal their id. There is no row, so there is no name, no active
-- flag, no account, and nothing to deactivate. `identity.service.ts` therefore
-- hard-codes `displayName: 'Teacher'` and `isActive: true` for anybody whose
-- uuid appears in that column -- which is the reason a teacher cannot be
-- authenticated at all. IDENTITY-MODEL §2.1 resolves it by giving teachers
-- their own table linked to chat.account, and turning learner.teacher_id into a
-- real foreign key.
--
-- Deliberately NOT done here: `chat.account.teacher_id`. The archived D-6
-- baseline (16857af) added that column as an explicitly labelled stopgap --
-- "when AI #1 lands chat.teacher, teacher_id becomes a foreign key and this
-- comment should be deleted with it". IDENTITY-MODEL §7 names the replacement
-- as a required change: "teacher resolution through `chat.teacher` (not
-- `account.teacher_id`)". The link is chat.teacher.account_id, one direction
-- only, so there is no second place for teacher identity to live.
--
-- This migration changes no runtime behaviour: nothing reads chat.teacher yet,
-- and `identity.service.ts` is untouched. PR-B rewires the resolver.

-- ---------------------------------------------------------------------------
-- 1. The teacher entity
-- ---------------------------------------------------------------------------
create table if not exists chat.teacher (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),

  -- Nullable until the teacher is provisioned a login. A teacher who exists in
  -- the academy record but has never signed in has no account, which is the
  -- same shape chat.contact.account_id already uses. UNIQUE permits many NULLs
  -- and at most one teacher per account.
  account_id      uuid unique references chat.account (id) on delete restrict,

  name            text not null,

  -- Jawwid Core has no teacher entity today (its own PRD lists live classes as
  -- a V1 non-goal -- `open-contract-decisions.md`). These carry the external id
  -- when Core gains one, so adopting it later is a backfill, not a redesign.
  core_teacher_id uuid unique,
  synced_at       timestamptz,

  is_active       boolean     not null default true,
  left_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.teacher is
  'Teacher identity. A teacher is NOT a staff role -- `domain-reconciliation.md` '
  'C: "Do not fix this by adding teacher to staff.role", because the staff '
  'family-facing role set would then decide whether a teacher may communicate. '
  'Carries no contact channel (BR-2), like every other identity table here.';

comment on column chat.teacher.account_id is
  'Null until a login is provisioned. Such a teacher can be assigned to a '
  'learner and appear in a group, but can never authenticate.';

create index if not exists teacher_organization_idx on chat.teacher (organization_id);
create index if not exists teacher_active_idx       on chat.teacher (id) where is_active;

drop trigger if exists teacher_set_updated_at on chat.teacher;
create trigger teacher_set_updated_at
  before update on chat.teacher
  for each row execute function chat.set_updated_at();

-- Tenant isolation, the same restrictive policy every root table carries from
-- 20260906120000. Restrictive means it ANDs with any permissive policy added
-- later; on its own, with no permissive policy, the table is unreadable by
-- `authenticated` -- which is what RLS-STRATEGY.md §4 asks for on identity
-- tables ("reachable only through chat_service or SECURITY DEFINER helpers").
alter table chat.teacher enable row level security;

drop policy if exists teacher_organization_isolation on chat.teacher;
create policy teacher_organization_isolation on chat.teacher
  as restrictive
  for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- ---------------------------------------------------------------------------
-- 2. Account: teacher kind, and a real lifecycle
-- ---------------------------------------------------------------------------
-- `kind` gains 'teacher' so an account can resolve to a teacher principal.
alter table chat.account drop constraint if exists account_kind_check;
alter table chat.account
  add constraint account_kind_check check (kind in ('staff', 'family', 'teacher'));

alter table chat.account add column if not exists status         text;
alter table chat.account add column if not exists deactivated_at timestamptz;
alter table chat.account add column if not exists deactivated_by uuid;
alter table chat.account add column if not exists last_login_at  timestamptz;

-- Backfill BEFORE the constraints, so an existing row cannot fail them.
-- is_active is the only lifecycle signal that exists today, so it decides the
-- starting status; an inactive account becomes 'deactivated' rather than being
-- silently reactivated.
update chat.account set status = case when is_active then 'active' else 'deactivated' end
 where status is null;

alter table chat.account alter column status set default 'active';
alter table chat.account alter column status set not null;

alter table chat.account drop constraint if exists account_status_check;
alter table chat.account
  add constraint account_status_check
  check (status in ('provisioned', 'active', 'suspended', 'deactivated'));

-- The two flags must never disagree. chat.current_account_id() filters on
-- is_active, so a 'suspended' account whose is_active stayed true would keep
-- passing every RLS check -- the exact drift this constraint exists to stop.
alter table chat.account drop constraint if exists account_status_matches_is_active;
alter table chat.account
  add constraint account_status_matches_is_active
  check (is_active = (status = 'active'));

alter table chat.account drop constraint if exists account_deactivated_by_fk;
alter table chat.account
  add constraint account_deactivated_by_fk
  foreign key (deactivated_by) references chat.account (id) on delete set null;

comment on column chat.account.status is
  'IDENTITY-MODEL §3. provisioned = exists, no usable credential yet; active = '
  'may log in; suspended = manager block, sessions revoked; deactivated = '
  'terminal offboarding. IdentityService treats anything but active as '
  'isActive=false.';

-- ---------------------------------------------------------------------------
-- 3. learner.teacher_id becomes a real relationship
-- ---------------------------------------------------------------------------
-- Backfill first: one teacher row per distinct existing teacher_id, keeping the
-- id so every existing assignment survives untouched.
--
-- On the production schema this inserts NOTHING. `chat.learner.teacher_id` is
-- documented as "stays null until Core gains [a teacher entity]" and no
-- migration or seed writes it; the only writers are the API integration
-- harnesses. Backfilled rows are therefore created is_active = false and with
-- a placeholder name: an id that arrived without a name or an account has no
-- verified identity behind it, and must not be able to act as one.
insert into chat.teacher (id, organization_id, name, is_active)
select distinct on (l.teacher_id)
       l.teacher_id,
       l.organization_id,
       '(unprovisioned teacher)',
       false
  from chat.learner l
 where l.teacher_id is not null
   and not exists (select 1 from chat.teacher t where t.id = l.teacher_id)
 order by l.teacher_id;

alter table chat.learner drop constraint if exists learner_teacher_fk;
alter table chat.learner
  add constraint learner_teacher_fk
  foreign key (teacher_id) references chat.teacher (id) on delete restrict;

-- RESTRICT, not SET NULL: nothing in this product deletes a principal --
-- offboarding sets is_active and left_at (IDENTITY-MODEL §5) -- so a DELETE
-- that would silently drop a learner's teacher assignment is a mistake worth
-- refusing at the database.
create index if not exists learner_teacher_idx
  on chat.learner (teacher_id) where teacher_id is not null;

comment on column chat.learner.teacher_id is
  'The assigned teacher. Was a bare uuid with no identity behind it until PR-A; '
  'now a foreign key to chat.teacher. Group membership follows this assignment '
  '(OD-04: a teacher change that does not update membership is a privacy '
  'incident, not a data gap).';
