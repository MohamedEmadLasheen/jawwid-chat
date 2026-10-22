-- PD-21 (2026-10-22): impersonation -- a "support session".
--
-- An administrator acts AS a parent (family) or teacher account, to see what
-- they see and to make changes for them. Owner decisions: parent and teacher
-- accounts only, never staff; messages sent meanwhile are allowed but LABELLED
-- to their recipients; who may is canAdministerAccount (any staff role on a
-- parent or teacher of their organization).
--
-- THE RECORD (chat.impersonation_session): who (the administrator, their own
-- account and the session they started it from), whom (the target account),
-- why, when it started, its hard expiry (at most 60 minutes after the start),
-- when and how it ended. Never deleted; it only moves forward.
--
-- THE SESSION: an ordinary chat.session row for the TARGET account, marked with
-- impersonation_id. AuthService refuses it the moment the support session has
-- ended or expired, or the administrator's own session, account or permission
-- is gone -- so it dies with the administrator. It has no usable refresh token.
--
-- THE TRAIL: every request made on a support session (method, route, status;
-- never a body) in chat.impersonation_action, append-only; every audit_log row
-- written meanwhile carries impersonation_id; every message sent meanwhile
-- carries it too, which is what labels it to its recipients.

create table chat.impersonation_session (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references chat.organization (id),
  staff_id            uuid not null references chat.staff (id),
  staff_account_id    uuid not null references chat.account (id),
  staff_session_id    uuid not null references chat.session (id),
  target_account_id   uuid not null references chat.account (id),
  target_kind         text not null check (target_kind in ('family', 'teacher')),
  -- The target-side session. Set once, in the transaction that starts it.
  session_id          uuid unique references chat.session (id),
  reason              text not null check (length(btrim(reason)) > 0),
  started_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  ended_at            timestamptz,
  ended_reason        text,
  constraint impersonation_session_expiry_after_start check (expires_at > started_at),
  constraint impersonation_session_at_most_an_hour check (expires_at <= started_at + interval '60 minutes'),
  constraint impersonation_session_end_is_complete check ((ended_at is null) = (ended_reason is null)),
  constraint impersonation_session_never_self check (staff_account_id <> target_account_id)
);

comment on table chat.impersonation_session is
  'PD-21: an administrator acting as a parent or teacher account. Who, whom, why, when; never deleted; ends with the administrator''s own session.';

create index impersonation_session_staff on chat.impersonation_session (staff_id, started_at desc);
create index impersonation_session_target on chat.impersonation_session (target_account_id, started_at desc);
create index impersonation_session_live on chat.impersonation_session (staff_session_id) where ended_at is null;

create or replace function chat.guard_impersonation_session()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_target_kind text;
  v_target_org  uuid;
  v_staff_acct  uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'a support session is never deleted' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    select a.kind, a.organization_id into v_target_kind, v_target_org
      from chat.account a where a.id = new.target_account_id;
    if v_target_org is distinct from new.organization_id or v_target_kind is distinct from new.target_kind then
      raise exception 'a support session is of a parent or teacher account of its own organization' using errcode = 'check_violation';
    end if;
    select s.account_id into v_staff_acct
      from chat.staff s
     where s.id = new.staff_id and s.organization_id = new.organization_id
       and s.is_active and s.left_at is null;
    if v_staff_acct is null or v_staff_acct <> new.staff_account_id then
      raise exception 'a support session is started by active staff of the same organization, from their own account' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.session x
                    where x.id = new.staff_session_id and x.account_id = new.staff_account_id
                      and x.revoked_at is null and x.expires_at > now()) then
      raise exception 'a support session is started from the administrator''s own live session' using errcode = 'check_violation';
    end if;
    new.started_at := now();
    new.ended_at := null;
    new.ended_reason := null;
    if new.expires_at > new.started_at + interval '60 minutes' then
      raise exception 'a support session lasts at most an hour' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.id, new.organization_id, new.staff_id, new.staff_account_id,
      new.target_account_id, new.target_kind, new.reason, new.started_at)
     is distinct from
     (old.id, old.organization_id, old.staff_id, old.staff_account_id,
      old.target_account_id, old.target_kind, old.reason, old.started_at) then
    raise exception 'a support session''s identity never changes' using errcode = 'check_violation';
  end if;
  -- The administrator's session is ROTATED on every refresh (a new row; the
  -- old one revoked as 'rotated'). A live support session follows it -- only
  -- through a rotation, only to a live session of the same account.
  if new.staff_session_id is distinct from old.staff_session_id then
    if old.ended_at is not null
       or not exists (select 1 from chat.session o
                       where o.id = old.staff_session_id and o.revoked_reason = 'rotated')
       or not exists (select 1 from chat.session n
                       where n.id = new.staff_session_id and n.account_id = old.staff_account_id
                         and n.revoked_at is null and n.expires_at > now()) then
      raise exception 'a support session follows its administrator''s session only through a rotation' using errcode = 'check_violation';
    end if;
  end if;
  if old.session_id is not null and new.session_id is distinct from old.session_id then
    raise exception 'a support session keeps its session' using errcode = 'check_violation';
  end if;
  if old.ended_at is not null and (new.ended_at, new.ended_reason, new.expires_at) is distinct from (old.ended_at, old.ended_reason, old.expires_at) then
    raise exception 'an ended support session stays ended' using errcode = 'check_violation';
  end if;
  if new.expires_at < old.expires_at then
    raise exception 'a support session is ended, never shortened' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger impersonation_session_is_coherent
  before insert or update or delete on chat.impersonation_session
  for each row execute function chat.guard_impersonation_session();

-- The target-side session points back at its support session.
alter table chat.session add column impersonation_id uuid references chat.impersonation_session (id);
create unique index session_one_per_impersonation on chat.session (impersonation_id) where impersonation_id is not null;

-- Every request made on a support session. Append-only (chat.forbid_mutation).
create table chat.impersonation_action (
  id                bigint generated always as identity primary key,
  impersonation_id  uuid not null references chat.impersonation_session (id),
  method            text not null check (method ~ '^[A-Z]{3,7}$'),
  route             text not null check (length(route) between 1 and 300),
  status            integer not null check (status between 100 and 599),
  at                timestamptz not null default now()
);

comment on table chat.impersonation_action is
  'PD-21: every request made on a support session -- method, route template, status. Never a body. Append-only.';

create index impersonation_action_session on chat.impersonation_action (impersonation_id, at);

create trigger impersonation_action_is_append_only
  before update or delete on chat.impersonation_action
  for each row execute function chat.forbid_mutation();

-- Audit rows and messages written during a support session say so. No foreign
-- key on audit_log: it is append-only and carries no foreign keys (actor_id's
-- was dropped in 20260905093000).
alter table chat.audit_log add column impersonation_id uuid;
create index audit_log_impersonation on chat.audit_log (impersonation_id) where impersonation_id is not null;

alter table chat.message add column impersonation_id uuid references chat.impersonation_session (id);

comment on column chat.message.impersonation_id is
  'PD-21: set when the message was sent by an administrator in a support session; clients label it "sent by support".';

-- Request roles: none.
alter table chat.impersonation_session enable row level security;
alter table chat.impersonation_action  enable row level security;
revoke all on chat.impersonation_session, chat.impersonation_action from public, anon, authenticated, chat_app;
revoke all on function chat.guard_impersonation_session() from public;
